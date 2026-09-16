import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import {
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import type { TripCoverImage } from '@/lib/data/trips';

import { IconButton } from './icon-button';
import { ChevronLeft } from './icons';

interface TripHeroProps {
  readonly images: readonly TripCoverImage[];
  /**
   * Ảnh hiện tại đã lưu. CHỈ được đọc lúc component mount — màn cha phải đặt
   * `key` theo bộ ảnh để hero dựng lại khi dữ liệu về (xem overview.tsx).
   */
  readonly initialIndex: number;
  readonly onEditPlace: () => void;
  /** Gọi khi NGƯỜI DÙNG dừng lướt ở một ảnh khác. */
  readonly onChangeIndex: (index: number) => void;
  /** Nút ở góc trên bên phải, đối xứng với nút quay lại. */
  readonly rightAction?: ReactNode;
}

const HERO_HEIGHT = 280;

/** Web không có sự kiện "hết quán tính" — coi như đã dừng sau từng này ms không cuộn. */
const WEB_SCROLL_SETTLE_MS = 160;

/**
 * Ảnh bìa toàn chiều rộng, lướt ngang qua bộ ảnh đã lưu của chuyến đi.
 *
 * Dừng ở ảnh nào thì ảnh đó thành ảnh hiện tại và được ghi lại — chính nó sẽ
 * làm nền cho thẻ chuyến đi ở màn danh sách.
 *
 * Chưa chọn địa điểm thì dùng ảnh phong cảnh có sẵn, phủ lớp đen mờ rồi đặt lời
 * mời chọn lên trên; cả khối bấm được.
 */
export function TripHero({
  images,
  initialIndex,
  onEditPlace,
  onChangeIndex,
  rightAction,
}: TripHeroProps) {
  const router = useRouter();
  // Nút phải nằm dưới tai thỏ. Header mặc định của Stack đã tắt nên không có ai
  // lo phần này hộ.
  const insets = useSafeAreaInsets();
  // Bề rộng thật của màn hình, để mỗi ảnh chiếm đúng một trang khi lướt.
  const { width } = useWindowDimensions();

  const [index, setIndex] = useState(() =>
    images.length === 0 ? 0 : Math.min(Math.max(initialIndex, 0), images.length - 1),
  );
  const scrollRef = useRef<ScrollView>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Đưa về ảnh đã lưu ngay khi mount. Web dựng xong DOM là cuộn được luôn, không
  // cần chờ onContentSizeChange — sự kiện đó đi qua ResizeObserver, có lúc tới
  // trễ hoặc không tới (tab nền), và khi đó người dùng thấy ảnh đầu tiên.
  // Native thì lệnh này có thể bị bỏ qua vì chưa đo xong — onContentSizeChange
  // bên dưới lo phần đó. Cố ý chỉ chạy một lần: hero được remount theo `key`.
  useEffect(() => {
    if (images.length > 0 && index > 0) {
      scrollRef.current?.scrollTo({ x: index * width, y: 0, animated: false });
    }
    return () => {
      if (settleTimer.current) clearTimeout(settleTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasCover = images.length > 0;
  const current = hasCover ? images[Math.min(index, images.length - 1)] : null;

  const settle = (offsetX: number): void => {
    const next = Math.round(offsetX / width);
    // So với `index` đang hiển thị: lệnh cuộn do CHÍNH component phát ra (đưa
    // về ảnh đã lưu) rơi vào đúng trang hiện tại nên bị bỏ qua ở đây — chỉ cú
    // lướt thật của người dùng mới được ghi lên server.
    if (next === index || next < 0 || next >= images.length) return;
    setIndex(next);
    // Lỗi mạng khi ghi không được chặn thao tác — người dùng vẫn thấy đúng ảnh
    // mình vừa dừng lại.
    onChangeIndex(next);
  };

  const handleMomentumEnd = (event: NativeSyntheticEvent<NativeScrollEvent>): void => {
    settle(event.nativeEvent.contentOffset.x);
  };

  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>): void => {
    if (Platform.OS !== 'web') return;
    const offsetX = event.nativeEvent.contentOffset.x;
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => settle(offsetX), WEB_SCROLL_SETTLE_MS);
  };

  return (
    <View style={{ height: HERO_HEIGHT }} className="w-full overflow-hidden bg-muted">
      {hasCover ? (
        <ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={handleMomentumEnd}
          onScroll={handleScroll}
          scrollEventThrottle={32}
          // contentOffset chỉ có tác dụng trên iOS. Android và web phải cuộn
          // tay — nhưng chỉ cuộn được SAU khi nội dung đã đo xong kích thước,
          // gọi sớm hơn thì bị kẹp về 0 và lại hiện ảnh đầu tiên.
          contentOffset={{ x: index * width, y: 0 }}
          onContentSizeChange={() =>
            scrollRef.current?.scrollTo({ x: index * width, y: 0, animated: false })
          }
          accessibilityLabel={`Bộ ảnh bìa, ảnh ${index + 1} trên ${images.length}`}>
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
              className="h-[280px] w-full"
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

      {/* Dải tối mờ dần ở mép trên: nút trắng đọc được trên cả ảnh trời
          trắng hay tuyết, mà không phải bọc nút trong khối nền che ảnh.
          Màu đen ở đây là lớp phủ ảnh, không phải màu giao diện — cùng loại
          với bg-black/45 trên thẻ chuyến đi. */}
      <View
        className="absolute top-0 left-0 right-0"
        pointerEvents="none">
        <Svg width="100%" height={insets.top + 76}>
          <Defs>
            <LinearGradient id="tripHeroTopScrim" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#000000" stopOpacity={0.5} />
              <Stop offset="1" stopColor="#000000" stopOpacity={0} />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill="url(#tripHeroTopScrim)" />
        </Svg>
      </View>

      <View
        // box-none: hàng này trải hết chiều ngang; không có nó thì khoảng trống
        // giữa hai nút nuốt mất cú lướt ảnh bắt đầu ở mép trên.
        style={{ top: insets.top + 6, pointerEvents: 'box-none' }}
        className="absolute left-2 right-3 flex-row items-center justify-between">
        {/* canGoBack là BẮT BUỘC: màn chuyến đi không dùng AppHeader nên đây là
            lối ra DUY NHẤT. Mở bằng deep link thì không có màn nào phía sau. */}
        <IconButton
          icon={ChevronLeft}
          label="Quay lại"
          variant="onImage"
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
        />
        {rightAction ?? null}
      </View>

      {/* Chấm chỉ vị trí, chỉ hiện khi có nhiều hơn một ảnh. */}
      {images.length > 1 ? (
        <View className="absolute bottom-[68px] left-0 right-0 flex-row justify-center gap-1.5">
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
          className="absolute bottom-10 right-3 rounded-full bg-black/45 px-2 py-1">
          <Text className="text-[10px] text-white">Ảnh: {current.credit}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
