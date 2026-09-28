/**
 * Tài khoản của người đang đăng nhập — chỉ có ở tài khoản thật (khách không
 * gọi), nên không đi qua manager.ts, giống profile.ts. Web dùng lại qua @core.
 */

import type { NeedsPasswordCheck } from '@/lib/auth/password-gate';
import { gateFromServer, providersMayNeedPassword } from '@/lib/auth/password-gate';
import { supabase } from '@/lib/supabase/client';

/** Chờ máy chủ tối đa chừng này — màn app bị che trong lúc chờ. */
const NEEDS_PASSWORD_TIMEOUT_MS = 6000;

/**
 * Người dùng có phải đặt mật khẩu trước khi vào app không (mới tạo qua Google).
 * `providers` lấy bằng gateProviders(user). Chỉ dùng mật khẩu → chắc chắn
 * false, không gọi mạng. Lỗi hoặc quá giờ → tạm false (không chặn nhầm người
 * đã có mật khẩu) nhưng `certain: false` để hook kiểm lại khi app quay lại.
 */
export async function fetchNeedsPassword(providers: readonly string[]): Promise<NeedsPasswordCheck> {
  if (!providersMayNeedPassword(providers)) return { value: false, certain: true };
  const check = async (): Promise<NeedsPasswordCheck> => {
    const { data, error } = await supabase.rpc('account_needs_password');
    if (error) return { value: false, certain: false };
    return { value: gateFromServer({ ok: true, value: data }), certain: true };
  };
  // Mạng chập chờn làm request treo (client không có timeout): hết giờ thì
  // cho qua như khi lỗi — tài khoản đã liên kết Google hỏi ở MỖI lần mở app,
  // không được kẹt ở màn chờ. Lần mở sau kiểm lại.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<NeedsPasswordCheck>((resolve) => {
    timer = setTimeout(() => resolve({ value: false, certain: false }), NEEDS_PASSWORD_TIMEOUT_MS);
  });
  try {
    return await Promise.race([check(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
