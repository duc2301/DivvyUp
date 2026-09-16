import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { AppHeader, HeaderAction } from '@/components/ui/app-header';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { EmptyView, ErrorView, LoadingView } from '@/components/ui/state-views';
import { signOut } from '@/features/auth/auth-actions';
import { useSessionContext } from '@/features/auth/session-context';
import { listTrips } from '@/lib/data/manager';
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
  const { isGuest, setGuestMode } = useSessionContext();
  const [signingOut, setSigningOut] = useState(false);
  const { data: trips, error, loading, reload } = useAsync(() => listTrips(), []);

  // Tải lại mỗi khi quay về màn này, để chuyến đi vừa tạo xuất hiện ngay.
  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  return (
    <>
      <Screen
        header={
          <AppHeader
            title="My trips"
            subtitle="Mỗi chuyến một sổ chi tiêu riêng"
            right={
              <View className="flex-row items-center gap-2">
                <ThemeToggle />
                {/* Khách không có phiên để đăng xuất — nút phải mời họ đăng
                    nhập, còn không thì bấm vào sẽ chẳng có gì xảy ra. */}
                <HeaderAction
                  label={isGuest ? 'Đăng nhập' : 'Thoát'}
                  accessibilityLabel={isGuest ? 'Đăng nhập để đồng bộ' : 'Đăng xuất'}
                  disabled={signingOut}
                  onPress={() => {
                    if (isGuest) {
                      void setGuestMode(false);
                      return;
                    }
                    setSigningOut(true);
                    void signOut().finally(() => setSigningOut(false));
                  }}
                />
              </View>
            }
          />
        }>
        {loading && trips === null ? <LoadingView /> : null}
        {error ? <ErrorView message={error} onRetry={reload} /> : null}

        {trips !== null && trips.length === 0 && !error ? (
          <EmptyView
            title="Chưa có chuyến đi nào"
            hint="Tạo chuyến đầu tiên, thiết lập nhóm và số người, rồi bắt đầu ghi khoản chi."
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
            className="rounded-3xl bg-card p-5 shadow-sm">
            <View className="flex-row items-center justify-between gap-3">
              <Text className="min-w-0 flex-1 font-display text-2xl text-foreground">
                {trip.name}
              </Text>
              <Text className="rounded-lg bg-muted px-2 py-1 text-xs font-semibold text-muted-foreground">
                {trip.currency}
              </Text>
            </View>
            <Text className="mt-1 text-sm text-muted-foreground">
              {tripDateLabel(trip.startDate, trip.endDate) ?? 'Chưa đặt ngày'}
            </Text>
          </Pressable>
        ))}

        {trips !== null && trips.length > 0 ? (
          <Button label="＋ Tạo chuyến đi" onPress={() => router.push('/trip-new')} />
        ) : null}

        <Button
          label="Tham gia bằng mã mời"
          variant="ghost"
          onPress={() => router.push('/join')}
        />
      </Screen>
    </>
  );
}
