import type { ReactNode } from 'react';
import { createContext, useContext, useEffect, useState } from 'react';

/**
 * Sáng / tối / theo hệ thống. Lưu lựa chọn ở localStorage và gắn class 'dark'
 * lên <html> — tailwind.config.js đặt darkMode: 'class'. index.html có đoạn
 * script nhỏ gắn class trước lần vẽ đầu (cùng khoá THEME_STORAGE_KEY).
 */

export type ThemePreference = 'light' | 'dark' | 'system';
export type EffectiveTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'divvyup_theme';

interface ThemeContextValue {
  readonly preference: ThemePreference;
  readonly effective: EffectiveTheme;
  readonly setPreference: (next: ThemePreference) => void;
  /** Đảo sáng ↔ tối (bỏ chế độ hệ thống). */
  readonly toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readPreference(): ThemePreference {
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

function systemTheme(): EffectiveTheme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function ThemeProvider({ children }: { readonly children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(readPreference);
  const [system, setSystem] = useState<EffectiveTheme>(systemTheme);

  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (): void => setSystem(query.matches ? 'dark' : 'light');
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  const effective: EffectiveTheme = preference === 'system' ? system : preference;

  useEffect(() => {
    document.documentElement.classList.toggle('dark', effective === 'dark');
  }, [effective]);

  const setPreference = (next: ThemePreference): void => {
    setPreferenceState(next);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Trình duyệt chặn lưu trữ: vẫn đổi được trong phiên này.
    }
  };

  const value: ThemeContextValue = {
    preference,
    effective,
    setPreference,
    toggle: () => setPreference(effective === 'dark' ? 'light' : 'dark'),
  };

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme phải nằm trong <ThemeProvider>.');
  return value;
}
