import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Plus } from '@/components/ui/icons';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { EmptyView, ErrorView, LoadingView } from '@/components/ui/state-views';
import { TripHero } from '@/components/ui/trip-hero';
import {
  getTrip,
  getTripBalances,
  listExpenses,
  listTripMembers,
  updateCoverIndex,
} from '@/lib/data/manager';
import { useAsync } from '@/lib/data/use-async';
import { formatRelativeDateTime } from '@/lib/datetime';
import { formatMoney, money, simplifyDebts, sumMoney } from '@/lib/money';

type Tab = 'expenses' | 'balances' | 'members';

const TABS = [
  { value: 'expenses' as const, label: 'Khoản chi' },
  { value: 'balances' as const, label: 'Số dư' },
  { value: 'members' as const, label: 'Thành viên' },
];

/** Số ngày của chuyến, tính cả ngày đầu và ngày cuối. */
function tripDayCount(startDate: string | null, endDate: string | null): number | null {
  if (!startDate || !endDate) return null;
  const toLocal = (value: string): Date => {
    const [year, month, day] = value.split('-').map(Number);
    return new Date(year, month - 1, day);
  };
  const days = Math.round(
    (toLocal(endDate).getTime() - toLocal(startDate).getTime()) / 86_400_000,
  );
  return days >= 0 ? days + 1 : null;
}

export default function TripScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ tripId?: string | string[] }>();
  const tripId = Array.isArray(params.tripId) ? params.tripId[0] : params.tripId;

  const [tab, setTab] = useState<Tab>('expenses');

  const { data, error, loading, reload } = useAsync(async () => {
    if (!tripId) throw new Error('Thiếu mã chuyến đi.');
    const [trip, members, expenses, balances] = await Promise.all([
      getTrip(tripId),
      listTripMembers(tripId),
      listExpenses(tripId),
      getTripBalances(tripId),
    ]);
    return { trip, members, expenses, balances };
  }, [tripId]);

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

  const nameOf = (memberId: string): string =>
    data?.members.find((member) => member.id === memberId)?.displayName ?? 'Không rõ';

  const transfers = data ? simplifyDebts(data.balances) : [];
  const hasMembers = (data?.members.length ?? 0) > 0;

  const totalSpent = data
    ? sumMoney(
        data.expenses.map((expense) => expense.total),
        data.trip.currency,
      )
    : money(0, 'VND');

  const dayCount = data ? tripDayCount(data.trip.startDate, data.trip.endDate) : null;

  const goToPlace = (): void => {
    if (!tripId) return;
    router.push({ pathname: '/trip/[tripId]/place', params: { tripId } });
  };

  const addExpense = (): void => {
    if (!tripId) return;
    if (!hasMembers) {
      router.push({ pathname: '/trip/[tripId]/members', params: { tripId } });
      return;
    }
    router.push({ pathname: '/trip/[tripId]/expense-new', params: { tripId } });
  };

  const coverImages = data?.trip.cover.images ?? [];

  return (
    <View className="flex-1 bg-background">
      <FlatList
        className="flex-1"
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <>
            <TripHero
              key={coverImages.map((image) => image.url).join('|')}
              images={coverImages}
              initialIndex={data?.trip.cover.index ?? 0}
              onEditPlace={goToPlace}
              onChangeIndex={(next) => {
                if (tripId) void updateCoverIndex(tripId, next).catch(() => undefined);
              }}
              rightAction={
                data ? (
                  <IconButton
                    icon={Plus}
                    label={hasMembers ? 'Thêm khoản chi' : 'Thêm thành viên trước khi ghi khoản chi'}
                    variant="primary"
                    onPress={addExpense}
                  />
                ) : null
              }
            />

            <View className="-mt-7 rounded-t-3xl bg-background px-4 pt-5">
              {loading && data === null ? <LoadingView /> : null}
              {error ? <ErrorView message={error} onRetry={reload} /> : null}

              {data ? (
                <>
                  <View className="flex-row items-start justify-between gap-3">
                    <View className="min-w-0 flex-1">
                      <Text className="font-display text-3xl leading-tight text-foreground">
                        {data.trip.name}
                      </Text>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={
                          data.trip.place ? 'Đổi địa điểm chuyến đi' : 'Chọn địa điểm chuyến đi'
                        }
                        onPress={goToPlace}
                        className="mt-1 flex-row items-center self-start">
                        <Text className="text-sm text-muted-foreground">
                          {data.trip.place
                            ? `📍 ${data.trip.place.name}${
                                data.trip.place.country ? `, ${data.trip.place.country}` : ''
                              }`
                            : 'Chưa chọn địa điểm'}
                        </Text>
                        <Text className="pl-1 text-sm font-medium text-accent-strong">
                          {data.trip.place ? 'Đổi' : 'Chọn'} ›
                        </Text>
                      </Pressable>
                    </View>

                    <View className="items-end">
                      <Text numberOfLines={1} className="text-xl font-bold text-primary">
                        {formatMoney(totalSpent)}
                      </Text>
                      <Text className="text-xs text-muted-foreground">tổng chi</Text>
                    </View>
                  </View>

                  <View className="mt-3 flex-row flex-wrap gap-2">
                    <Text className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
                      {data.members.length} người
                    </Text>
                    {dayCount ? (
                      <Text className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
                        {dayCount} ngày
                      </Text>
                    ) : null}
                    <Text className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
                      {data.trip.currency}
                    </Text>
                    {data.trip.joinCode !== '' ? (
                      <Text className="rounded-full bg-accent px-3 py-1 text-xs font-semibold text-accent-foreground">
                        Mã {data.trip.joinCode}
                      </Text>
                    ) : (
                      <Text className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
                        Lưu cục bộ
                      </Text>
                    )}
                  </View>

                  <View className="mt-5">
                    <SegmentedControl
                      options={TABS}
                      value={tab}
                      onChange={setTab}
                      accessibilityLabel="Chọn nội dung hiển thị"
                    />
                  </View>

                  <View className="mt-4 gap-3">
                    {tab === 'expenses' && data.expenses.length === 0 && (
                      <EmptyView
                        title="Chưa có khoản chi nào"
                        hint={
                          hasMembers
                            ? 'Bấm nút ＋ ở góc trên bên phải để ghi khoản đầu tiên.'
                            : 'Thêm thành viên trước, rồi mới ghi được khoản chi.'
                        }
                        actionLabel={hasMembers ? undefined : 'Thêm thành viên'}
                        onAction={hasMembers ? undefined : addExpense}
                      />
                    )}
                    {tab === 'balances' && (
                      <View className="rounded-2xl border border-border bg-card p-4">
                        <Text className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                          Số dư
                        </Text>
                        {data.balances.length === 0 && (
                          <Text className="text-sm text-muted-foreground">Chưa có thành viên nào.</Text>
                        )}
                      </View>
                    )}
                    {tab === 'members' && (
                      <>
                        <View className="rounded-2xl border border-border bg-card p-4">
                          {data.members.length === 0 && (
                            <Text className="text-sm text-muted-foreground">Chưa có ai.</Text>
                          )}
                        </View>

                        <Button
                          label="Quản lý thành viên & nhóm"
                          variant="secondary"
                          onPress={() =>
                            router.push({
                              pathname: '/trip/[tripId]/members',
                              params: { tripId: data.trip.id },
                            })
                          }
                        />
                      </>
                    )}
                  </View>
                </>
              ) : null}
            </View>
          </>
        }
        data={
          tab === 'expenses' ? data?.expenses :
          tab === 'balances' ? data?.balances :
          tab === 'members' ? data?.members :
          []
        }
        keyExtractor={(item: any) => item.id || item.participantId}
        renderItem={({ item }: any) => {
          if (tab === 'expenses') {
            const expense = item as any;
            return (
              <Pressable
                key={expense.id}
                accessibilityRole="button"
                accessibilityLabel={`Sửa khoản chi ${expense.description}`}
                onPress={() =>
                  router.push({
                    pathname: '/trip/[tripId]/expense-new',
                    params: { tripId: data?.trip.id, expenseId: expense.id },
                  })
                }
                className="rounded-2xl border border-border bg-card p-4 active:bg-muted mb-3">
                <View className="flex-row items-start justify-between gap-3">
                  <Text className="min-w-0 flex-1 text-base font-medium text-foreground">
                    {expense.description}
                  </Text>
                  <Text
                    numberOfLines={1}
                    className="text-base font-semibold text-foreground">
                    {formatMoney(expense.total)}
                  </Text>
                </View>
                <View className="mt-1 flex-row items-center justify-between">
                  <Text className="min-w-0 flex-1 text-xs text-muted-foreground">
                    {nameOf(expense.paidByMemberId)} ứng ·{' '}
                    {formatRelativeDateTime(new Date(expense.paidAt))}
                  </Text>
                  <Text className="pl-2 text-xs font-medium text-accent-strong">Sửa ›</Text>
                </View>
              </Pressable>
            );
          }
          if (tab === 'balances') {
            const balance = item as any;
            return (
              <View className="flex-row items-center justify-between py-2">
                <Text className="min-w-0 flex-1 text-base text-foreground">
                  {balance.displayName}
                </Text>
                <Text
                  numberOfLines={1}
                  className={`pl-3 text-base font-semibold ${
                    balance.net.minor > 0
                      ? 'text-positive'
                      : balance.net.minor < 0
                        ? 'text-negative'
                        : 'text-muted-foreground'
                  }`}>
                  {balance.net.minor === 0
                    ? '0'
                    : formatMoney(balance.net, { signDisplay: 'always' })}
                </Text>
              </View>
            );
          }
          if (tab === 'members') {
            const member = item as any;
            return (
              <View className="flex-row items-center justify-between py-2">
                <Text className="min-w-0 flex-1 text-base text-foreground">
                  {member.displayName}
                </Text>
                {member.isMe ? (
                  <Text className="rounded-lg bg-accent px-2 py-1 text-xs font-semibold text-accent-foreground">
                    bạn
                  </Text>
                ) : member.claimed ? (
                  <Text className="rounded-lg bg-muted px-2 py-1 text-xs text-muted-foreground">
                    đã vào app
                  </Text>
                ) : null}
              </View>
            );
          }
          return null;
        }}
      />
    </View>
  );
}
