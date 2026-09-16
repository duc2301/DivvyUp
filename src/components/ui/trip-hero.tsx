import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { Linking, Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { TripCoverImage } from '@/lib/data/trips';

interface TripHeroProps {
  readonly images: readonly TripCoverImage[];
  readonly initialIndex: number;
  readonly onEditPlace: () => void;
  /** Gọi khi người dùng dừng lướt ở một ảnh khác. */
  readonly onChangeIndex: (index: number) => void;
}

const HERO_HEIGHT = 280;

/**
 * Bóng đổ cho chữ trắng trên ảnh.
 *
 * Nút quay lại không có nền, nên chữ phải tự lo phần tương phản: ảnh bìa có thể
 * là trời trắng xoá hay tuyết, lúc đó mũi tên trắng trơn sẽ biến mất hoàn toàn.
 */
const ON_IMAGE_SHADOW = {
  textShadowColor: 'rgba(0,0,0,0.55)',
  textShadowOffset: { width: 0, height: 1 },
  textShadowRadius: 6,
} as const;

/**
 * Ảnh bìa toàn chiều rộng, lướt ngang qua bộ ảnh đã lưu của chuyến đi.
 *
 * Dừng ở ảnh nào thì ảnh đó thành ảnh hiện tại và được ghi lại — chính nó sẽ
 * làm nền cho thẻ chuyến đi ở màn danh sách.
 *
 * Chưa chọn địa điểm thì dùng ảnh phong cảnh có sẵn, phủ lớp đen mờ rồi đặt lời
 * mời chọn lên trên; cả khối bấm được.
 */
export function TripHero({ images, initialIndex, onEditPlace, onChangeIndex }: TripHeroProps) {
  const router = useRouter();
  // Nút phải nằm dưới tai thỏ. Header mặc định của Stack đã tắt nên không có ai
  // lo phần này hộ.
  const insets = useSafeAreaInsets();
  // Bề rộng thật của màn hình, để mỗi ảnh chiếm đúng một trang khi lướt.
  const { width } = useWindowDimensions();

  const [index, setIndex] = useState(() =>
    images.length === 0 ? 0 : Math.min(Math.max(initialIndex, 0), images.length - 1),
  );

  const hasCover = images.length > 0;
  const current = hasCover ? images[Math.min(index, images.length - 1)] : null;

  const handleScrollEnd = (event: NativeSyntheticEvent<NativeScrollEvent>): void => {
    const next = Math.round(event.nativeEvent.contentOffset.x / width);
    if (next === index || next < 0 || next >= images.length) return;
    setIndex(next);
    // Ghi lại ngay khi dừng lướt. Lỗi mạng ở đây không được chặn thao tác —
    // người dùng vẫn thấy đúng ảnh mình vừa dừng lại.
    onChangeIndex(next);
  };

  return (
    <View style={{ height: HERO_HEIGHT }} className="w-full overflow-hidden bg-muted">
      {hasCover ? (
        <ScrollView
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={handleScrollEnd}
          contentOffset={{ x: index * width, y: 0 }}
          accessibilityLabel={`Bộ ảnh bìa, ${images.length} ảnh`}>
          {images.map((image) => (
            <Image
              key={image.url}
              source={{ uri: image.url }}
              style={{ width, height: HERO_HEIGHT }}
              contentFit="cover"
              transition={200}
            />
          ))}
        </ScrollView>
      ) : (
        <>
          <Image
            source={require('@/assets/images/trip-placeholder.jpg')}
            style={{ width: '100%', height: HERO_HEIGHT }}
            contentFit="cover"
            transition={200}
          />
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
        </>
      )}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Quay lại"
        // canGoBack là BẮT BUỘC ở đây: màn chuyến đi không dùng AppHeader nên
        // mũi tên này là lối ra DUY NHẤT. Mở bằng deep link thì không có màn
        // nào phía sau, router.back() không làm gì, và người dùng kẹt lại.
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
        style={{ top: insets.top + 6 }}
        className="absolute left-3 h-11 w-11 items-center justify-center">
        <Text style={ON_IMAGE_SHADOW} className="text-3xl leading-none text-white">
          ←
        </Text>
      </Pressable>

      {/* Chấm chỉ vị trí, chỉ hiện khi có nhiều hơn một ảnh. */}
      {images.length > 1 ? (
        <View className="absolute bottom-12 left-0 right-0 flex-row justify-center gap-1.5">
          {images.map((image, dotIndex) => (
            <View
              key={image.url}
              className={`h-1.5 rounded-full ${
                dotIndex === index ? 'w-5 bg-white' : 'w-1.5 bg-white/50'
              }`}
            />
          ))}
        </View>
      ) : null}

      {/* Unsplash BẮT BUỘC ghi công tác giả kèm link. Đây là điều kiện dùng
          miễn phí, không phải phần trang trí bỏ được. */}
      {current?.credit ? (
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={`Xem ảnh gốc của ${current.credit}`}
          disabled={!current.link}
          // openURL reject khi máy không mở được URL. `void` bỏ giá trị trả về
          // nhưng KHÔNG bắt rejection — bản dev sẽ hiện red box đè lên màn hình.
          onPress={() => {
            if (current.link) void Linking.openURL(current.link).catch(() => undefined);
          }}
          className="absolute bottom-3 right-3 rounded-full bg-black/45 px-2 py-1">
          <Text className="text-[10px] text-white">Ảnh: {current.credit}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
