import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { AppHeader } from '@/components/ui/app-header';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { IconButton } from '@/components/ui/icon-button';
import { Check, Trash2, X } from '@/components/ui/icons';
import { PickerModal } from '@/components/ui/picker-modal';
import { Screen } from '@/components/ui/screen';
import { SectionCard } from '@/components/ui/section-card';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { ErrorView, LoadingView } from '@/components/ui/state-views';
import { TextField } from '@/components/ui/text-field';
import {
  createExpense,
  getExpenseDetail,
  getTrip,
  listTripMembers,
  updateExpense,
  voidExpense,
} from '@/lib/data/manager';
import { describeError, useAsync } from '@/lib/data/use-async';
import { formatDateTime, parseDateTime } from '@/lib/datetime';
import type { CurrencyCode, Money, SplitLine } from '@/lib/money';
import { currencyInfo, formatMoney, money, parseAmount, splitExpense, zero } from '@/lib/money';

type Mode = 'equal' | 'exact';

interface Row {
  readonly memberId: string;
  /** Chỉ dùng ở chế độ 'exact'. */
  readonly amountText: string;
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Danh sách người chịu khoản chi được hiển thị bằng map() trong vùng cuộn của
 * Screen, KHÔNG dùng FlatList: FlatList lồng trong ScrollView làm React Native
 * cảnh báo và tắt ảo hoá, còn bọc cả form trong một FlatList rỗng thì mất
 * KeyboardAvoidingView của Screen — bàn phím lại che ô nhập tiền. Một chuyến đi
 * cỡ vài chục người thì map() không có vấn đề hiệu năng.
 */
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
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // Lỗi từ máy chủ/lưu trữ khi lưu. Lỗi nhập liệu KHÔNG nằm đây mà tính lại mỗi
  // lần render (xem `headerError`), để sửa xong chỗ thiếu thì thông báo tự mất.
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [showProblems, setShowProblems] = useState(false);
  // Chốt chặn bấm hai lần. `busy` là state nên hai cú chạm liên tiếp trước lần
  // render kế tiếp đều đọc thấy false — ref thì đổi ngay lập tức.
  const inFlight = useRef(false);

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

    // Luôn xếp theo thứ tự thành viên của chuyến. Phần lẻ khi chia đều rơi vào
    // người đứng đầu danh sách (sau người trả); nếu thứ tự lấy theo cách DB trả
    // expense_shares về thì mở ra rồi lưu lại không đổi gì cũng có thể chuyển
    // 1 đồng lẻ sang người khác.
    const order = new Map(data.members.map((member, index) => [member.id, index]));
    const byMemberOrder = (a: Row, b: Row): number =>
      (order.get(a.memberId) ?? Number.MAX_SAFE_INTEGER) -
      (order.get(b.memberId) ?? Number.MAX_SAFE_INTEGER);

    if (data.detail) {
      const detail = data.detail;
      setDescription(detail.description);
      setMode(detail.splitMode);
      setTotalText(formatMoney(detail.total, { withSymbol: false }));
      setRows(
        detail.shares
          .map((share) => ({
            memberId: share.participantId,
            amountText: formatMoney(share.amount, { withSymbol: false }),
          }))
          .sort(byMemberOrder),
      );
      setPaidBy(detail.paidByMemberId);
      setPaidAtText(formatDateTime(new Date(detail.paidAt)));
    } else {
      const me = data.members.find((member) => member.isMe);
      setPaidBy(me?.id ?? data.members[0]?.id ?? null);
      // Khoản mới mặc định chia đều cho CẢ chuyến — trường hợp hay gặp nhất.
      // Người dùng chỉ việc bỏ bớt người không chịu, thay vì thêm từng người.
      setRows(data.members.map((member) => ({ memberId: member.id, amountText: '' })));
    }

    setSeeded(true);
  }, [data, seeded]);

  const currency: CurrencyCode = data?.trip.currency ?? 'VND';
  const members = data?.members ?? [];
  const nameOf = (memberId: string): string =>
    members.find((member) => member.id === memberId)?.displayName ?? 'Không rõ';

  const missingMembers = members.filter(
    (member) => !rows.some((row) => row.memberId === member.id),
  );

  // Tiền có phần lẻ (USD, EUR) cần phím dấu thập phân. number-pad trên iOS chỉ
  // có 0–9: gõ $12.75 thành "1275" là thành $1,275.00.
  const hasDecimals = currencyInfo(currency).decimals > 0;
  const amountKeyboard = hasDecimals ? 'decimal-pad' : 'number-pad';
  const amountInputMode = hasDecimals ? 'decimal' : 'numeric';

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
    } else if (total.minor <= 0) {
      splitError = 'Tổng khoản chi phải lớn hơn 0.';
      total = null;
    } else {
      const result = splitExpense({
        total,
        participantIds: rows.map((row) => row.memberId),
        mode: 'equal',
        // Người ứng tiền nhận phần lẻ — quy ước dễ giải thích nhất.
        remainderPriority: paidBy ? [paidBy] : [],
      });
      if (result.ok) lines = result.lines;
      else {
        splitError = result.error;
        total = null;
      }
    }
  } else {
    const parsed = rows.map((row) => ({
      memberId: row.memberId,
      amount: row.amountText.trim() === '' ? zero(currency) : parseAmount(row.amountText, currency),
    }));
    const bad = parsed.find((item) => item.amount === null);
    const negative = parsed.find((item) => item.amount !== null && item.amount.minor < 0);
    if (bad) {
      splitError = `Chưa đọc được số tiền của ${nameOf(bad.memberId)}.`;
    } else if (negative) {
      // Chặn ở đây là bắt buộc: bộ lọc bỏ dòng 0đ lúc lưu sẽ bỏ luôn dòng âm
      // nhưng tổng vẫn tính cả nó — khoản chi lệch tổng, và ở chế độ khách
      // (không có DB kiểm lại) cả chuyến đi hỏng số dư.
      splitError = `Số tiền của ${nameOf(negative.memberId)} không được âm.`;
    } else {
      const sum = parsed.reduce((acc, item) => acc + item.amount!.minor, 0);
      if (!Number.isSafeInteger(sum)) {
        // money() ném lỗi với số vượt ngưỡng — để nó ném trong lúc render là
        // sập cả màn hình.
        splitError = 'Tổng số tiền quá lớn.';
      } else if (sum <= 0) {
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

  /** Lỗi đầu tiên đang chặn việc lưu — hiện ra khi bấm dấu tick. */
  const firstProblem = (): string | null => {
    if (description.trim() === '') return 'Nhập nội dung khoản chi.';
    if (dateInvalid) return 'Ngày giờ không hợp lệ — định dạng dd/mm/yyyy HH:mm.';
    if (paidBy === null) return 'Chọn người đại diện đã trả.';
    if (splitError !== null) return splitError;
    if (total === null) return 'Chưa đọc được số tiền.';
    return null;
  };

  // --- Hành động -------------------------------------------------------------

  const addMember = (memberId: string): void => {
    // Chèn đúng vị trí theo thứ tự thành viên, không nối đuôi — cùng lý do với
    // việc xếp lúc seed: thứ tự quyết định ai nhận phần lẻ.
    setRows((current) => {
      const next = [...current, { memberId, amountText: '' }];
      const order = new Map(members.map((member, index) => [member.id, index]));
      return next.sort(
        (a, b) =>
          (order.get(a.memberId) ?? Number.MAX_SAFE_INTEGER) -
          (order.get(b.memberId) ?? Number.MAX_SAFE_INTEGER),
      );
    });
    setPicker(null);
  };

  const addEveryone = (): void => {
    // Giữ nguyên số đã gõ của người đang có; chỉ bổ sung người còn thiếu, xếp
    // theo đúng thứ tự danh sách thành viên.
    setRows((current) =>
      members.map(
        (member) =>
          current.find((row) => row.memberId === member.id) ?? {
            memberId: member.id,
            amountText: '',
          },
      ),
    );
  };

  const changeMode = (next: Mode): void => {
    setMode(next);
    // Sang chia đều mà danh sách đang trống thì điền sẵn cả chuyến, giống lúc
    // mở form khoản chi mới.
    if (next === 'equal' && rows.length === 0) addEveryone();
  };

  // Mở thẳng bằng link (không có màn nào phía sau) thì router.back() không làm
  // gì — lưu xong người dùng kẹt lại trên form, bấm ✓ lần nữa là tạo trùng.
  const leave = (): void => {
    if (router.canGoBack()) router.back();
    else if (tripId) router.replace({ pathname: '/trip/[tripId]/overview', params: { tripId } });
    else router.replace('/');
  };

  const submit = async (): Promise<void> => {
    if (inFlight.current) return;
    const problem = firstProblem();
    if (problem !== null) {
      setShowProblems(true);
      setSubmitError(null);
      return;
    }
    if (!tripId || !paidBy || !total || !paidAt) return;

    inFlight.current = true;
    setBusy(true);
    setSubmitError(null);
    try {
      const input = {
        tripId,
        description,
        total,
        paidByMemberId: paidBy,
        // Chế độ tính riêng: ô để trống nghĩa là người đó không chịu gì. Không
        // lưu dòng 0đ, để lúc mở lại sửa không hiện những người "ảo".
        shares: mode === 'exact' ? lines.filter((line) => line.amount.minor > 0) : lines,
        splitMode: mode,
        paidAt,
      };
      if (isEditing) await updateExpense(expenseId, input);
      else await createExpense(input);
      leave();
    } catch (caught) {
      setSubmitError(describeError(caught));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const remove = async (): Promise<void> => {
    if (!expenseId || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setSubmitError(null);
    try {
      await voidExpense(expenseId);
      setConfirmingDelete(false);
      leave();
    } catch (caught) {
      setConfirmingDelete(false);
      setSubmitError(describeError(caught));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const headerError = submitError ?? (showProblems ? firstProblem() : null);

  const amountOf = (memberId: string): Money | null =>
    lines.find((line) => line.participantId === memberId)?.amount ?? null;

  return (
    <>
      <Screen
        header={
          <>
            <AppHeader
              title={isEditing ? 'Sửa khoản chi' : 'Khoản chi mới'}
              subtitle={isEditing ? 'Sửa xong bấm ✓ để lưu' : 'Điền xong bấm ✓ để tạo'}
              showBack
              right={
                data ? (
                  <View className="flex-row items-center gap-1">
                    {isEditing ? (
                      <IconButton
                        icon={Trash2}
                        label="Xoá khoản chi"
                        variant="danger"
                        disabled={busy}
                        onPress={() => setConfirmingDelete(true)}
                      />
                    ) : null}
                    <IconButton
                      icon={Check}
                      label={isEditing ? 'Lưu thay đổi' : 'Tạo khoản chi'}
                      variant="primary"
                      busy={busy && !confirmingDelete}
                      // Không khoá nút khi form còn thiếu: bấm vào phải nói được
                      // thiếu gì. Nút mờ mà im lặng thì không biết sửa chỗ nào.
                      onPress={() => void submit()}
                    />
                  </View>
                ) : null
              }
            />
            {/* Nằm trong header cố định chứ không trong vùng cuộn: bấm ✓ lúc
                đang ở cuối form vẫn thấy ngay lỗi. */}
            {headerError ? (
              <View className="px-4 pb-2">
                <ErrorView message={headerError} />
              </View>
            ) : null}
          </>
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
                onChange={changeMode}
                accessibilityLabel="Cách xác định số tiền từng người"
              />
            </View>

            {mode === 'equal' ? (
              <TextField
                label="Tổng khoản chi"
                value={totalText}
                onChangeText={setTotalText}
                placeholder={hasDecimals ? '12.50' : '450.000'}
                keyboardType={amountKeyboard}
                inputMode={amountInputMode}
                big
                hint={`Đơn vị của chuyến đi: ${currency}`}
              />
            ) : null}

            <SectionCard
              title={`Cùng chịu khoản này (${rows.length}/${members.length})`}
              hint={
                mode === 'equal'
                  ? 'Mặc định chia đều cho cả chuyến. Bấm × để bỏ người không chịu; người đại diện nhận phần lẻ.'
                  : 'Gõ số tiền của từng người; ô để trống là không chịu. Tổng khoản chi là tổng các ô.'
              }>
              {rows.length === 0 ? (
                <Text className="text-sm text-muted-foreground">Chưa thêm ai.</Text>
              ) : (
                rows.map((row) => (
                  <View key={row.memberId} className="flex-row items-center py-1">
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
                        keyboardType={amountKeyboard}
                        inputMode={amountInputMode}
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

                    <IconButton
                      icon={X}
                      label={`Bỏ ${nameOf(row.memberId)} khỏi khoản chi`}
                      onPress={() =>
                        setRows((current) =>
                          current.filter((item) => item.memberId !== row.memberId),
                        )
                      }
                    />
                  </View>
                ))
              )}

              {missingMembers.length > 0 ? (
                <View className="mt-3 flex-row gap-3">
                  <View className="min-w-0 flex-1">
                    <Button
                      label="＋ Thêm người"
                      variant="secondary"
                      onPress={() => setPicker('addMember')}
                    />
                  </View>
                  <View className="min-w-0 flex-1">
                    <Button
                      label={`Thêm cả ${missingMembers.length} người`}
                      variant="ghost"
                      onPress={addEveryone}
                    />
                  </View>
                </View>
              ) : null}
            </SectionCard>

            <SectionCard title="Kiểm chứng">
              <View className="flex-row items-center justify-between">
                <Text className="text-sm text-muted-foreground">Tổng khoản chi</Text>
                <Text
                  numberOfLines={1}
                  className={`pl-3 text-base font-semibold ${
                    splitError ? 'text-negative' : 'text-positive'
                  }`}>
                  {splitError || total === null ? '✗' : `✓ ${formatMoney(total)}`}
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

            <PickerModal
              visible={picker === 'addMember'}
              title="Thêm người vào khoản chi"
              emptyText="Mọi thành viên đã có trong khoản chi này."
              items={missingMembers.map((member) => ({
                value: member.id,
                label: member.displayName,
              }))}
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

      <ConfirmDialog
        visible={confirmingDelete}
        title="Xoá khoản chi?"
        message={`“${description.trim() || 'Khoản chi này'}” sẽ bị xoá khỏi chuyến đi và số dư của mọi người được tính lại. Không hoàn tác được.`}
        confirmLabel="Xoá"
        destructive
        busy={busy}
        onConfirm={() => void remove()}
        onCancel={() => setConfirmingDelete(false)}
      />
    </>
  );
}
