import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { AppHeader } from '@/components/ui/app-header';
import { Button } from '@/components/ui/button';
import { PickerModal } from '@/components/ui/picker-modal';
import { Screen } from '@/components/ui/screen';
import { SectionCard } from '@/components/ui/section-card';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { ErrorView, LoadingView } from '@/components/ui/state-views';
import { TextField } from '@/components/ui/text-field';
import { createExpense, getExpenseDetail, getTrip, listTripMembers, updateExpense, voidExpense } from '@/lib/data/manager';
import { describeError, useAsync } from '@/lib/data/use-async';
import { formatDateTime, parseDateTime } from '@/lib/datetime';
import type { CurrencyCode, Money, SplitLine } from '@/lib/money';
import { formatMoney, money, parseAmount, splitExpense, zero } from '@/lib/money';

type Mode = 'equal' | 'exact';

interface Row {
  readonly memberId: string;
  /** Chỉ dùng ở chế độ 'exact'. */
  readonly amountText: string;
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default function ExpenseFormScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    tripId?: string | string[];
    expenseId?: string | string[];
  }>();
  const tripId = firstParam(params.tripId);
  const expenseId = firstParam(params.expenseId);
  const isEditing = expenseId !== undefined;

  const [description, setDescription] = useState('');
  const [mode, setMode] = useState<Mode>('equal');
  const [totalText, setTotalText] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [paidBy, setPaidBy] = useState<string | null>(null);
  // Yêu cầu: mặc định là thời điểm hiện tại. Vẫn sửa được để ghi bù khoản cũ.
  const [paidAtText, setPaidAtText] = useState(() => formatDateTime(new Date()));

  const [picker, setPicker] = useState<'addMember' | 'payer' | null>(null);
  const [seeded, setSeeded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const { data, error, loading, reload } = useAsync(async () => {
    if (!tripId) throw new Error('Thiếu mã chuyến đi.');
    const [trip, members, detail] = await Promise.all([
      getTrip(tripId),
      listTripMembers(tripId),
      expenseId ? getExpenseDetail(expenseId) : Promise.resolve(null),
    ]);
    return { trip, members, detail };
  }, [tripId, expenseId]);

  // Đổ giá trị ban đầu đúng MỘT lần sau khi có dữ liệu. Không có cờ `seeded`,
  // mỗi lần reload sẽ ghi đè những gì người dùng đang gõ dở.
  useEffect(() => {
    if (!data || seeded) return;

    if (data.detail) {
      const detail = data.detail;
      setDescription(detail.description);
      setMode(detail.splitMode);
      setTotalText(formatMoney(detail.total, { withSymbol: false }));
      setRows(
        detail.shares.map((share) => ({
          memberId: share.participantId,
          amountText: formatMoney(share.amount, { withSymbol: false }),
        })),
      );
      setPaidBy(detail.paidByMemberId);
      setPaidAtText(formatDateTime(new Date(detail.paidAt)));
    } else {
      const me = data.members.find((member) => member.isMe);
      setPaidBy(me?.id ?? data.members[0]?.id ?? null);
    }

    setSeeded(true);
  }, [data, seeded]);

  const currency: CurrencyCode = data?.trip.currency ?? 'VND';
  const members = data?.members ?? [];
  const nameOf = (memberId: string): string =>
    members.find((member) => member.id === memberId)?.displayName ?? 'Không rõ';

  // --- Tính phần chia --------------------------------------------------------
  // React Compiler đang bật nên không cần useMemo cho các giá trị dẫn xuất.

  let total: Money | null = null;
  let lines: readonly SplitLine[] = [];
  let splitError: string | null = null;

  if (rows.length === 0) {
    splitError = 'Thêm ít nhất một người cùng chịu khoản chi.';
  } else if (mode === 'equal') {
    total = parseAmount(totalText, currency);
    if (total === null) {
      splitError = 'Chưa đọc được số tiền.';
    } else {
      const result = splitExpense({
        total,
        participantIds: rows.map((row) => row.memberId),
        mode: 'equal',
        // Người ứng tiền nhận phần lẻ — quy ước dễ giải thích nhất.
        remainderPriority: paidBy ? [paidBy] : [],
      });
      if (result.ok) lines = result.lines;
      else splitError = result.error;
    }
  } else {
    const parsed = rows.map((row) => ({
      memberId: row.memberId,
      amount: row.amountText.trim() === '' ? zero(currency) : parseAmount(row.amountText, currency),
    }));
    const bad = parsed.find((item) => item.amount === null);
    if (bad) {
      splitError = `Chưa đọc được số tiền của ${nameOf(bad.memberId)}.`;
    } else {
      const sum = parsed.reduce((acc, item) => acc + item.amount!.minor, 0);
      if (sum <= 0) {
        splitError = 'Tổng khoản chi phải lớn hơn 0.';
      } else {
        total = money(sum, currency);
        lines = parsed.map((item) => ({
          participantId: item.memberId,
          amount: item.amount!,
        }));
      }
    }
  }

  const paidAt = parseDateTime(paidAtText);
  const dateInvalid = paidAt === null;
  const canSubmit =
    !busy &&
    description.trim() !== '' &&
    paidBy !== null &&
    total !== null &&
    splitError === null &&
    !dateInvalid;

  // --- Hành động -------------------------------------------------------------

  const addMember = (memberId: string): void => {
    setRows((current) => [...current, { memberId, amountText: '' }]);
    setPicker(null);
  };

  const addEveryone = (): void => {
    setRows(members.map((member) => ({ memberId: member.id, amountText: '' })));
  };

  const submit = async (): Promise<void> => {
    if (!tripId || !paidBy || !total || !paidAt) return;
    setBusy(true);
    setSubmitError(null);
    try {
      const input = {
        tripId,
        description,
        total,
        paidByMemberId: paidBy,
        shares: lines,
        splitMode: mode,
        paidAt,
      };
      if (isEditing) await updateExpense(expenseId, input);
      else await createExpense(input);
      router.back();
    } catch (caught) {
      setSubmitError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (): Promise<void> => {
    if (!expenseId) return;
    setBusy(true);
    setSubmitError(null);
    try {
      await voidExpense(expenseId);
      router.back();
    } catch (caught) {
      setSubmitError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  const amountOf = (memberId: string): Money | null =>
    lines.find((line) => line.participantId === memberId)?.amount ?? null;

  return (
    <>
      <Screen
        header={
          <AppHeader
            title={isEditing ? 'Sửa khoản chi' : 'Khoản chi mới'}
            subtitle={isEditing ? 'Sửa xong bấm Lưu thay đổi' : undefined}
            showBack
          />
        }>
        {loading && data === null ? <LoadingView /> : null}
        {error ? <ErrorView message={error} onRetry={reload} /> : null}

        {data ? (
          <>
            <TextField
              label="Nội dung"
              value={description}
              onChangeText={setDescription}
              placeholder="Ăn tối, xăng xe, phòng nghỉ…"
              autoCapitalize="sentences"
            />

            <TextField
              label="Thời điểm"
              value={paidAtText}
              onChangeText={setPaidAtText}
              placeholder="dd/mm/yyyy HH:mm"
              keyboardType="numbers-and-punctuation"
              error={dateInvalid ? 'Ngày giờ không hợp lệ.' : null}
              hint="Mặc định là lúc này. Sửa được để ghi bù khoản cũ."
            />

            <View>
              <Text className="mb-1 text-sm font-medium text-foreground">Người đại diện đã trả</Text>
                <Pressable
                accessibilityRole="button"
                accessibilityLabel="Chọn người đại diện đã trả"
                onPress={() => setPicker('payer')}
                className="min-h-12 flex-row items-center justify-between rounded-2xl border border-input bg-muted/50 px-3">
                <Text className="min-w-0 flex-1 text-base text-foreground">
                  {paidBy ? nameOf(paidBy) : 'Chọn người…'}
                </Text>
                <Text className="pl-2 text-muted-foreground">▾</Text>
              </Pressable>
            </View>

            <View>
              <Text className="mb-1 text-sm font-medium text-foreground">Cách chia</Text>
              <SegmentedControl
                options={[
                  { value: 'equal' as const, label: 'Chia đều' },
                  { value: 'exact' as const, label: 'tính riêng từng người' },
                ]}
                value={mode}
                onChange={setMode}
                accessibilityLabel="Cách xác định số tiền từng người"
              />
            </View>

            {mode === 'equal' ? (
              <TextField
                label="Tổng khoản chi"
                value={totalText}
                onChangeText={setTotalText}
                placeholder="450.000"
                keyboardType="number-pad"
                inputMode="numeric"
                big
                hint={`Đơn vị của chuyến đi: ${currency}`}
              />
            ) : null}

            <SectionCard
              title="Cùng chịu khoản này"
              hint={
                mode === 'equal'
                  ? 'App chia đều; người đại diện nhận phần lẻ.'
                  : 'Gõ số tiền của từng người. Tổng khoản chi là tổng các ô này.'
              }>
              {rows.length === 0 ? (
                <Text className="text-sm text-muted-foreground">Chưa thêm ai.</Text>
              ) : (
                rows.map((row) => (
                  <View
                    key={row.memberId}
                    className="flex-row items-center py-2">
                    <Text
                      numberOfLines={1}
                      className="min-h-11 min-w-0 flex-1 py-2 text-base text-foreground">
                      {nameOf(row.memberId)}
                    </Text>

                    {mode === 'exact' ? (
                      <TextInput
                        value={row.amountText}
                        onChangeText={(text) =>
                          setRows((current) =>
                            current.map((item) =>
                              item.memberId === row.memberId
                                ? { ...item, amountText: text }
                                : item,
                            ),
                          )
                        }
                        placeholder="0"
                        keyboardType="number-pad"
                        inputMode="numeric"
                        accessibilityLabel={`Số tiền của ${nameOf(row.memberId)}`}
                        className="min-h-11 w-28 rounded-xl bg-muted px-2 text-right text-base text-foreground"
                      />
                    ) : (
                      <Text
                        numberOfLines={1}
                        className="pl-2 text-base font-semibold text-foreground">
                        {amountOf(row.memberId) ? formatMoney(amountOf(row.memberId)!) : '—'}
                      </Text>
                    )}

                      <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Bỏ ${nameOf(row.memberId)} khỏi khoản chi`}
                      onPress={() =>
                        setRows((current) =>
                          current.filter((item) => item.memberId !== row.memberId),
                        )
                      }
                      className="h-11 w-11 items-center justify-center active:bg-muted rounded-full">
                      <Text className="text-lg text-muted-foreground">×</Text>
                    </Pressable>
                  </View>
                ))
              )}

              <View className="mt-3 flex-row gap-3">
                <View className="min-w-0 flex-1">
                  <Button
                    label="＋ Thêm người"
                    variant="secondary"
                    onPress={() => setPicker('addMember')}
                  />
                </View>
                <View className="min-w-0 flex-1">
                  <Button label="Thêm tất cả" variant="ghost" onPress={addEveryone} />
                </View>
              </View>
            </SectionCard>

            <SectionCard title="Kiểm chứng">
              <View className="flex-row items-center justify-between">
                <Text className="text-sm text-muted-foreground">Tổng khoản chi</Text>
                <Text
                  numberOfLines={1}
                  className={`pl-3 text-base font-semibold ${
                    splitError ? 'text-negative' : 'text-positive'
                  }`}>
                  {splitError ? '✗' : `✓ ${formatMoney(total!)}`}
                </Text>
              </View>
              {splitError ? (
                <Text className="mt-1 text-xs text-negative">{splitError}</Text>
              ) : (
                <Text className="mt-1 text-xs text-muted-foreground">
                  Tổng các phần chia khớp tuyệt đối tới từng đơn vị nhỏ nhất.
                </Text>
              )}
            </SectionCard>

            {submitError ? <ErrorView message={submitError} /> : null}

            <Button
              label={isEditing ? 'Lưu thay đổi' : 'Tạo khoản chi'}
              onPress={() => void submit()}
              disabled={!canSubmit}
              busy={busy}
            />

            {isEditing ? (
              <Button label="Huỷ khoản chi này" variant="danger" onPress={() => void remove()} />
            ) : null}

            <PickerModal
              visible={picker === 'addMember'}
              title="Thêm người vào khoản chi"
              emptyText="Mọi thành viên đã có trong khoản chi này."
              items={members
                .filter((member) => !rows.some((row) => row.memberId === member.id))
                .map((member) => ({ value: member.id, label: member.displayName }))}
              onSelect={addMember}
              onClose={() => setPicker(null)}
            />

            <PickerModal
              visible={picker === 'payer'}
              title="Ai đã đứng ra trả?"
              items={members.map((member) => ({
                value: member.id,
                label: member.displayName,
                detail: member.id === paidBy ? 'đang chọn' : undefined,
              }))}
              onSelect={(memberId) => {
                setPaidBy(memberId);
                setPicker(null);
              }}
              onClose={() => setPicker(null)}
            />
          </>
        ) : null}
      </Screen>
    </>
  );
}
