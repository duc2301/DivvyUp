/** Cổng "Đặt mật khẩu" (tài khoản mới qua Google) — dùng chung lõi với mobile. */
export type { NeedsPasswordResult } from '@core/lib/auth/password-gate';
export { currentNeedsPassword, gateProviders } from '@core/lib/auth/password-gate';
export { fetchNeedsPassword } from '@core/lib/data/account';
