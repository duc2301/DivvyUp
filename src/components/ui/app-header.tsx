import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

interface AppHeaderProps {
  readonly title: string;
  readonly subtitle?: string;
  readonly showBack?: boolean;
  readonly right?: ReactNode;
}

/**
 * Header tự vẽ thay cho header mặc định của Stack.
 *
 * Lý do: header của react-navigation nhận màu qua đối tượng JS, không đọc được
 * CSS variable trong global.css. Dùng nó đồng nghĩa với việc khai màu ở hai
 * nơi — đúng thứ AGENTS.md mục 2 cấm. Tự vẽ thì toàn bộ màu vẫn chỉ nằm trong
 * bảng token duy nhất.
 */
export function AppHeader({ title, subtitle, showBack = false, right }: AppHeaderProps) {
  const router = useRouter();

  return (
    <View className="px-4 pb-2 pt-2">
      <View className="min-h-11 flex-row items-center justify-between">
        {showBack ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Quay lại"
            onPress={() => router.back()}
            // Không nền, không viền: nút quay lại là thao tác phụ, khoanh tròn
            // nó lên thành ra hút mắt hơn cả tiêu đề. Vùng chạm vẫn giữ 44pt.
            className="h-11 w-11 items-center justify-start">
            <Text className="text-2xl leading-none text-foreground">←</Text>
          </Pressable>
        ) : (
          <View className="h-11 w-11" />
        )}

        <View className="min-w-0 flex-1" />

        {right ?? <View className="h-11 w-11" />}
      </View>

      <Text className="mt-2 text-center font-display text-4xl leading-tight text-foreground">
        {title}
      </Text>
      {subtitle ? (
        <Text className="mt-1 text-center text-sm text-muted-foreground">{subtitle}</Text>
      ) : null}
    </View>
  );
}

/** Nút tròn dùng ở góc phải header, hợp với nút quay lại bên trái. */
export function HeaderAction({
  label,
  accessibilityLabel,
  onPress,
  disabled = false,
}: {
  readonly label: string;
  readonly accessibilityLabel: string;
  readonly onPress: () => void;
  readonly disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      className={`min-h-11 items-center justify-center rounded-full bg-card px-4 ${
        disabled ? 'opacity-50' : ''
      }`}>
      <Text className="text-sm font-medium text-foreground">{label}</Text>
    </Pressable>
  );
}
