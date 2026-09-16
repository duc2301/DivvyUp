import { supabase } from '@/lib/supabase/client';
import { DataError } from '@/lib/supabase/errors';

/** Dịch lỗi của Supabase Auth sang câu tiếng Việt người dùng đọc được. */
function friendly(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes('invalid login credentials')) return 'Email hoặc mật khẩu không đúng.';
  if (lower.includes('already registered')) return 'Email này đã được đăng ký.';
  if (lower.includes('password should be at least')) return 'Mật khẩu phải có ít nhất 6 ký tự.';
  if (lower.includes('unable to validate email')) return 'Email không hợp lệ.';
  if (lower.includes('email not confirmed')) {
    return 'Email chưa được xác nhận. Kiểm tra hộp thư, hoặc tắt "Confirm email" trong Supabase khi đang phát triển.';
  }
  if (lower.includes('network') || lower.includes('fetch')) {
    return 'Không kết nối được tới máy chủ. Kiểm tra mạng.';
  }
  return message;
}

export async function signInWithPassword(email: string, password: string): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword({
    email: email.trim(),
    password,
  });
  if (error) throw new DataError(friendly(error.message));
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
    email: email.trim(),
    password,
    options: { data: { display_name: name } },
  });
  if (error) throw new DataError(friendly(error.message));

  // Khi dự án Supabase bật "Confirm email" (mặc định BẬT), signUp trả về user
  // nhưng KHÔNG có session — người dùng chưa đăng nhập được cho tới khi bấm
  // link trong mail. Phải nói rõ, nếu không màn hình sẽ đứng im khó hiểu.
  return { needsEmailConfirmation: data.session === null };
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error) throw new DataError(friendly(error.message));
}
