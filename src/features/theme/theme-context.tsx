import AsyncStorage from '@react-native-async-storage/async-storage';
import { useColorScheme } from 'nativewind';
import type { ReactNode } from 'react';
import { createContext, useContext, useEffect, useState } from 'react';

/**
 * Quản lý chế độ sáng/tối.
 *
 * Ba trạng thái, không phải hai: 'system' nghĩa là đi theo cài đặt của máy.
 * Gộp thành công tắc hai nấc sẽ mất khả năng đó — người đã đặt máy tự chuyển
 * theo giờ sẽ bị khoá cứng vào một chế độ ngay lần đầu chạm vào nút.
 *
 * Dùng useColorScheme của NativeWind chứ KHÔNG dùng của react-native: chỉ bản
 * NativeWind mới gắn class .dark vào root, mà bảng màu tối trong global.css
 * nằm dưới selector đó. Bản của react-native chỉ đọc cài đặt máy, không ghi
 * đè được.
 */

export type ThemePreference = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'divvyup_theme_preference';

interface ThemeState {
  /** Lựa chọn của người dùng. */
  readonly preference: ThemePreference;
  /** Chế độ đang thực sự hiển thị, sau khi đã giải quyết 'system'. */
  readonly effective: 'light' | 'dark';
  readonly setPreference: (next: ThemePreference) => void;
  /** Đảo sáng <-> tối. Đang ở 'system' thì đảo so với chế độ đang hiện. */
  readonly toggle: () => void;
}

const ThemeContext = createContext<ThemeState | null>(null);

function isPreference(value: string | null): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}

export function ThemeProvider({ children }: { readonly children: ReactNode }) {
  const { colorScheme, setColorScheme } = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>('system');

  // Khôi phục lựa chọn đã lưu. Chạy một lần lúc mở app.
  useEffect(() => {
    let cancelled = false;

    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (cancelled || !isPreference(stored)) return;
        setPreferenceState(stored);
        setColorScheme(stored);
      })
      .catch(() => {
        // Đọc lỗi thì cứ để mặc định theo hệ thống, không cần báo gì.
      });

    return () => {
      cancelled = true;
    };
  }, [setColorScheme]);

  const setPreference = (next: ThemePreference): void => {
    setPreferenceState(next);
    setColorScheme(next);
    void AsyncStorage.setItem(STORAGE_KEY, next);
  };

  const effective: 'light' | 'dark' = colorScheme === 'dark' ? 'dark' : 'light';

  return (
    <ThemeContext.Provider
      value={{
        preference,
        effective,
        setPreference,
        toggle: () => setPreference(effective === 'dark' ? 'light' : 'dark'),
      }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeState {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme phải nằm trong ThemeProvider');
  }
  return context;
}
