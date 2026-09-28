import type { AuthError } from '@supabase/supabase-js';

import { isExistingAccountSignUp } from '@core/lib/auth/password-gate';

import { getRememberSession, setRememberSession, supabase } from '@/shared/api';
import { DataError } from '@/shared/lib/async';
import { absoluteUrl, routes } from '@/shared/config';

/**
 * Bản web của src/features/auth/auth-actions.ts (mobile dựng link bằng
 * expo-linking nên không dùng chung được). Thông báo lỗi giữ nguyên câu chữ.
 *
 * Link trong email trỏ về chính trang web đang chạy: https://divvyup.vn/** phải
 * có trong Supabase → Authentication → URL Configuration → Redirect URLs.
 */

export class AuthRateLimitError extends DataError {
  readonly retryAfterSeconds: number;

  constructor(message: string, retryAfterSeconds: number) {
    super(message, 'rate_limit');
    this.name = 'AuthRateLimitError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export const EMAIL_RESEND_COOLDOWN_SECONDS = 60;

export function toAuthDataError(error: AuthError): DataError {
  const code = error.code ?? '';
  const lower = error.message.toLowerCase();

  const waitMatch = lower.match(/after (\d+) seconds?/);
  if (code === 'over_request_rate_limit' || waitMatch) {
    const seconds = waitMatch ? Number(waitMatch[1]) : EMAIL_RESEND_COOLDOWN_SECONDS;
    return new AuthRateLimitError(`Bạn thao tác hơi nhanh. Thử lại sau ${seconds} giây.`, seconds);
  }
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
  if (code === 'user_already_exists' || code === 'email_exists' || lower.includes('already registered')) {
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
  if (code === 'provider_email_needs_verification') {
    return new DataError(
      'Email Google của bạn chưa được xác minh. Kiểm tra hộp thư để xác minh rồi thử lại.',
      code,
    );
  }
  if (code === 'validation_failed' && lower.includes('provider is not enabled')) {
    return new DataError('Đăng nhập Google chưa được bật trên hệ thống. Hãy dùng email và mật khẩu.', code);
  }
  if (code === 'reauthentication_needed') {
    return new DataError(
      'Phiên đăng nhập đã lâu. Đăng xuất rồi đăng nhập lại bằng Google, sau đó đặt mật khẩu ngay.',
      code,
    );
  }
  if (code === 'identity_already_exists') {
    return new DataError('Tài khoản Google này đã gắn với một tài khoản khác.', code);
  }
  if (lower.includes('error sending')) {
    return new DataError('Máy chủ không gửi được email. Thử lại sau ít phút.', code);
  }
  if (lower.includes('network') || lower.includes('fetch')) {
    return new DataError('Không kết nối được tới máy chủ. Kiểm tra mạng.', code);
  }
  return new DataError(error.message, code);
}

/** Lựa chọn "ghi nhớ đăng nhập" lần trước, để form tick sẵn. */
export function rememberedChoice(): boolean {
  return getRememberSession();
}

function assertEmail(email: string): string {
  const trimmed = email.trim();
  if (trimmed === '') throw new DataError('Hãy nhập email.');
  return trimmed;
}

const confirmRedirect = (): string => absoluteUrl(`${routes.signIn()}?confirmed=1`);

export async function signInWithPassword(email: string, password: string, remember: boolean): Promise<void> {
  // Chọn kho lưu phiên TRƯỚC khi đăng nhập — supabase-js ghi phiên ngay khi có.
  setRememberSession(remember);
  const { error } = await supabase.auth.signInWithPassword({ email: assertEmail(email), password });
  if (error) throw toAuthDataError(error);
}

export async function signUpWithPassword(
  email: string,
  password: string,
  displayName: string,
): Promise<{ needsEmailConfirmation: boolean; alreadyRegistered: boolean }> {
  const name = displayName.trim();
  if (name === '') throw new DataError('Hãy nhập tên hiển thị.');
  const { data, error } = await supabase.auth.signUp({
    email: assertEmail(email),
    password,
    options: { data: { display_name: name }, emailRedirectTo: confirmRedirect() },
  });
  if (error) throw toAuthDataError(error);
  // Email đã có tài khoản (kể cả tạo qua Google): Supabase trả "thành công" giả
  // để không ai dò được email — identities rỗng, KHÔNG gửi email nào.
  if (isExistingAccountSignUp(data.user)) return { needsEmailConfirmation: false, alreadyRegistered: true };
  return { needsEmailConfirmation: data.session === null, alreadyRegistered: false };
}

export async function resendSignUpConfirmation(email: string): Promise<void> {
  const { error } = await supabase.auth.resend({
    type: 'signup',
    email: assertEmail(email),
    options: { emailRedirectTo: confirmRedirect() },
  });
  if (error) throw toAuthDataError(error);
}

/** Supabase trả thành công cả khi email không tồn tại — màn hình phải nói "nếu email tồn tại…". */
export async function requestPasswordReset(email: string): Promise<void> {
  const { error } = await supabase.auth.resetPasswordForEmail(assertEmail(email), {
    redirectTo: absoluteUrl(routes.resetPassword()),
  });
  if (error) throw toAuthDataError(error);
}

/** Đặt mật khẩu mới rồi đăng xuất MỌI thiết bị (đổi mật khẩu thường vì nghi lộ). */
export async function completePasswordReset(
  newPassword: string,
): Promise<{ otherDevicesSignedOut: boolean }> {
  if (newPassword.length < 6) throw new DataError('Mật khẩu phải có ít nhất 6 ký tự.');
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw toAuthDataError(error);
  const { error: signOutError } = await supabase.auth.signOut({ scope: 'global' });
  if (signOutError) {
    await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
    return { otherDevicesSignedOut: false };
  }
  return { otherDevicesSignedOut: true };
}

/**
 * Đăng nhập (hoặc tạo tài khoản) bằng Google — chuyển cả trang sang Google rồi
 * quay về /sign-in?oauth=1. Client bật detectSessionInUrl nên supabase-js tự đổi
 * ?code ra phiên khi trang tải lại; guard GuestOnly đưa về `next` (giữ link mời
 * /join?code=… qua vòng đăng nhập). Liên kết tài khoản cùng email do Supabase tự
 * làm; người mới chưa có mật khẩu → guard đưa tới /set-password.
 *
 * Trang đích phải có trong Redirect URLs của Supabase (https://divvyup.vn/**).
 */
export async function signInWithGoogle(remember: boolean, next: string | null): Promise<void> {
  setRememberSession(remember);
  const query = new URLSearchParams({ oauth: '1' });
  if (next) query.set('next', next);
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: absoluteUrl(`${routes.signIn()}?${query.toString()}`),
      // Luôn hiện bộ chọn tài khoản: người vừa huỷ ở trang đặt mật khẩu phải
      // đổi được tài khoản Google.
      queryParams: { prompt: 'select_account' },
    },
  });
  if (error) throw toAuthDataError(error);
  // Thành công: trình duyệt đang chuyển sang Google, trang này sắp bị thay.
}

/** Đặt mật khẩu lần đầu cho tài khoản tạo qua Google — KHÔNG đăng xuất. */
export async function setInitialPassword(password: string): Promise<void> {
  if (password.length < 6) throw new DataError('Mật khẩu phải có ít nhất 6 ký tự.');
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw toAuthDataError(error);
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  // Máy chủ lỗi (mất mạng, token hết hạn) vẫn phải xoá phiên trên máy.
  if (error) await supabase.auth.signOut({ scope: 'local' });
}
