import { ActivityIndicator, Pressable, View } from 'react-native';

import type { LucideIcon } from './icons';

type Variant = 'ghost' | 'primary' | 'danger' | 'onImage';

interface IconButtonProps {
  readonly icon: LucideIcon;
  /** BẮT BUỘC: icon không có chữ, nên trình đọc màn hình chỉ có nhãn này để đọc. */
  readonly label: string;
  readonly onPress: () => void;
  readonly variant?: Variant;
  readonly disabled?: boolean;
  readonly busy?: boolean;
}

const CONTAINER: Record<Variant, string> = {
  ghost: '',
  primary: 'bg-primary',
  danger: '',
  onImage: '',
};

const ICON_CLASS: Record<Variant, string> = {
  ghost: 'text-foreground',
  primary: 'text-primary-foreground',
  danger: 'text-negative',
  onImage: 'text-white',
};

/**
 * Nút chỉ có icon.
 *
 * Vùng chạm luôn 44x44pt kể cả khi icon chỉ 22pt — icon nhỏ mà vùng chạm cũng
 * nhỏ thì bấm trượt liên tục trên điện thoại.
 */
export function IconButton({
  icon: Icon,
  label,
  onPress,
  variant = 'ghost',
  disabled = false,
  busy = false,
}: IconButtonProps) {
  const inactive = disabled || busy;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: inactive, busy }}
      disabled={inactive}
      onPress={onPress}
      hitSlop={4}
      className={`h-11 w-11 items-center justify-center rounded-full active:opacity-60 ${
        CONTAINER[variant]
      } ${inactive ? 'opacity-40' : ''}`}>
      {busy ? (
        <View accessibilityElementsHidden>
          <ActivityIndicator size="small" />
        </View>
      ) : (
        <Icon
          size={22}
          // Nét dày hơn trên ảnh để không bị nhoè vào chi tiết của ảnh nền.
          strokeWidth={variant === 'onImage' ? 2.5 : 2}
          className={ICON_CLASS[variant]}
        />
      )}
    </Pressable>
  );
}
