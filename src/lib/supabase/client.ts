import AsyncStorage from '@react-native-async-storage/async-storage';
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

export const supabase = createClient<Database>(supabaseUrl, supabaseKey, {
  auth: {
    // Trên web để supabase-js tự dùng localStorage; trên native phải chỉ định
    // kho lưu trữ, nếu không phiên đăng nhập mất sau mỗi lần mở lại app.
    storage: isWeb ? undefined : AsyncStorage,
    persistSession: true,
    autoRefreshToken: true,
    // Chỉ web mới có OAuth redirect mang token trên URL.
    detectSessionInUrl: isWeb,
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
