/**
 * Client Supabase của bản web — thay cho src/lib/supabase/client.ts của mobile
 * (xem plugin alias trong vite.config.ts). Cùng tên export `supabase` và
 * `setRememberSession` để tầng dữ liệu dùng chung import được nguyên văn.
 *
 * "Ghi nhớ đăng nhập": có → localStorage (còn sau khi đóng trình duyệt);
 * không → sessionStorage (mất khi đóng tab). Cờ lưu ở localStorage.
 */

import type { SupportedStorage } from '@supabase/supabase-js';
import { createClient } from '@supabase/supabase-js';

import type { Database } from '@core/lib/supabase/database.types';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseKey = import.meta.env.VITE_SUPABASE_KEY as string | undefined;

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    'Thiếu VITE_SUPABASE_URL hoặc VITE_SUPABASE_KEY. Xem web/.env.example và cấu hình biến môi trường trên Vercel.',
  );
}

const REMEMBER_KEY = 'divvyup_remember_me';

function readRemember(): boolean {
  try {
    return window.localStorage.getItem(REMEMBER_KEY) !== 'false';
  } catch {
    return true;
  }
}

let remember = readRemember();

/** Kho đang dùng cho phiên đăng nhập, đổi theo cờ ghi nhớ. */
function sessionStore(): Storage {
  return remember ? window.localStorage : window.sessionStorage;
}

const storage: SupportedStorage = {
  getItem: (key) => {
    // Mã xác minh PKCE (quên mật khẩu, xác nhận email) luôn ở kho bền: người
    // dùng quay lại từ hộp thư có thể ở tab khác.
    if (key.endsWith('-code-verifier')) return window.localStorage.getItem(key);
    return sessionStore().getItem(key);
  },
  setItem: (key, value) => {
    if (key.endsWith('-code-verifier')) {
      window.localStorage.setItem(key, value);
      return;
    }
    sessionStore().setItem(key, value);
  },
  removeItem: (key) => {
    window.localStorage.removeItem(key);
    window.sessionStorage.removeItem(key);
  },
};

export const supabase = createClient<Database>(supabaseUrl, supabaseKey, {
  auth: {
    storage,
    persistSession: true,
    autoRefreshToken: true,
    // Web nhận ?code=... ngay trên URL sau khi bấm link trong email.
    detectSessionInUrl: true,
    flowType: 'pkce',
  },
});

/** Lựa chọn "ghi nhớ đăng nhập" lần trước — để màn đăng nhập tick sẵn. */
export function getRememberSession(): boolean {
  return remember;
}

/** Gọi TRƯỚC khi đăng nhập để chọn kho lưu phiên. */
export function setRememberSession(value: boolean): void {
  remember = value;
  try {
    window.localStorage.setItem(REMEMBER_KEY, value ? 'true' : 'false');
  } catch {
    // Trình duyệt chặn lưu trữ (chế độ riêng tư): vẫn đăng nhập được trong phiên này.
  }
}
