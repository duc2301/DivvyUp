import type { AuthError } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';

import { setRememberSession, supabase } from '@/lib/supabase/client';
import { DataError } from '@/lib/supabase/errors';

/**
 * Lỗi do Supabase Auth giới hạn tần suất.
 *
 * Tách riêng lớp để màn hình khoá nút gửi trong `retryAfterSeconds` giây — bấm
 * tiếp khi đang bị giới hạn chỉ kéo dài thời gian bị khoá thêm.
 */
export class AuthRateLimitError extends DataError {
  readonly retryAfterSeconds: number;

  constructor(message: string, retryAfterSeconds: number) {
    super(message, 'rate_limit');
    this.name = 'AuthRateLimitError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** Chờ tối thiểu giữa hai lần gửi email, khớp với giới hạn mặc định của Supabase. */
export const EMAIL_RESEND_COOLDOWN_SECONDS = 60;

/**
 * Dịch lỗi của Supabase Auth sang câu tiếng Việt người dùng đọc được.
 *
 * Ưu tiên `code` (ổn định) rồi mới tới `message` (có thể đổi câu chữ giữa các
 * phiên bản GoTrue).
 */
function toDataError(error: AuthError): DataError {
  const code = error.code ?? '';
  const lower = error.message.toLowerCase();

  // "For security purposes, you can only request this after 42 seconds."
  const waitMatch = lower.match(/after (\d+) seconds?/);
  if (code === 'over_request_rate_limit' || waitMatch) {
    const seconds = waitMatch ? Number(waitMatch[1]) : EMAIL_RESEND_COOLDOWN_SECONDS;
    return new AuthRateLimitError(
      `Bạn thao tác hơi nhanh. Thử lại sau ${seconds} giây.`,
      seconds,
    );
  }

  // Máy chủ email mặc định của Supabase chỉ cho gửi vài email mỗi giờ cho CẢ dự
  // án. Không có con số chờ cụ thể nên khoá nút một khoảng an toàn.
  if (code === 'over_email_send_rate_limit' || lower.includes('email rate limit exceeded')) {
    return new AuthRateLimitError(
      'Hệ thống đã gửi quá nhiều email trong giờ qua. Vui lòng thử lại sau ít phút — hoặc kiểm tra hộp thư, có thể email trước đó đã tới.',
      EMAIL_RESEND_COOLDOWN_SECONDS,
    );
  }

  if (code === 'invalid_credentials' || lower.includes('invalid login credentials')) {
    return new DataError('Email hoặc mật khẩu không đúng.', code);
  }
  if (code === 'email_not_confirmed' || lower.includes('email not confirmed')) {
    return new DataError(
      'Email chưa được xác nhận. Mở hộp thư và bấm link xác nhận, hoặc bấm "Gửi lại email xác nhận" bên dưới.',
      'email_not_confirmed',
    );
  }
  if (
    code === 'user_already_exists' ||
    code === 'email_exists' ||
    lower.includes('already registered')
  ) {
    return new DataError('Email này đã được đăng ký.', code);
  }
  if (code === 'weak_password' || lower.includes('password should be at least')) {
    return new DataError('Mật khẩu quá yếu — cần ít nhất 6 ký tự.', code);
  }
  if (code === 'same_password') {
    return new DataError('Mật khẩu mới phải khác mật khẩu cũ.', code);
  }
  if (code === 'email_address_invalid' || lower.includes('unable to validate email')) {
    return new DataError('Email không hợp lệ.', code);
  }
  if (code === 'pkce_code_verifier_not_found') {
    return new DataError(
      'Hãy mở link trên đúng thiết bị (và đúng trình duyệt) mà bạn đã bấm "Quên mật khẩu", hoặc yêu cầu gửi lại email.',
      code,
    );
  }
  if (
    code === 'flow_state_not_found' ||
    code === 'flow_state_expired' ||
    code === 'bad_code_verifier' ||
    code === 'otp_expired'
  ) {
    return new DataError('Link đã hết hạn hoặc đã được dùng. Hãy yêu cầu gửi lại email mới.', code);
  }
  if (code === 'session_not_found' || code === 'session_expired' || lower.includes('auth session missing')) {
    return new DataError('Phiên đặt lại mật khẩu đã hết hạn. Hãy yêu cầu gửi lại email mới.', code);
  }
  if (lower.includes('error sending')) {
    return new DataError(
      'Máy chủ không gửi được email. Thử lại sau ít phút.',
      code,
    );
  }
  if (lower.includes('network') || lower.includes('fetch')) {
    return new DataError('Không kết nối được tới máy chủ. Kiểm tra mạng.', code);
  }
  return new DataError(error.message, code);
}

/**
 * Link trong email mở lại ĐÚNG màn hình của app.
 *
 * Supabase chỉ chuyển hướng về URL nằm trong danh sách Redirect URLs của dự án
 * (Authentication → URL Configuration). URL lạ bị lờ đi và người dùng rơi về
 * Site URL — thường là localhost:3000, trang trắng. Phải thêm `divvyup://**`,
 * `exp://**` và địa chỉ web đang chạy vào danh sách đó.
 *
 * Đường dẫn KHÔNG có dấu / đầu: với scheme riêng, createURL('/x') sinh ra
 * `divvyup:///x` (ba gạch chéo) và router không khớp được màn nào.
 */
function appLink(path: string, queryParams?: Record<string, string>): string {
  return Linking.createURL(path, { queryParams });
}

function assertEmail(email: string): string {
  const trimmed = email.trim();
  if (trimmed === '') throw new DataError('Hãy nhập email.');
  return trimmed;
}

export async function signInWithPassword(
  email: string,
  password: string,
  remember: boolean,
): Promise<void> {
  // Đặt kho lưu phiên TRƯỚC khi đăng nhập — supabase-js ghi phiên ngay khi có.
  await setRememberSession(remember);
  const { error } = await supabase.auth.signInWithPassword({
    email: assertEmail(email),
    password,
  });
  if (error) throw toDataError(error);
}

/**
 * Đăng ký. Hồ sơ trong bảng profiles do trigger on_auth_user_created tạo,
 * lấy tên từ raw_user_meta_data.display_name.
 */
export async function signUpWithPassword(
  email: string,
  password: string,
  displayName: string,
): Promise<{ needsEmailConfirmation: boolean }> {
  const name = displayName.trim();
  if (name === '') throw new DataError('Hãy nhập tên hiển thị.');

  const { data, error } = await supabase.auth.signUp({
    email: assertEmail(email),
    password,
    options: {
      data: { display_name: name },
      emailRedirectTo: appLink('sign-in', { confirmed: '1' }),
    },
  });
  if (error) throw toDataError(error);

  // Khi dự án bật "Confirm email" (mặc định BẬT), signUp trả về user nhưng KHÔNG
  // có session. Nếu dự án tắt xác nhận thì đã có session — AuthGate tự vào app.
  return { needsEmailConfirmation: data.session === null };
}

export async function resendSignUpConfirmation(email: string): Promise<void> {
  const { error } = await supabase.auth.resend({
    type: 'signup',
    email: assertEmail(email),
    options: { emailRedirectTo: appLink('sign-in', { confirmed: '1' }) },
  });
  if (error) throw toDataError(error);
}

/**
 * Gửi email đặt lại mật khẩu.
 *
 * Supabase trả thành công kể cả khi email không tồn tại — cố ý, để không ai
 * dò được email nào đã đăng ký. Màn hình phải nói "nếu email tồn tại…".
 */
export async function requestPasswordReset(email: string): Promise<void> {
  const { error } = await supabase.auth.resetPasswordForEmail(assertEmail(email), {
    redirectTo: appLink('reset-password'),
  });
  if (error) throw toDataError(error);
}

/**
 * Đổi mã PKCE trong link đặt lại mật khẩu ra phiên tạm.
 *
 * Chỉ nhận luồng `recovery`: một mã PKCE hợp lệ nhưng thuộc luồng khác (vd link
 * xác nhận đăng ký) không được mở ô đổi mật khẩu.
 */
export async function startPasswordRecovery(code: string, flowId: string | null): Promise<void> {
  const { data, error } = await supabase.auth.exchangeCodeForSession(
    code,
    flowId ? { flowId } : undefined,
  );
  if (error) throw toDataError(error);
  // supabase-js trả redirectType lúc chạy nhưng chưa khai trong kiểu trả về.
  const redirectType = (data as { redirectType?: string | null }).redirectType;
  if (redirectType !== 'recovery') {
    await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
    throw new DataError('Đây không phải link đặt lại mật khẩu. Hãy yêu cầu gửi lại email.');
  }
}

/**
 * Đặt mật khẩu mới rồi đăng xuất, để người dùng đăng nhập lại bằng mật khẩu
 * mới ở màn đăng nhập — đúng luồng người dùng mong đợi, và cũng là cách xác
 * nhận họ nhớ đúng thứ vừa gõ.
 */
export async function completePasswordReset(
  newPassword: string,
): Promise<{ otherDevicesSignedOut: boolean }> {
  if (newPassword.length < 6) throw new DataError('Mật khẩu phải có ít nhất 6 ký tự.');
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw toDataError(error);
  // Đăng xuất MỌI thiết bị: đổi mật khẩu thường là vì nghi bị lộ, phiên cũ ở
  // máy khác phải chết theo. Mật khẩu đã đổi xong nên lỗi mạng ở bước này
  // không đáng báo thất bại — ít nhất vẫn xoá phiên trên máy này.
  const { error: signOutError } = await supabase.auth.signOut({ scope: 'global' });
  if (signOutError) {
    await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
    // Báo lên chứ không im lặng: người đổi mật khẩu vì nghi bị lộ cần biết
    // phiên ở máy khác CÓ THỂ còn sống.
    return { otherDevicesSignedOut: false };
  }
  return { otherDevicesSignedOut: true };
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error) {
    // Máy chủ báo lỗi (mất mạng, token đã hết hạn) thì vẫn phải xoá phiên trên
    // máy. Không thì bấm Đăng xuất xong người dùng vẫn kẹt trong app.
    await supabase.auth.signOut({ scope: 'local' });
  }
}
