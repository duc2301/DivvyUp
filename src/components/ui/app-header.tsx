import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { Text, View } from 'react-native';

import { IconButton } from './icon-button';
import { ChevronLeft } from './icons';

interface AppHeaderProps {
  readonly title: string;
  readonly subtitle?: string;
  readonly showBack?: boolean;
  /** Các nút hành động ở góc trên bên phải — thường là IconButton. */
  readonly right?: ReactNode;
  /**
   * `center` (mặc định): hàng nút ở trên, tiêu đề lớn căn giữa bên dưới.
   * `inline`: tiêu đề nằm bên trái, CÙNG HÀNG với các nút — dùng cho màn gốc
   * không có nút quay lại, để nút hành động không bị đẩy xuống cuối danh sách.
   */
  readonly layout?: 'center' | 'inline';
}

/**
 * Header tự vẽ thay cho header mặc định của Stack.
 *
 * Lý do: header của react-navigation nhận màu qua đối tượng JS, không đọc được
 * CSS variable trong global.css. Dùng nó đồng nghĩa với việc khai màu ở hai
 * nơi — đúng thứ AGENTS.md mục 2 cấm. Tự vẽ thì toàn bộ màu vẫn chỉ nằm trong
 * bảng token duy nhất.
 */
export function AppHeader({
  title,
  subtitle,
  showBack = false,
  right,
  layout = 'center',
}: AppHeaderProps) {
  const router = useRouter();

  const back = showBack ? (
    <IconButton
      icon={ChevronLeft}
      label="Quay lại"
      // Mở thẳng bằng deep link thì không có màn nào phía sau để back() về.
      onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
    />
  ) : null;

  if (layout === 'inline') {
    return (
      <View className="px-4 pb-2 pt-2">
        <View className="min-h-11 flex-row items-center gap-2">
          {back}
          <View className="min-w-0 flex-1">
            {/* Không cắt bằng numberOfLines: trên máy 320dp hoặc khi bật cỡ chữ
                lớn, thà xuống dòng còn hơn tiêu đề màn chính thành "My tri…". */}
            <Text className="font-display text-3xl leading-tight text-foreground">
              {title}
            </Text>
          </View>
          {right ? <View className="flex-row items-center">{right}</View> : null}
        </View>
        {subtitle ? <Text className="text-sm text-muted-foreground">{subtitle}</Text> : null}
      </View>
    );
  }

  return (
    <View className="px-4 pb-2 pt-2">
      <View className="min-h-11 flex-row items-center justify-between">
        {back ?? <View className="h-11 w-11" />}
        <View className="min-w-0 flex-1" />
        {right ? <View className="flex-row items-center">{right}</View> : <View className="h-11 w-11" />}
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
