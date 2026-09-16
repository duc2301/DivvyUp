import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppHeader } from '@/components/ui/app-header';
import { IconButton } from '@/components/ui/icon-button';
import { KeyRound, Plus } from '@/components/ui/icons';
import { Screen } from '@/components/ui/screen';
import { EmptyView, ErrorView, LoadingView } from '@/components/ui/state-views';
import { UserMenu } from '@/components/ui/user-menu';
import { listTrips } from '@/lib/data/manager';
import { currentCover } from '@/lib/data/trips';
import { useAsync } from '@/lib/data/use-async';
import { formatDate } from '@/lib/datetime';

function tripDateLabel(startDate: string | null, endDate: string | null): string | null {
  // Cột date của Postgres là yyyy-MM-dd, không có múi giờ. new Date('2026-09-15')
  // sẽ được hiểu là UTC và lệch một ngày ở múi giờ âm, nên tách tay.
  const toLocal = (value: string): Date => {
    const [year, month, day] = value.split('-').map(Number);
    return new Date(year, month - 1, day);
  };

  if (startDate && endDate) return `${formatDate(toLocal(startDate))} → ${formatDate(toLocal(endDate))}`;
  if (startDate) return `Từ ${formatDate(toLocal(startDate))}`;
  if (endDate) return `Đến ${formatDate(toLocal(endDate))}`;
  return null;
}

export default function TripListScreen() {
  const router = useRouter();
  const { data: trips, error, loading, reload } = useAsync(() => listTrips(), []);

  // Tải lại mỗi khi quay về màn này, để chuyến đi vừa tạo xuất hiện ngay. Bỏ
  // qua lần focus đầu: useAsync đã tự tải lúc mount, gọi thêm là tải hai lần.
  const firstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      reload();
    }, [reload]),
  );

  return (
    <>
      <Screen
        header={
          <AppHeader
            layout="inline"
            title="My trips"
            subtitle="Mỗi chuyến một sổ chi tiêu riêng"
            right={
              // Nằm cùng hàng tiêu đề thay vì cuối danh sách: có nhiều chuyến
              // đi thì nút ở cuối bị đẩy khuất, phải cuộn hết mới tạo được.
              <View className="flex-row items-center gap-1">
                <IconButton
                  icon={KeyRound}
                  label="Tham gia bằng mã mời"
                  onPress={() => router.push('/join')}
                />
                <IconButton
                  icon={Plus}
                  label="Tạo chuyến đi"
                  variant="primary"
                  onPress={() => router.push('/trip-new')}
                />
                <UserMenu />
              </View>
            }
          />
        }>
        {loading && trips === null ? <LoadingView /> : null}
        {error ? <ErrorView message={error} onRetry={reload} /> : null}

        {trips !== null && trips.length === 0 && !error ? (
          <EmptyView
            title="Chưa có chuyến đi nào"
            hint="Bấm ＋ để tạo chuyến đầu tiên, hoặc 🔑 để tham gia chuyến của bạn bè bằng mã mời."
            actionLabel="Tạo chuyến đi"
            onAction={() => router.push('/trip-new')}
          />
        ) : null}

        {trips?.map((trip) => (
          <Pressable
            key={trip.id}
            accessibilityRole="button"
            accessibilityLabel={`Mở chuyến đi ${trip.name}`}
            onPress={() =>
              router.push({ pathname: '/trip/[tripId]/overview', params: { tripId: trip.id } })
            }
            className="h-36 overflow-hidden rounded-3xl bg-card shadow-sm">
            {(() => {
              const cover = currentCover(trip.cover);
              if (!cover) {
                // Chưa có ảnh thì giữ thẻ trắng như cũ, chữ màu mực.
                return (
                  <View className="flex-1 justify-end p-5">
                    <View className="flex-row items-center justify-between gap-3">
                      <Text className="min-w-0 flex-1 font-display text-2xl text-foreground">
                        {trip.name}
                      </Text>
                    </View>
                    <Text className="mt-1 text-sm text-muted-foreground">
                      {tripDateLabel(trip.startDate, trip.endDate) ?? 'Chưa đặt ngày'}
                    </Text>
                  </View>
                );
              }

              return (
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
                    <View className="flex-row items-center justify-between gap-3">
                      <Text className="min-w-0 flex-1 font-display text-2xl text-white">
                        {trip.name}
                      </Text>
                      <Text className="rounded-lg bg-white/20 px-2 py-1 text-xs font-semibold text-white">
                        {trip.currency}
                      </Text>
                    </View>
                    <Text className="mt-1 text-sm text-white/80">
                      {trip.place ? `📍 ${trip.place.name} · ` : ''}
                      {tripDateLabel(trip.startDate, trip.endDate) ?? 'Chưa đặt ngày'}
                    </Text>
                  </View>
                </>
              );
            })()}
          </Pressable>
        ))}
      </Screen>
    </>
  );
}
