import { Image } from 'expo-image';
import { Text, View } from 'react-native';

type Size = 'sm' | 'md' | 'lg';

interface AvatarProps {
  readonly name: string;
  readonly uri?: string | null;
  readonly size?: Size;
  /**
   * Chỗ chưa có ai nhận (người được thêm tên nhưng chưa vào app): hiện chữ cái
   * đầu trên nền nhạt, để phân biệt ngay với người đã có tài khoản.
   */
  readonly pending?: boolean;
}

const DIMENSION: Record<Size, number> = { sm: 32, md: 40, lg: 96 };
const TEXT: Record<Size, string> = { sm: 'text-xs', md: 'text-sm', lg: 'text-3xl' };

/** Chữ cái đầu của TỪ CUỐI — tên tiếng Việt gọi theo tên, không theo họ. */
function initialOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const last = words[words.length - 1] ?? '?';
  return last.charAt(0).toUpperCase();
}

export function Avatar({ name, uri, size = 'md', pending = false }: AvatarProps) {
  const dimension = DIMENSION[size];

  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={{ width: dimension, height: dimension, borderRadius: dimension / 2 }}
        contentFit="cover"
        transition={150}
        accessibilityLabel={`Ảnh đại diện của ${name}`}
      />
    );
  }

  return (
    <View
      accessible
      accessibilityLabel={`Ảnh đại diện của ${name}`}
      style={{ width: dimension, height: dimension, borderRadius: dimension / 2 }}
      className={`items-center justify-center ${
        pending ? 'border border-dashed border-border bg-muted' : 'bg-accent'
      }`}>
      <Text
        className={`${TEXT[size]} font-semibold ${
          pending ? 'text-muted-foreground' : 'text-accent-foreground'
        }`}>
        {initialOf(name)}
      </Text>
    </View>
  );
}
