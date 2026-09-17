/**
 * Hồ sơ người dùng: tên hiển thị, ảnh đại diện, mã QR nhận tiền.
 *
 * Chỉ có ở tài khoản thật — chế độ khách không có hồ sơ (xem manager.ts).
 *
 * Hai bucket Storage (migration 20260917_1100):
 *   - `avatars`    công khai, đọc bằng public URL
 *   - `payment-qr` riêng tư, chỉ chính chủ và người đi chung chuyến xem được,
 *                  đọc bằng signed URL có hạn
 * File luôn nằm trong thư mục `<user id>/` — policy Storage và CHECK trên
 * profiles đều dựa vào quy ước này.
 */

import { supabase } from '@/lib/supabase/client';
import { DataError, unwrap } from '@/lib/supabase/errors';

const AVATAR_BUCKET = 'avatars';
const PAYMENT_QR_BUCKET = 'payment-qr';

/** Signed URL của mã QR sống 10 phút — đủ để mở app ngân hàng quét, không đủ để phát tán. */
const QR_URL_TTL_SECONDS = 600;

export interface MyProfile {
  readonly id: string;
  readonly email: string | null;
  readonly displayName: string;
  readonly avatarUrl: string | null;
  readonly paymentQrPath: string | null;
  readonly paymentNote: string | null;
}

export interface PaymentInfo {
  readonly displayName: string;
  readonly avatarUrl: string | null;
  /** null nếu người đó chưa tải mã QR lên. */
  readonly qrUrl: string | null;
  readonly note: string | null;
}

/** Ảnh cần tải lên, đã nén sẵn ở client. */
export interface ImageUpload {
  readonly base64: string;
  readonly mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
}

export function avatarUrlFromPath(path: string | null | undefined): string | null {
  if (!path) return null;
  return supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path).data.publicUrl;
}

async function requireUserId(): Promise<{ id: string; email: string | null }> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    throw new DataError('Bạn cần đăng nhập để dùng hồ sơ.');
  }
  return { id: data.user.id, email: data.user.email ?? null };
}

/**
 * Base64 → byte thô. Supabase Storage trên React Native không nhận Blob/File
 * đọc từ URI cục bộ một cách ổn định; gửi ArrayBuffer là cách chạy giống nhau
 * trên Android, iOS và web.
 */
function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/**
 * Xoá file trong Storage và BÁO khi thất bại.
 *
 * `storage.remove()` không reject khi lỗi mà trả về `{ error }` — `.catch()`
 * không bắt được gì, file cũ nằm lại im lặng. Với mã QR (số tài khoản) thì người
 * dùng tưởng đã gỡ mà người đi chung chuyến vẫn xem được. Thử lại một lần vì lỗi
 * mạng thoáng qua là nguyên nhân thường gặp nhất.
 */
async function removeFile(bucket: string, path: string): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const { error } = await supabase.storage.from(bucket).remove([path]);
      if (!error) return true;
    } catch {
      // thử lại
    }
  }
  return false;
}

function extensionOf(mimeType: ImageUpload['mimeType']): string {
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/webp') return 'webp';
  return 'jpg';
}

export async function getMyProfile(): Promise<MyProfile> {
  const user = await requireUserId();
  const rows = unwrap(
    await supabase
      .from('profiles')
      .select('id, display_name, avatar_path, payment_qr_path, payment_note')
      .eq('id', user.id),
  );
  const row = rows[0];
  if (!row) throw new DataError('Không tìm thấy hồ sơ của bạn.');

  return {
    id: row.id,
    email: user.email,
    displayName: row.display_name,
    avatarUrl: avatarUrlFromPath(row.avatar_path),
    paymentQrPath: row.payment_qr_path,
    paymentNote: row.payment_note,
  };
}

export async function updateMyProfile(input: {
  readonly displayName: string;
  readonly paymentNote: string;
}): Promise<void> {
  const user = await requireUserId();
  const displayName = input.displayName.trim();
  if (displayName === '') throw new DataError('Tên hiển thị không được để trống.');
  if (displayName.length > 80) throw new DataError('Tên hiển thị tối đa 80 ký tự.');
  const note = input.paymentNote.trim();
  if (note.length > 120) throw new DataError('Ghi chú nhận tiền tối đa 120 ký tự.');

  const rows = unwrap(
    await supabase
      .from('profiles')
      .update({ display_name: displayName, payment_note: note === '' ? null : note })
      .eq('id', user.id)
      .select('id'),
  );
  if (rows.length === 0) throw new DataError('Lưu hồ sơ không thành công.');

  // Menu tài khoản đọc tên từ metadata của phiên đăng nhập — cập nhật luôn để
  // không phải đăng xuất rồi vào lại mới thấy tên mới. Lỗi ở bước phụ này
  // không làm hỏng việc đã lưu.
  await supabase.auth.updateUser({ data: { display_name: displayName } }).catch(() => undefined);
}

/**
 * Tải ảnh lên với tên file MỚI rồi mới trỏ hồ sơ sang, cuối cùng xoá file cũ.
 * Thứ tự này để lỗi giữa chừng không bao giờ làm hồ sơ trỏ vào file đã mất; và
 * tên mới tránh việc ảnh cũ còn nằm trong bộ nhớ đệm của expo-image.
 */
async function replaceImage(
  bucket: string,
  column: 'avatar_path' | 'payment_qr_path',
  image: ImageUpload,
): Promise<string> {
  const user = await requireUserId();

  const current = unwrap(
    await supabase.from('profiles').select('avatar_path, payment_qr_path').eq('id', user.id),
  )[0];
  const previous = current ? current[column] : null;

  const path = `${user.id}/${column === 'avatar_path' ? 'avatar' : 'qr'}-${Date.now()}.${extensionOf(image.mimeType)}`;
  const { error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(path, base64ToBytes(image.base64), { contentType: image.mimeType, upsert: false });
  if (uploadError) {
    throw new DataError(`Tải ảnh lên không thành công: ${uploadError.message}`);
  }

  const update = column === 'avatar_path' ? { avatar_path: path } : { payment_qr_path: path };
  const result = await supabase.from('profiles').update(update).eq('id', user.id).select('id');
  if (result.error || (result.data ?? []).length === 0) {
    // Hồ sơ không trỏ sang file mới → dọn file vừa tải, không để rác nằm lại.
    await removeFile(bucket, path);
    throw new DataError('Lưu ảnh vào hồ sơ không thành công.');
  }

  if (previous && !(await removeFile(bucket, previous))) {
    // Ảnh mới đã lưu xong; chỉ báo nếu là mã QR, vì ảnh cũ chứa số tài khoản.
    if (column === 'payment_qr_path') {
      throw new DataError(
        'Đã lưu mã QR mới nhưng chưa xoá được ảnh cũ. Thử đổi lại lần nữa khi có mạng ổn định.',
      );
    }
  }
  return path;
}

export async function uploadAvatar(image: ImageUpload): Promise<string | null> {
  const path = await replaceImage(AVATAR_BUCKET, 'avatar_path', image);
  return avatarUrlFromPath(path);
}

export async function uploadPaymentQr(image: ImageUpload): Promise<string> {
  return replaceImage(PAYMENT_QR_BUCKET, 'payment_qr_path', image);
}

export async function removePaymentQr(): Promise<void> {
  const user = await requireUserId();
  const current = unwrap(
    await supabase.from('profiles').select('payment_qr_path').eq('id', user.id),
  )[0];
  // Xoá FILE trước, hồ sơ sau: người dùng bấm gỡ vì muốn số tài khoản biến mất.
  // Ngược thứ tự mà xoá file lỗi thì hồ sơ báo đã gỡ trong khi ảnh vẫn xem được.
  if (current?.payment_qr_path && !(await removeFile(PAYMENT_QR_BUCKET, current.payment_qr_path))) {
    throw new DataError('Chưa gỡ được ảnh mã QR. Kiểm tra mạng rồi thử lại.');
  }
  unwrap(
    await supabase.from('profiles').update({ payment_qr_path: null }).eq('id', user.id).select('id'),
  );
}

/** Signed URL cho một đường dẫn QR — dùng để xem trước QR của chính mình. */
export async function signedPaymentQrUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from(PAYMENT_QR_BUCKET)
    .createSignedUrl(path, QR_URL_TTL_SECONDS);
  if (error || !data) {
    throw new DataError('Không mở được ảnh mã QR.');
  }
  return data.signedUrl;
}

/**
 * Thông tin nhận tiền của một người đi chung chuyến.
 *
 * RLS của profiles chỉ trả về dòng của người đang đi chung chuyến; người lạ
 * nhận được "không tìm thấy", không phân biệt với "không tồn tại".
 */
export async function getPaymentInfo(userId: string): Promise<PaymentInfo> {
  const rows = unwrap(
    await supabase
      .from('profiles')
      .select('display_name, avatar_path, payment_qr_path, payment_note')
      .eq('id', userId),
  );
  const row = rows[0];
  if (!row) throw new DataError('Không xem được thông tin nhận tiền của người này.');

  // Ký URL lỗi (file vừa bị thay, hoặc đường dẫn trỏ vào file không còn) chỉ
  // làm mất ảnh QR — ghi chú số tài khoản vẫn phải hiện.
  let qrUrl: string | null = null;
  if (row.payment_qr_path) {
    qrUrl = await signedPaymentQrUrl(row.payment_qr_path).catch(() => null);
  }

  return {
    displayName: row.display_name,
    avatarUrl: avatarUrlFromPath(row.avatar_path),
    qrUrl,
    note: row.payment_note,
  };
}
