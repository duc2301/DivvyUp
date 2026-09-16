import AsyncStorage from '@react-native-async-storage/async-storage';
import type { SupportedStorage } from '@supabase/supabase-js';
import { createClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

import type { Database } from './database.types';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.EXPO_PUBLIC_SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  // Ném ngay lúc nạp module thay vì để app chạy tiếp rồi lỗi mơ hồ ở tầng mạng.
  throw new Error(
    'Thiếu EXPO_PUBLIC_SUPABASE_URL hoặc EXPO_PUBLIC_SUPABASE_KEY. ' +
      'Kiểm tra .env.local, và nhớ khởi động lại Metro với --clear sau khi sửa.',
  );
}

const isWeb = Platform.OS === 'web';

// ─── "Ghi nhớ đăng nhập" ─────────────────────────────────────────────────────
//
// Không ghi nhớ = phiên chỉ sống trong kho TẠM:
//   - native: bộ nhớ RAM, mất khi hệ điều hành đóng hẳn app
//   - web:    sessionStorage, mất khi đóng tab
// Có ghi nhớ = kho BỀN (AsyncStorage / localStorage), còn sau khi mở lại app.
//
// Vì sao phải đổi kho chứ không chỉ "đăng xuất khi mở lại app": lúc mở app,
// supabase-js đọc phiên từ kho NGAY khi tạo client — trước cả khi React kịp
// render. Đăng xuất sau đó thì đã kịp gọi mạng bằng phiên cũ, và màn hình chính
// chớp lên một cái rồi mới bật về đăng nhập.

const REMEMBER_KEY = 'divvyup_remember_me';

// Web xuất tĩnh (web.output = static) chạy module này trong Node lúc build —
// ở đó không có window, đụng vào localStorage là build gãy.
const hasWindow = typeof window !== 'undefined';

const memory = new Map<string, string>();

const temporary: SupportedStorage =
  isWeb && hasWindow
    ? {
        getItem: (key) => window.sessionStorage.getItem(key),
        setItem: (key, value) => window.sessionStorage.setItem(key, value),
        removeItem: (key) => window.sessionStorage.removeItem(key),
      }
    : {
        getItem: (key) => memory.get(key) ?? null,
        setItem: (key, value) => {
          memory.set(key, value);
        },
        removeItem: (key) => {
          memory.delete(key);
        },
      };

// AsyncStorage bản web chính là localStorage, nên dùng chung được cho cả hai.
const durable: SupportedStorage = {
  getItem: (key) => (hasWindow || !isWeb ? AsyncStorage.getItem(key) : null),
  setItem: (key, value) => (hasWindow || !isWeb ? AsyncStorage.setItem(key, value) : undefined),
  removeItem: (key) => (hasWindow || !isWeb ? AsyncStorage.removeItem(key) : undefined),
};

let remember = true;

// Cờ phải đọc xong TRƯỚC lần getItem đầu tiên của supabase-js, nếu không nó sẽ
// tìm phiên nhầm kho. Mọi thao tác kho đều chờ promise này.
const rememberLoaded: Promise<void> = (async () => {
  try {
    const stored = await durable.getItem(REMEMBER_KEY);
    remember = stored !== 'false';
  } catch {
    remember = true;
  }
})();

const authStorage: SupportedStorage = {
  async getItem(key) {
    await rememberLoaded;
    return remember ? durable.getItem(key) : temporary.getItem(key);
  },
  async setItem(key, value) {
    await rememberLoaded;
    if (remember) {
      await durable.setItem(key, value);
      await temporary.removeItem(key);
    } else {
      await temporary.setItem(key, value);
      // Xoá bản bền nếu còn sót từ lần đăng nhập trước có ghi nhớ — không thì
      // tắt ghi nhớ xong, mở lại app vẫn vào thẳng được.
      await durable.removeItem(key);
    }
  },
  async removeItem(key) {
    await rememberLoaded;
    await Promise.all([durable.removeItem(key), temporary.removeItem(key)]);
  },
};

/** Gọi TRƯỚC khi đăng nhập: quyết định phiên sắp tạo được lưu vào kho nào. */
export async function setRememberSession(value: boolean): Promise<void> {
  await rememberLoaded;
  remember = value;
  try {
    await durable.setItem(REMEMBER_KEY, String(value));
  } catch {
    // Không lưu được cờ thì lần mở sau quay về mặc định (ghi nhớ) — chấp nhận
    // được, không đáng chặn người dùng đăng nhập.
  }
}

export async function getRememberSession(): Promise<boolean> {
  await rememberLoaded;
  return remember;
}

export const supabase = createClient<Database>(supabaseUrl, supabaseKey, {
  auth: {
    storage: authStorage,
    persistSession: true,
    autoRefreshToken: true,
    // TẮT cả trên web. Link xác nhận email và link đặt lại mật khẩu đều mang
    // token trên URL; để supabase-js tự nuốt thì nó đăng nhập luôn, trong khi
    // luồng của app là: xác nhận xong → về màn đăng nhập báo thành công, và
    // link đặt lại mật khẩu → màn nhập mật khẩu mới. Hai màn đó tự đọc URL.
    detectSessionInUrl: false,
  },
});

// Trên native, supabase-js không tự biết app bị đưa xuống nền. Không dừng bộ
// làm mới token thì nó vẫn hẹn giờ chạy nền và ném lỗi mạng vô ích.
if (!isWeb) {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      void supabase.auth.startAutoRefresh();
    } else {
      void supabase.auth.stopAutoRefresh();
    }
  });
}
