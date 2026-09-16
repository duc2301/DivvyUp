import { ActivityIndicator, Pressable, Text, View } from 'react-native';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

interface ButtonProps {
  readonly label: string;
  readonly onPress: () => void;
  readonly variant?: Variant;
  readonly disabled?: boolean;
  readonly busy?: boolean;
  readonly accessibilityLabel?: string;
}

const CONTAINER: Record<Variant, string> = {
  primary: 'bg-primary',
  secondary: 'bg-card border border-border',
  ghost: 'bg-transparent',
  danger: 'bg-negative',
};

const LABEL: Record<Variant, string> = {
  primary: 'text-primary-foreground',
  secondary: 'text-foreground',
  ghost: 'text-muted-foreground',
  danger: 'text-white',
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  busy = false,
  accessibilityLabel,
}: ButtonProps) {
  const inactive = disabled || busy;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: inactive, busy }}
      disabled={inactive}
      onPress={onPress}
      // rounded-full: nút viên thuốc, hợp ngôn ngữ thẻ mềm của toàn app.
      className={`min-h-14 flex-row items-center justify-center gap-2 rounded-full px-5 ${
        CONTAINER[variant]
      } ${inactive ? 'opacity-40' : ''}`}>
      {busy ? (
        <View accessibilityElementsHidden>
          <ActivityIndicator size="small" />
        </View>
      ) : null}
      <Text className={`text-base font-semibold ${LABEL[variant]}`}>{label}</Text>
    </Pressable>
  );
}
