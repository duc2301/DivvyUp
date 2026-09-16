import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { Pressable, Text, View } from 'react-native';

import { AppHeader } from '@/components/ui/app-header';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { SectionCard } from '@/components/ui/section-card';
import { EmptyView, ErrorView, LoadingView } from '@/components/ui/state-views';
import { getTrip, getTripBalances, listExpenses, listTripMembers } from '@/lib/data/manager';
import { useAsync } from '@/lib/data/use-async';
import { formatRelativeDateTime } from '@/lib/datetime';
import { formatMoney, simplifyDebts } from '@/lib/money';

export default function TripScreen() {
  const router = useRouter();
  // useLocalSearchParams luôn trả string | string[] | undefined — không được
  // coi mặc định là string.
  const params = useLocalSearchParams<{ tripId?: string | string[] }>();
  const tripId = Array.isArray(params.tripId) ? params.tripId[0] : params.tripId;

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

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  const nameOf = (memberId: string): string =>
    data?.members.find((member) => member.id === memberId)?.displayName ?? 'Không rõ';

  const transfers = data ? simplifyDebts(data.balances) : [];
  const hasMembers = (data?.members.length ?? 0) > 0;

  return (
    <>
      <Screen
        header={
          <AppHeader
            title={data?.trip.name ?? 'Chuyến đi'}
            subtitle={data && data.trip.joinCode !== '' ? `Mã mời ${data.trip.joinCode}` : undefined}
            showBack
          />
        }>
        {loading && data === null ? <LoadingView /> : null}
        {error ? <ErrorView message={error} onRetry={reload} /> : null}

        {data ? (
          <>
            <View className="flex-row gap-3">
              <View className="min-w-0 flex-1">
                <Button
                  label="＋ Khoản chi"
                  onPress={() =>
                    router.push({
                      pathname: '/trip/[tripId]/expense-new',
                      params: { tripId: data.trip.id },
                    })
                  }
                  disabled={!hasMembers}
                />
              </View>
              <View className="min-w-0 flex-1">
                <Button
                  label="Thành viên"
                  variant="secondary"
                  onPress={() =>
                    router.push({
                      pathname: '/trip/[tripId]/members',
                      params: { tripId: data.trip.id },
                    })
                  }
                />
              </View>
            </View>

            <SectionCard title="Số dư" hint="Dương là được nhận lại, âm là đang nợ.">
              {data.balances.length === 0 ? (
                <Text className="text-sm text-muted-foreground">Chưa có thành viên nào.</Text>
              ) : (
                data.balances.map((balance) => (
                  <View
                    key={balance.participantId}
                    className="flex-row items-center justify-between py-2">
                    <Text className="min-w-0 flex-1 text-base text-foreground">
                      {balance.displayName}
                    </Text>
                    {/* Không chỉ dựa vào màu: dấu +/− là thứ người mù màu đọc được. */}
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
                ))
              )}
            </SectionCard>

            {transfers.length > 0 ? (
              <SectionCard title="Ai trả ai" hint="Đã tối giản số lần chuyển tiền.">
                {transfers.map((transfer, index) => (
                  <View
                    key={`${transfer.from}-${transfer.to}-${index}`}
                    className="flex-row items-center justify-between py-2">
                    <Text className="min-w-0 flex-1 text-base text-foreground">
                      {nameOf(transfer.from)} → {nameOf(transfer.to)}
                    </Text>
                    <Text numberOfLines={1} className="pl-3 text-base font-semibold text-foreground">
                      {formatMoney(transfer.amount)}
                    </Text>
                  </View>
                ))}
              </SectionCard>
            ) : null}

            <SectionCard title="Khoản chi" hint="Chạm vào một dòng để sửa hoặc huỷ.">
              {data.expenses.length === 0 ? (
                <EmptyView
                  title="Chưa có khoản chi nào"
                  hint={
                    hasMembers
                      ? 'Bấm "＋ Khoản chi" để ghi khoản đầu tiên.'
                      : 'Thêm thành viên trước đã.'
                  }
                />
              ) : (
                data.expenses.map((expense) => (
                  <Pressable
                    key={expense.id}
                    accessibilityRole="button"
                    accessibilityLabel={`Sửa khoản chi ${expense.description}`}
                    onPress={() =>
                      router.push({
                        pathname: '/trip/[tripId]/expense-new',
                        params: { tripId: data.trip.id, expenseId: expense.id },
                      })
                    }
                    className="rounded-2xl px-2 py-3 active:bg-muted">
                    <View className="flex-row items-start justify-between gap-3">
                      <Text className="min-w-0 flex-1 text-base font-medium text-foreground">
                        {expense.description}
                      </Text>
                      <Text numberOfLines={1} className="text-base font-semibold text-foreground">
                        {formatMoney(expense.total)}
                      </Text>
                    </View>
                    <View className="mt-1 flex-row items-center justify-between">
                      <Text className="min-w-0 flex-1 text-xs text-muted-foreground">
                        {nameOf(expense.paidByMemberId)} ứng ·{' '}
                        {formatRelativeDateTime(new Date(expense.paidAt))}
                      </Text>
                      <View className="flex-row items-center gap-1 pl-2">
                        <Text className="text-xs font-medium text-accent-strong">Sửa</Text>
                        <Text className="text-xs text-accent-strong">›</Text>
                      </View>
                    </View>
                  </Pressable>
                ))
              )}
            </SectionCard>

            {/* Chuyến đi tạo ở chế độ khách chỉ nằm trên máy này nên không có
                mã mời. Hiện một thẻ rỗng sẽ khiến người dùng tưởng app lỗi. */}
            {data.trip.joinCode === '' ? (
              <SectionCard title="Lưu cục bộ">
                <Text className="text-sm leading-5 text-muted-foreground">
                  Chuyến đi này chỉ nằm trên máy bạn. Đăng nhập để đồng bộ và mời người khác cùng
                  ghi chi tiêu.
                </Text>
              </SectionCard>
            ) : (
              <SectionCard
                title="Mã mời"
                hint="Gửi mã này để người khác nhận tên của họ trong chuyến.">
                <Text className="font-display text-3xl tracking-widest text-foreground">
                  {data.trip.joinCode}
                </Text>
              </SectionCard>
            )}
          </>
        ) : null}
      </Screen>
    </>
  );
}
