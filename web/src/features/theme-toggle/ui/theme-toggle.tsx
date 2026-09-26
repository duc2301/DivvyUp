import { Monitor, Moon, Sun } from 'lucide-react';

import type { ThemePreference } from '@/shared/lib/theme';
import { useTheme } from '@/shared/lib/theme';
import { IconButton } from '@/shared/ui';

const NEXT: Record<ThemePreference, ThemePreference> = { system: 'light', light: 'dark', dark: 'system' };
const LABEL: Record<ThemePreference, string> = {
  system: 'Giao diện: theo hệ thống',
  light: 'Giao diện: sáng',
  dark: 'Giao diện: tối',
};

/** Nút xoay vòng hệ thống → sáng → tối. */
export function ThemeToggle() {
  const { preference, setPreference } = useTheme();
  const icon = preference === 'system' ? Monitor : preference === 'light' ? Sun : Moon;
  return (
    <IconButton
      icon={icon}
      label={`${LABEL[preference]}. Chạm để đổi`}
      onClick={() => setPreference(NEXT[preference])}
    />
  );
}

/** Dòng menu: đảo sáng ↔ tối (giống mục "Chế độ tối" trong menu tài khoản mobile). */
export function ThemeMenuItem({ onDone }: { readonly onDone?: () => void }) {
  const { effective, toggle } = useTheme();
  const Icon = effective === 'light' ? Moon : Sun;
  return (
    <button
      type="button"
      role="menuitem"
      onClick={() => {
        toggle();
        onDone?.();
      }}
      className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-base text-foreground hover:bg-muted active:bg-muted">
      <Icon size={20} aria-hidden />
      {effective === 'light' ? 'Chế độ tối' : 'Chế độ sáng'}
    </button>
  );
}
