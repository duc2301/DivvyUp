import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Circle, CircleCheck, ChevronRight, Plus, QrCode } from '@/components/ui/icons';
import type { PaymentTarget } from '@/components/ui/payment-sheet';
import { PaymentSheet } from '@/components/ui/payment-sheet';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { EmptyView, ErrorView, LoadingView } from '@/components/ui/state-views';
import { TripHero } from '@/components/ui/trip-hero';
import { WeatherSummary } from '@/components/weather/weather-summary';
import { useSessionContext } from '@/features/auth/session-context';
import { useTripForecast } from '@/features/weather/use-trip-forecast';
import type { ExpenseSummary } from '@/lib/data/expenses';
import {
  getTrip,
  getTripBalances,
  listAllExpenses,
  listTripMembers,
  setExpenseSettled,
  updateCoverIndex,
} from '@/lib/data/manager';
import { describeError, useAsync } from '@/lib/data/use-async';
import { formatRelativeDateTime } from '@/lib/datetime';
import { formatMoney, money, simplifyDebts, sumMoney } from '@/lib/money';

type Tab = 'expenses' | 'balances' | 'members';

const TABS = [
  { value: 'expenses' as const, label: 'Khoản chi' },
  { value: 'balances' as const, label: 'Số dư' },
  { value: 'members' as const, label: 'Thành viên' },
];

const NO_EXPENSES: readonly ExpenseSummary[] = [];

/**
 * Màn chuyến đi.
 *
 * Cả màn là MỘT FlatList: danh sách khoản chi là phần dài ra theo thời gian nên
 * được ảo hoá; ảnh bìa, thông tin chuyến và các tab nằm ở ListHeaderComponent.
 * Tab Số dư và Thành viên chỉ vài chục dòng nên vẽ thẳng trong header, gọn trong
 * thẻ của chúng — không trộn ba kiểu dữ liệu khác nhau vào cùng một `data`.
 */
export default function TripScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // useLocalSearchParams luôn trả string | string[] | undefined — không được
  // coi mặc định là string.
  const params = useLocalSearchParams<{ tripId?: string | string[] }>();
  const tripId = Array.isArray(params.tripId) ? params.tripId[0] : params.tripId;

  const [tab, setTab] = useState<Tab>('expenses');
  const [payment, setPayment] = useState<PaymentTarget | null>(null);
  const [settlingId, setSettlingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const { userId: myUserId, isGuest } = useSessionContext();

  const { data, error, loading, reload } = useAsync(async () => {
    if (!tripId) throw new Error('Thiếu mã chuyến đi.');
    const [trip, members, expenses, balances] = await Promise.all([
      getTrip(tripId),
      listTripMembers(tripId),
      listAllExpenses(tripId),
      getTripBalances(tripId),
    ]);
    return { trip, members, expenses, balances };
  }, [tripId]);

  // Bỏ qua lần focus ĐẦU TIÊN: useAsync đã tự chạy trong useEffect của nó rồi.
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

  // Dự báo tự dùng bộ nhớ đệm 3 tiếng — tải lại màn chuyến đi không gọi mạng lại.
  const weather = useTripForecast(data?.trip ?? null);

  const memberOf = (memberId: string) => data?.members.find((member) => member.id === memberId);
  const nameOf = (memberId: string): string => memberOf(memberId)?.displayName ?? 'Không rõ';

  const settledCount = data ? data.expenses.filter((expense) => expense.settledAt).length : 0;

  /**
   * Cùng quy tắc với RPC set_expense_settled: đánh dấu xong = xoá nợ, nên chỉ
   * người được nhận tiền (người đã trả), chủ chuyến, hoặc người ghi khoản chi khi
   * người trả chưa vào app. Bỏ đánh dấu thì ai cũng được.
   */
  const canMarkSettled = (expense: ExpenseSummary): boolean => {
    if (isGuest) return true;
    const me = data?.members.find((member) => member.isMe);
    if (me?.role === 'owner') return true;
    const payer = memberOf(expense.paidByMemberId);
    if (payer?.isMe) return true;
    return payer !== undefined && !payer.claimed && expense.createdBy === myUserId;
  };

  const toggleSettled = async (expense: ExpenseSummary): Promise<void> => {
    if (settlingId !== null) return;
    if (expense.settledAt === null && !canMarkSettled(expense)) {
      setActionError(
        `Chỉ ${nameOf(expense.paidByMemberId)} (người đã trả) hoặc chủ chuyến mới đánh dấu "${expense.description}" là đã xong.`,
      );
      return;
    }
    setSettlingId(expense.id);
    setActionError(null);
    try {
      await setExpenseSettled(expense.id, expense.settledAt === null);
      reload();
    } catch (caught) {
      setActionError(describeError(caught));
    } finally {
      setSettlingId(null);
    }
  };

  const transfers = data ? simplifyDebts(data.balances) : [];
  const hasMembers = (data?.members.length ?? 0) > 0;

  // Tổng chi của cả chuyến. Cộng qua sumMoney chứ không cộng số trần: nó chặn
  // sẵn việc lẫn hai đơn vị tiền tệ.
  const totalSpent = data
    ? sumMoney(
        data.expenses.map((expense) => expense.total),
        data.trip.currency,
      )
    : money(0, 'VND');


  const goToPlace = (): void => {
    if (!tripId) return;
    router.push({ pathname: '/trip/[tripId]/place', params: { tripId } });
  };

  const addExpense = (): void => {
    if (!tripId) return;
    // Chưa có ai thì không chia được cho ai — dẫn thẳng tới chỗ thêm người thay
    // vì mở một form không bao giờ lưu được.
    if (!hasMembers) {
      router.push({ pathname: '/trip/[tripId]/members', params: { tripId } });
      return;
    }
    router.push({ pathname: '/trip/[tripId]/expense-new', params: { tripId } });
  };

  const openExpense = (expenseId: string): void => {
    if (!tripId) return;
    router.push({ pathname: '/trip/[tripId]/expense-new', params: { tripId, expenseId } });
  };

  const coverImages = data?.trip.cover.images ?? [];

  const header = (
    <>
      <TripHero
        // key theo bộ ảnh là BẮT BUỘC. Lần render đầu dữ liệu chưa về, hero
        // nhận mảng rỗng và chốt vị trí ở ảnh 0; không dựng lại khi ảnh về thì
        // mở chuyến đi nào cũng hiện ảnh đầu tiên thay vì ảnh đã chọn.
        // Có cả index: chọn lại đúng bộ ảnh cũ nhưng đổi ảnh đầu thì URL không
        // đổi, thiếu index thì hero đứng yên ở ảnh cũ trong khi thẻ ở danh sách
        // đã đổi.
        key={`${coverImages.map((image) => image.url).join('|')}#${data?.trip.cover.index ?? 0}`}
        loading={data === null}
        images={coverImages}
        initialIndex={data?.trip.cover.index ?? 0}
        onEditPlace={goToPlace}
        onChangeIndex={(next) => {
          if (tripId) void updateCoverIndex(tripId, next).catch(() => undefined);
        }}
      />

      {/* Thẻ đè lên ảnh — chi tiết tạo nên bố cục trong thiết kế mẫu. */}
      <View className="-mt-7 rounded-t-3xl bg-background px-4 pt-5">
        {loading && data === null ? <LoadingView /> : null}
        {error ? <ErrorView message={error} onRetry={reload} /> : null}
        {actionError ? <ErrorView message={actionError} /> : null}

        {data ? (
          <>
            <View className="flex-row items-start justify-between gap-3">
              <View className="min-w-0 flex-1">
                <Text className="font-display text-3xl leading-tight text-foreground">
                  {data.trip.name}
                </Text>
                {/* Dòng địa điểm chính là chỗ đổi địa điểm. */}
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

            <WeatherSummary
              state={weather}
              onOpen={() =>
                router.push({ pathname: '/trip/[tripId]/weather', params: { tripId: data.trip.id } })
              }
            />

            <View className="mt-5">
              <SegmentedControl
                options={TABS}
                value={tab}
                onChange={setTab}
                accessibilityLabel="Chọn nội dung hiển thị"
              />
            </View>

            {/* Ngay dưới thanh tab, không nằm trên ảnh và không ở cuối danh
                sách: luôn trong tầm tay, không bị cuộn mất khi có nhiều khoản. */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={hasMembers ? 'Thêm khoản chi' : 'Thêm thành viên trước khi ghi khoản chi'}
              onPress={addExpense}
              className="mt-3 min-h-12 flex-row items-center justify-center gap-2 rounded-full bg-primary px-5 active:opacity-80">
              <Plus size={20} className="text-primary-foreground" />
              <Text className="text-base font-semibold text-primary-foreground">
                {hasMembers ? 'Thêm khoản chi' : 'Thêm thành viên trước'}
              </Text>
            </Pressable>

            <View className="mt-4 gap-3">
              {tab === 'expenses' && data.expenses.length === 0 ? (
                <EmptyView
                  title="Chưa có khoản chi nào"
                  hint={
                    hasMembers
                      ? 'Bấm "Thêm khoản chi" ở trên để ghi khoản đầu tiên.'
                      : 'Thêm thành viên trước, rồi mới ghi được khoản chi.'
                  }
                />
              ) : null}

              {tab === 'expenses' && data.expenses.length > 0 && settledCount === 0 ? (
                <Text className="px-1 text-xs text-muted-foreground">
                  Chạm vòng tròn bên trái một khoản chi khi mọi người đã trả xong khoản đó.
                </Text>
              ) : null}

              {tab === 'expenses' && settledCount > 0 ? (
                <Text className="px-1 text-xs leading-5 text-muted-foreground">
                  {settledCount} khoản đã xong không tính vào số dư. Chỉ đánh dấu khi mọi người đã
                  trả đủ RIÊNG khoản đó — nếu trả theo "Chi tiết người trả" (đã gộp nhiều khoản) thì
                  đánh dấu hết các khoản cùng lúc.
                </Text>
              ) : null}

              {tab === 'balances' ? (
                <>
                  <View className="rounded-2xl border border-border bg-card p-4">
                    <Text className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                      Số dư
                    </Text>
                    {data.balances.length === 0 ? (
                      <Text className="text-sm text-muted-foreground">Chưa có thành viên nào.</Text>
                    ) : (
                      data.balances.map((balance) => (
                        <View
                          key={balance.participantId}
                          className="flex-row items-center gap-3 py-2">
                          <Avatar
                            name={balance.displayName}
                            uri={memberOf(balance.participantId)?.avatarUrl}
                            size="sm"
                            pending={!memberOf(balance.participantId)?.claimed}
                          />
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
                    {settledCount > 0 ? (
                      <Text className="mt-2 text-xs text-muted-foreground">
                        Không tính {settledCount} khoản chi đã đánh dấu xong.
                      </Text>
                    ) : null}
                  </View>

                  {transfers.length > 0 ? (
                    <View className="rounded-2xl border border-border bg-card p-4">
                      <Text className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                        Chi tiết người trả
                      </Text>
                      <Text className="mb-1 text-xs text-muted-foreground">
                        Chạm một dòng để xem mã QR nhận tiền của người nhận.
                      </Text>
                      {transfers.map((transfer, index) => {
                        const receiver = memberOf(transfer.to);
                        return (
                          <Pressable
                            key={`${transfer.from}-${transfer.to}-${index}`}
                            accessibilityRole="button"
                            accessibilityLabel={`${nameOf(transfer.from)} chuyển ${formatMoney(transfer.amount)} cho ${nameOf(transfer.to)}. Xem mã QR`}
                            onPress={() =>
                              setPayment({
                                fromName: nameOf(transfer.from),
                                toName: nameOf(transfer.to),
                                toUserId: receiver?.userId ?? null,
                                toAvatarUrl: receiver?.avatarUrl ?? null,
                                amount: transfer.amount,
                              })
                            }
                            className="-mx-2 flex-row items-center gap-3 rounded-xl px-2 py-2.5 active:bg-muted">
                            <Avatar
                              name={nameOf(transfer.to)}
                              uri={receiver?.avatarUrl}
                              size="sm"
                              pending={!receiver?.claimed}
                            />
                            <View className="min-w-0 flex-1">
                              <Text numberOfLines={2} className="text-base text-foreground">
                                {nameOf(transfer.from)} → {nameOf(transfer.to)}
                              </Text>
                            </View>
                            <Text
                              numberOfLines={1}
                              className="text-base font-semibold text-foreground">
                              {formatMoney(transfer.amount)}
                            </Text>
                            <QrCode size={18} className="text-muted-foreground" />
                          </Pressable>
                        );
                      })}
                    </View>
                  ) : null}
                </>
              ) : null}

              {tab === 'members' ? (
                <>
                  <View className="rounded-2xl border border-border bg-card p-4">
                    {data.members.length === 0 ? (
                      <Text className="text-sm text-muted-foreground">Chưa có ai.</Text>
                    ) : (
                      data.members.map((member) => (
                        <View key={member.id} className="flex-row items-center gap-3 py-2">
                          <Avatar
                            name={member.displayName}
                            uri={member.avatarUrl}
                            pending={!member.claimed}
                          />
                          <Text className="min-w-0 flex-1 text-base text-foreground">
                            {member.displayName}
                          </Text>
                          {member.isMe ? (
                            <Text className="rounded-full bg-accent px-2.5 py-1 text-xs font-semibold text-accent-foreground">
                              Bạn
                            </Text>
                          ) : member.claimed ? (
                            <Text className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
                              Đã vào app
                            </Text>
                          ) : (
                            <Text className="rounded-full border border-dashed border-border px-2.5 py-1 text-xs text-muted-foreground">
                              Chưa nhận
                            </Text>
                          )}
                        </View>
                      ))
                    )}
                  </View>

                  <Pressable
                    accessibilityRole="button"
                    onPress={() =>
                      router.push({
                        pathname: '/trip/[tripId]/members',
                        params: { tripId: data.trip.id },
                      })
                    }
                    className="flex-row items-center justify-between rounded-2xl border border-border bg-card px-4 py-3.5 active:bg-muted">
                    <Text className="text-base font-medium text-foreground">
                      Quản lý thành viên & nhóm
                    </Text>
                    <ChevronRight size={20} className="text-muted-foreground" />
                  </Pressable>
                </>
              ) : null}
            </View>
          </>
        ) : null}
      </View>
    </>
  );

  return (
    <View className="flex-1 bg-background">
      <FlatList
        className="flex-1"
        data={tab === 'expenses' && data ? data.expenses : NO_EXPENSES}
        keyExtractor={(expense) => expense.id}
        ListHeaderComponent={header}
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item: expense }) => (
          <View className="px-4 pt-3">
            <View
              // items-stretch: vùng bấm vòng tròn cao bằng cả dòng, kể cả khi mô
              // tả dài xuống hai dòng — không có vùng "trông bấm được mà trượt".
              className={`flex-row items-stretch rounded-2xl border border-border bg-card ${
                expense.settledAt ? 'opacity-60' : ''
              }`}>
              {/* Nút riêng, tách khỏi vùng bấm để sửa: chạm nhầm cả dòng không
                  được âm thầm đổi số dư của cả nhóm. */}
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: expense.settledAt !== null, busy: settlingId === expense.id }}
                accessibilityLabel={`Đánh dấu ${expense.description} đã xong`}
                disabled={settlingId !== null}
                onPress={() => void toggleSettled(expense)}
                hitSlop={4}
                className="min-h-16 w-14 items-center justify-center rounded-l-2xl active:bg-muted">
                {expense.settledAt ? (
                  <CircleCheck size={24} className="text-positive" />
                ) : (
                  <Circle size={24} className="text-muted-foreground" />
                )}
              </Pressable>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Sửa khoản chi ${expense.description}`}
                onPress={() => openExpense(expense.id)}
                className="min-w-0 flex-1 rounded-r-2xl py-4 pr-4 active:bg-muted">
                <View className="flex-row items-start justify-between gap-3">
                  <Text
                    className={`min-w-0 flex-1 text-base font-medium text-foreground ${
                      expense.settledAt ? 'line-through' : ''
                    }`}>
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
                  {expense.settledAt ? (
                    <Text className="pl-2 text-xs font-semibold text-positive">Đã xong</Text>
                  ) : (
                    <Text className="pl-2 text-xs font-medium text-accent-strong">Sửa ›</Text>
                  )}
                </View>
              </Pressable>
            </View>
          </View>
        )}
      />

      <PaymentSheet target={payment} guest={isGuest} onClose={() => setPayment(null)} />
    </View>
  );
}
