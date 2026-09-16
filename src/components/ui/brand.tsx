import { Image } from 'expo-image';
import { View } from 'react-native';

import { useTheme } from '@/features/theme/theme-context';

/**
 * Logo dùng trong app.
 *
 * Mọi file ở đây do scripts/build-brand-assets.mjs sinh ra từ vector gốc
 * assets/brand/mark.svg và assets/brand/lockup.svg — cùng nguồn với icon ngoài
 * màn hình chính và ảnh splash. Nhờ vậy logo ở ba nơi luôn là một.
 *
 * Xuất ở 3x (1320px) rồi thu nhỏ khi hiển thị, nên nét trên mọi mật độ màn
 * hình. Không dùng react-native-svg trực tiếp vì file lockup có bộ lọc đổ bóng
 * mà thư viện đó dựng không giống bản thiết kế.
 */

const LOCKUP_RATIO = 163 / 440;

export function BrandMark({ size = 36 }: { readonly size?: number }) {
  return (
    <Image
      source={require('@/assets/images/brand-mark.png')}
      style={{ width: size, height: size }}
      contentFit="contain"
      // Logo là hình tĩnh, không cần hiệu ứng hiện dần.
      transition={0}
    />
  );
}

/**
 * Logo ngang. Tự đổi giữa bản chữ mực và bản chữ sáng theo chế độ màu —
 * bản mực đặt lên nền tối thì không đọc được.
 *
 * Đọc từ useTheme chứ KHÔNG từ useColorScheme của react-native: chỉ context
 * này mới biết chế độ người dùng đã ghi đè bằng nút bật tắt. Dùng bản của
 * react-native thì logo sẽ lệch pha với phần còn lại của giao diện.
 */
export function BrandLockup({ width = 240 }: { readonly width?: number }) {
  const { effective } = useTheme();
  const isDark = effective === 'dark';

  return (
    <View accessibilityRole="image" accessibilityLabel="Divvy up">
      <Image
        source={
          isDark
            ? require('@/assets/images/brand-lockup-dark.png')
            : require('@/assets/images/brand-lockup-light.png')
        }
        style={{ width, height: Math.round(width * LOCKUP_RATIO) }}
        contentFit="contain"
        transition={0}
      />
    </View>
  );
}
