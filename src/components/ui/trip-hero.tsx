import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Linking, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface TripHeroProps {
  readonly imageUrl: string | null;
  readonly imageCredit: string | null;
  readonly imageLink: string | null;
  readonly onEditPlace: () => void;
}

const HERO_HEIGHT = 280;

/**
 * Ảnh bìa toàn chiều rộng, nút quay lại và nút đổi địa điểm nổi lên trên.
 *
 * Chưa chọn địa điểm thì dùng ảnh phong cảnh có sẵn trong bộ asset, phủ lớp đen
 * mờ rồi đặt lời mời chọn lên trên. Trước đây chỗ này là một mảng màu phẳng —
 * nhìn như phần chưa làm xong chứ không như một trạng thái có chủ đích.
 *
 * Lớp phủ KHÔNG chỉ để cho đẹp: nó là thứ bảo đảm chữ trắng luôn đọc được, bất
 * kể ảnh nền sáng hay tối. Thay ảnh khác cũng không phải chỉnh lại màu chữ.
 */
export function TripHero({ imageUrl, imageCredit, imageLink, onEditPlace }: TripHeroProps) {
  const router = useRouter();
  // Nút phải nằm dưới tai thỏ. Header mặc định của Stack đã tắt nên không có ai
  // lo phần này hộ.
  const insets = useSafeAreaInsets();
  const hasCover = imageUrl !== null;

  return (
    <View style={{ height: HERO_HEIGHT }} className="w-full overflow-hidden bg-muted">
      <Image
        source={hasCover ? { uri: imageUrl } : require('@/assets/images/trip-placeholder.jpg')}
        style={{ width: '100%', height: HERO_HEIGHT }}
        contentFit="cover"
        transition={200}
      />

      {!hasCover ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Chọn địa điểm cho chuyến đi"
          onPress={onEditPlace}
          className="absolute inset-0 items-center justify-center gap-2 bg-black/55 px-6">
          <Text className="text-2xl">📍</Text>
          <Text className="text-center text-lg font-semibold text-white">
            Chọn địa điểm cho chuyến đi
          </Text>
          <Text className="text-center text-xs text-white/75">
            Ảnh bìa sẽ tự gợi ý theo nơi bạn chọn
          </Text>
        </Pressable>
      ) : null}

      <View
        style={{ top: insets.top + 8 }}
        className="absolute left-4 right-4 flex-row items-center justify-between">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Quay lại"
          onPress={() => router.back()}
          className="h-11 w-11 items-center justify-center rounded-full bg-card">
          <Text className="text-lg text-foreground">←</Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={hasCover ? 'Đổi địa điểm và ảnh bìa' : 'Chọn địa điểm'}
          onPress={onEditPlace}
          className="h-11 w-11 items-center justify-center rounded-full bg-card">
          <Text className="text-base">📍</Text>
        </Pressable>
      </View>

      {/* Unsplash BẮT BUỘC ghi công tác giả kèm link. Đây là điều kiện dùng
          miễn phí, không phải phần trang trí bỏ được. */}
      {hasCover && imageCredit ? (
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={`Xem ảnh gốc của ${imageCredit}`}
          disabled={!imageLink}
          onPress={() => imageLink && void Linking.openURL(imageLink)}
          className="absolute bottom-12 right-3 rounded-full bg-black/45 px-2 py-1">
          <Text className="text-[10px] text-white">Ảnh: {imageCredit}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
