import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { TripCard } from '@/components/trip/trip-card';
import { AppHeader } from '@/components/ui/app-header';
import { Button } from '@/components/ui/button';
import { ArchiveRestore, Square, SquareCheck } from '@/components/ui/icons';
import { Screen } from '@/components/ui/screen';
import { SectionCard } from '@/components/ui/section-card';
import { EmptyView, ErrorView, LoadingView } from '@/components/ui/state-views';
import { listArchivedTrips, listTrips, setTripArchived } from '@/lib/data/manager';
import { describeError, useAsync } from '@/lib/data/use-async';
import { formatTripDateRange, toIsoDate } from '@/lib/datetime';
import { endedTrips, splitByArchive } from '@/lib/trips/archive';

/**
 * Mục Lưu trữ — CỦA RIÊNG người dùng này: gợi ý các chuyến đã kết thúc để lưu
 * trữ hàng loạt, và danh sách chuyến đã lưu trữ (xem lại, bỏ lưu trữ).
 */
export default function ArchiveScreen() {
  const router = useRouter();
  const { data, error, loading, reload } = useAsync(async () => {
    const [trips, archived] = await Promise.all([listTrips(), listArchivedTrips()]);
    // "Hôm nay" lấy trong lần tải, không trong render (xem index.tsx).
    return { trips, archived, today: toIsoDate(new Date()) };
  }, []);

  // Quay về từ trang chuyến (có thể vừa lưu trữ / bỏ lưu trữ ở đó) → tải lại.
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

  let shelves = null;
  if (data) {
    const { active, archived } = splitByArchive(data.trips, data.archived);
    shelves = { ended: endedTrips(active, data.today), archived };
  }

  // Bỏ chọn thay vì chọn: mặc định lưu trữ hết các chuyến đã kết thúc.
  const [unchecked, setUnchecked] = useState<ReadonlySet<string>>(new Set());
  const selected = shelves?.ended.filter((trip) => !unchecked.has(trip.id)) ?? [];

  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const run = async (key: string, work: () => Promise<unknown>) => {
    setBusy(key);
    setActionError(null);
    try {
      await work();
    } catch (caught) {
      setActionError(describeError(caught));
    } finally {
      setBusy(null);
      // Tải lại cả khi lỗi giữa chừng: lưu trữ hàng loạt có thể đã xong một phần.
      reload();
    }
  };

  const toggle = (tripId: string) =>
    setUnchecked((current) => {
      const next = new Set(current);
      if (next.has(tripId)) next.delete(tripId);
      else next.add(tripId);
      return next;
    });

  const openTrip = (tripId: string) =>
    router.push({ pathname: '/trip/[tripId]/overview', params: { tripId } });

  return (
    <Screen header={<AppHeader title="Lưu trữ" subtitle="Chỉ ẩn khỏi danh sách của bạn" showBack />}>
      {loading && data === null ? <LoadingView /> : null}
      {error ? <ErrorView message={error} onRetry={reload} /> : null}
      {actionError ? <ErrorView message={actionError} /> : null}

      {shelves && shelves.ended.length > 0 ? (
        <SectionCard
          title="Đã kết thúc"
          hint="Chọn chuyến muốn lưu trữ. Người khác trong chuyến vẫn thấy bình thường.">
          <View className="gap-1">
            {shelves.ended.map((trip) => {
              const checked = !unchecked.has(trip.id);
              return (
                <Pressable
                  key={trip.id}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked, disabled: busy !== null }}
                  accessibilityLabel={trip.name}
                  // Khoá khi đang lưu trữ: vòng lặp đã chụp danh sách lúc bấm.
                  disabled={busy !== null}
                  onPress={() => toggle(trip.id)}
                  className="min-h-14 flex-row items-center gap-3 rounded-2xl px-2 py-2 active:bg-muted">
                  {checked ? (
                    <SquareCheck size={22} className="text-primary" />
                  ) : (
                    <Square size={22} className="text-muted-foreground" />
                  )}
                  <View className="min-w-0 flex-1">
                    <Text className="text-base text-foreground" numberOfLines={1}>
                      {trip.name}
                    </Text>
                    <Text className="text-xs text-muted-foreground">
                      {formatTripDateRange(trip.startDate, trip.endDate)}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
          <View className="mt-4">
            <Button
              label={selected.length > 0 ? `Lưu trữ ${selected.length} chuyến` : 'Chưa chọn chuyến nào'}
              disabled={selected.length === 0 || busy !== null}
              busy={busy === 'bulk'}
              onPress={() =>
                void run('bulk', async () => {
                  // Tuần tự, không Promise.all: nhánh khách đọc-sửa-ghi cùng một
                  // khoá AsyncStorage, chạy song song thì lần ghi sau đè lần trước.
                  for (const trip of selected) await setTripArchived(trip.id, true);
                })
              }
            />
          </View>
        </SectionCard>
      ) : null}

      {shelves && shelves.archived.length === 0 && shelves.ended.length === 0 ? (
        <EmptyView
          title="Chưa lưu trữ chuyến nào"
          hint="Nhấn giữ một chuyến ở danh sách chính để lưu trữ. Chuyến đã kết thúc sẽ được gợi ý ở đây."
        />
      ) : null}

      {shelves?.archived.map((trip) => (
        <View key={trip.id} className="gap-2">
          <TripCard trip={trip} onPress={() => openTrip(trip.id)} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Bỏ lưu trữ ${trip.name}`}
            disabled={busy !== null}
            onPress={() =>
              void run(trip.id, async () => {
                await setTripArchived(trip.id, false);
                // Vừa cố ý đưa ra thì đừng để nó nằm sẵn trong ô "đã chọn" của
                // lưu trữ hàng loạt — bấm lưu trữ là bị cất lại ngay.
                setUnchecked((current) => new Set(current).add(trip.id));
              })
            }
            className={`min-h-11 flex-row items-center justify-center gap-2 self-end rounded-full px-4 active:bg-muted ${
              busy !== null ? 'opacity-40' : ''
            }`}>
            <ArchiveRestore size={16} className="text-muted-foreground" />
            <Text className="text-sm font-semibold text-muted-foreground">
              {busy === trip.id ? 'Đang bỏ lưu trữ…' : 'Bỏ lưu trữ'}
            </Text>
          </Pressable>
        </View>
      ))}
    </Screen>
  );
}
