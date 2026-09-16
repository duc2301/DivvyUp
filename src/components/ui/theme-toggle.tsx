import { Pressable } from 'react-native';

import { useTheme } from '@/features/theme/theme-context';

import { Moon, Sun } from './icons';

/**
 * Nút đảo sáng/tối.
 *
 * Biểu tượng hiển thị chế độ SẼ chuyển sang khi bấm, không phải chế độ hiện
 * tại — đang sáng thì hiện mặt trăng. Cách này khớp với nhãn trợ năng và với
 * kỳ vọng thông thường của người dùng về một công tắc.
 */
export function ThemeToggle() {
  const { effective, toggle } = useTheme();
  const goingDark = effective === 'light';
  const Icon = goingDark ? Moon : Sun;

  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: effective === 'dark' }}
      accessibilityLabel={goingDark ? 'Chuyển sang chế độ tối' : 'Chuyển sang chế độ sáng'}
      onPress={toggle}
      className="h-11 w-11 items-center justify-center rounded-full active:opacity-60">
      <Icon size={22} className="text-foreground" />
    </Pressable>
  );
}
