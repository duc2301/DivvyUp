import type { AuthRedirect } from '@core/features/auth/auth-redirect';
import { describeRedirectError, parseAuthRedirect } from '@core/features/auth/auth-redirect';

import { supabase } from '@/shared/api';
import { DataError } from '@/shared/lib/async';

import { toAuthDataError } from './auth-actions';

/**
 * Link đặt lại mật khẩu trên web.
 *
 * Client web bật detectSessionInUrl: ngay khi trang tải, supabase-js tự đổi
 * ?code=… ra phiên rồi XOÁ code khỏi URL, và phát sự kiện PASSWORD_RECOVERY
 * nếu đó là luồng đặt lại mật khẩu. Vì vậy:
 *  - URL gốc được chụp lại NGAY khi module này nạp (trước lần vẽ đầu);
 *  - sự kiện PASSWORD_RECOVERY được nghe từ tầng module, không đợi React mount.
 */
const initialRedirect: AuthRedirect | null = parseAuthRedirect(window.location.href);
let recoverySeen = false;
const waiters = new Set<() => void>();

supabase.auth.onAuthStateChange((event) => {
  if (event !== 'PASSWORD_RECOVERY') return;
  recoverySeen = true;
  for (const wake of waiters) wake();
  waiters.clear();
});

function waitForRecoveryEvent(timeoutMs: number): Promise<boolean> {
  if (recoverySeen) return Promise.resolve(true);
  return new Promise((resolve) => {
    const wake = (): void => {
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      waiters.delete(wake);
      resolve(recoverySeen);
    }, timeoutMs);
    waiters.add(wake);
  });
}

/**
 * Xác minh trang đặt lại mật khẩu được mở từ ĐÚNG link khôi phục. Không mở ô
 * đổi mật khẩu chỉ vì máy đang đăng nhập sẵn — sẽ đổi nhầm tài khoản.
 * Ném DataError với câu tiếng Việt khi link hỏng/hết hạn.
 */
export async function verifyPasswordRecovery(): Promise<void> {
  if (initialRedirect?.errorCode) {
    throw new DataError(describeRedirectError(initialRedirect), initialRedirect.errorCode);
  }
  const { error } = await supabase.auth.initialize();
  if (error) throw toAuthDataError(error);

  if (initialRedirect?.code || initialRedirect?.accessToken) {
    if (await waitForRecoveryEvent(3000)) return;
    // Mã hợp lệ nhưng thuộc luồng khác (vd link xác nhận đăng ký).
    await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
    throw new DataError('Đây không phải link đặt lại mật khẩu. Hãy yêu cầu gửi lại email.');
  }
  if (recoverySeen) return;
  throw new DataError(
    'Link đặt lại mật khẩu không hợp lệ hoặc đã hết hạn. Hãy yêu cầu gửi lại email mới.',
  );
}

/** Lỗi gắn trên URL khi quay về từ link xác nhận đăng ký (?confirmed=1&error=…). */
export function initialRedirectError(): string | null {
  return initialRedirect?.errorCode ? describeRedirectError(initialRedirect) : null;
}
