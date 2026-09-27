import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { TripSummary } from '@/lib/data/trips';
import { currentCover } from '@/lib/data/trips';
import { formatTripDateRange } from '@/lib/datetime';

interface TripCardProps {
  readonly trip: TripSummary;
  /** Hiện nhãn "Đã kết thúc" — gợi ý người dùng có thể lưu trữ. */
  readonly ended?: boolean;
  readonly onPress: () => void;
  /** Nhấn giữ: lưu trữ chuyến (chỉ danh sách chính truyền). */
  readonly onLongPress?: () => void;
}

/** Thẻ chuyến đi ở danh sách chính và màn Lưu trữ. */
export function TripCard({ trip, ended = false, onPress, onLongPress }: TripCardProps) {
  const cover = currentCover(trip.cover);
  const dateLabel = formatTripDateRange(trip.startDate, trip.endDate) ?? 'Chưa đặt ngày';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Mở chuyến đi ${trip.name}${ended ? ', đã kết thúc' : ''}`}
      accessibilityHint={onLongPress ? 'Nhấn giữ để lưu trữ' : undefined}
      // Trình đọc màn hình: "Lưu trữ" nằm trong menu hành động, không bắt
      // người dùng tìm ra thao tác chạm đúp và giữ.
      accessibilityActions={onLongPress ? [{ name: 'longpress', label: 'Lưu trữ' }] : undefined}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === 'longpress') onLongPress?.();
      }}
      onPress={onPress}
      onLongPress={onLongPress}
      className="h-36 overflow-hidden rounded-3xl bg-card shadow-sm">
      {cover ? (
        <>
          <Image
            source={{ uri: cover.url }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            transition={200}
          />
          {/* Lớp phủ đen là thứ bảo đảm chữ trắng đọc được trên MỌI ảnh.
              Không có nó, ảnh trời sáng sẽ nuốt sạch tên chuyến đi. */}
          <View className="flex-1 justify-end bg-black/45 p-5">
            {ended ? <EndedChip onImage /> : null}
            <View className="flex-row items-center justify-between gap-3">
              <Text className="min-w-0 flex-1 font-display text-2xl text-white">{trip.name}</Text>
              <Text className="rounded-lg bg-white/20 px-2 py-1 text-xs font-semibold text-white">
                {trip.currency}
              </Text>
            </View>
            <Text className="mt-1 text-sm text-white/80">
              {trip.place ? `📍 ${trip.place.name} · ` : ''}
              {dateLabel}
            </Text>
          </View>
        </>
      ) : (
        // Chưa có ảnh thì giữ thẻ trắng, chữ màu mực.
        <View className="flex-1 justify-end p-5">
          {ended ? <EndedChip /> : null}
          <Text className="font-display text-2xl text-foreground">{trip.name}</Text>
          <Text className="mt-1 text-sm text-muted-foreground">{dateLabel}</Text>
        </View>
      )}
    </Pressable>
  );
}

function EndedChip({ onImage = false }: { readonly onImage?: boolean }) {
  return (
    <View className="absolute right-4 top-4">
      <Text
        className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
          onImage ? 'bg-white/20 text-white' : 'bg-muted text-muted-foreground'
        }`}>
        Đã kết thúc
      </Text>
    </View>
  );
}
