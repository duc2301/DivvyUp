import { Check, ChevronDown, History, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import {
  createExpense,
  getExpenseDetail,
  updateExpense,
  voidExpense,
} from '@/entities/expense';
import { listTripMembers, memberLookup } from '@/entities/member';
import { getTrip } from '@/entities/trip';
import { describeError, useAsync } from '@/shared/lib/async';
import { fromDateTimeLocalValue, toDateTimeLocalValue } from '@/shared/lib/datetime';
import type { CurrencyCode, Money, SplitLine } from '@/shared/lib/money';
import { currencyInfo, formatMoney, money, parseAmount, splitExpense, zero } from '@/shared/lib/money';
import {
  AppHeader,
  Button,
  ConfirmDialog,
  ErrorView,
  IconButton,
  LoadingView,
  NoticeView,
  PickerSheet,
  Screen,
  SectionCard,
  SegmentedControl,
  TextField,
} from '@/shared/ui';

type Mode = 'equal' | 'exact';

interface Row {
  readonly memberId: string;
  /** Chỉ dùng ở chế độ 'exact'. */
  readonly amountText: string;
}

interface ExpenseEditorProps {
  readonly tripId: string;
  /** Có = sửa khoản chi này; không = tạo mới. */
  readonly expenseId?: string;
  readonly backFallback: string;
  /** Lưu/xoá xong. */
  readonly onDone: () => void;
  readonly onOpenHistory: () => void;
}

/**
 * Tạo/sửa khoản chi — bản port src/app/trip/[tripId]/expense-new.tsx. Chia
 * tiền dùng NGUYÊN splitExpense/parseAmount của lõi chung; DB kiểm lại tổng.
 */
export function ExpenseEditor({ tripId, expenseId, backFallback, onDone, onOpenHistory }: ExpenseEditorProps) {
  const isEditing = expenseId !== undefined;

  const [description, setDescription] = useState('');
  const [mode, setMode] = useState<Mode>('equal');
  const [totalText, setTotalText] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [paidBy, setPaidBy] = useState<string | null>(null);
  const [paidAtText, setPaidAtText] = useState(() => toDateTimeLocalValue(new Date()));
  const [picker, setPicker] = useState<'addMember' | 'payer' | null>(null);
  const [seeded, setSeeded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [showProblems, setShowProblems] = useState(false);
  // Chốt chặn bấm hai lần trước lần render kế tiếp.
  const inFlight = useRef(false);

  const { data, error, loading, reload } = useAsync(async () => {
    const [trip, members, detail] = await Promise.all([
      getTrip(tripId),
      listTripMembers(tripId),
      expenseId ? getExpenseDetail(expenseId) : Promise.resolve(null),
    ]);
    return { trip, members, detail };
  }, [tripId, expenseId]);

  // Đổ giá trị ban đầu đúng MỘT lần — reload không được ghi đè thứ đang gõ.
  useEffect(() => {
    if (!data || seeded) return;
    // Xếp theo thứ tự thành viên: thứ tự quyết định ai nhận phần lẻ khi chia đều.
    const order = new Map(data.members.map((member, index) => [member.id, index]));
    const byMemberOrder = (a: Row, b: Row): number =>
      (order.get(a.memberId) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.memberId) ?? Number.MAX_SAFE_INTEGER);

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
      setPaidAtText(toDateTimeLocalValue(new Date(detail.paidAt)));
    } else {
      const me = data.members.find((member) => member.isMe);
      setPaidBy(me?.id ?? data.members[0]?.id ?? null);
      // Khoản mới mặc định chia đều cho CẢ chuyến.
      setRows(data.members.map((member) => ({ memberId: member.id, amountText: '' })));
    }
    setSeeded(true);
  }, [data, seeded]);

  const currency: CurrencyCode = data?.trip.currency ?? 'VND';
  const members = data?.members ?? [];
  const { nameOf } = memberLookup(members);
  const missingMembers = members.filter((member) => !rows.some((row) => row.memberId === member.id));
  const hasDecimals = currencyInfo(currency).decimals > 0;
  const amountInputMode = hasDecimals ? 'decimal' : 'numeric';

  // --- Tính phần chia (y hệt mobile) ---------------------------------------
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
      splitError = `Số tiền của ${nameOf(negative.memberId)} không được âm.`;
    } else {
      const sum = parsed.reduce((acc, item) => acc + (item.amount?.minor ?? 0), 0);
      if (!Number.isSafeInteger(sum)) {
        splitError = 'Tổng số tiền quá lớn.';
      } else if (sum <= 0) {
        splitError = 'Tổng khoản chi phải lớn hơn 0.';
      } else {
        total = money(sum, currency);
        lines = parsed.map((item) => ({
          participantId: item.memberId,
          amount: item.amount ?? zero(currency),
        }));
      }
    }
  }

  const paidAt = fromDateTimeLocalValue(paidAtText);
  const dateInvalid = paidAt === null;

  const firstProblem = (): string | null => {
    if (description.trim() === '') return 'Nhập nội dung khoản chi.';
    if (dateInvalid) return 'Ngày giờ không hợp lệ.';
    if (paidBy === null) return 'Chọn người đại diện đã trả.';
    if (splitError !== null) return splitError;
    if (total === null) return 'Chưa đọc được số tiền.';
    return null;
  };

  // --- Hành động -----------------------------------------------------------
  const sortByMembers = (list: Row[]): Row[] => {
    const order = new Map(members.map((member, index) => [member.id, index]));
    return list.sort(
      (a, b) =>
        (order.get(a.memberId) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.memberId) ?? Number.MAX_SAFE_INTEGER),
    );
  };

  const addMember = (memberId: string): void => {
    setRows((current) => sortByMembers([...current, { memberId, amountText: '' }]));
    setPicker(null);
  };

  const addEveryone = (): void => {
    setRows((current) =>
      members.map(
        (member) => current.find((row) => row.memberId === member.id) ?? { memberId: member.id, amountText: '' },
      ),
    );
  };

  const changeMode = (next: Mode): void => {
    setMode(next);
    if (next === 'equal' && rows.length === 0) addEveryone();
  };

  const submit = async (): Promise<void> => {
    if (inFlight.current) return;
    if (firstProblem() !== null) {
      setShowProblems(true);
      setSubmitError(null);
      return;
    }
    if (!paidBy || !total || !paidAt) return;

    inFlight.current = true;
    setBusy(true);
    setSubmitError(null);
    try {
      const input = {
        tripId,
        description,
        total,
        paidByMemberId: paidBy,
        // Tính riêng: ô trống = không chịu; không lưu dòng 0đ.
        shares: mode === 'exact' ? lines.filter((line) => line.amount.minor > 0) : lines,
        splitMode: mode,
        paidAt,
      };
      if (expenseId) await updateExpense(expenseId, input);
      else await createExpense(input);
      onDone();
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
      onDone();
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
              backFallback={backFallback}
              right={
                data ? (
                  <>
                    {isEditing ? (
                      <IconButton icon={History} label="Xem lịch sử thay đổi" disabled={busy} onClick={onOpenHistory} />
                    ) : null}
                    {isEditing ? (
                      <IconButton
                        icon={Trash2}
                        label="Xoá khoản chi"
                        variant="danger"
                        disabled={busy}
                        onClick={() => setConfirmingDelete(true)}
                      />
                    ) : null}
                    <IconButton
                      icon={Check}
                      label={isEditing ? 'Lưu thay đổi' : 'Tạo khoản chi'}
                      variant="primary"
                      busy={busy && !confirmingDelete}
                      onClick={() => void submit()}
                    />
                  </>
                ) : null
              }
            />
            {headerError ? (
              <div className="px-4 pb-2">
                <ErrorView message={headerError} />
              </div>
            ) : null}
          </>
        }>
        {loading && data === null ? <LoadingView /> : null}
        {data?.detail?.settledAt ? (
          <NoticeView message="Khoản này đã đánh dấu xong nên đang không tính vào số dư. Lưu thay đổi sẽ bỏ đánh dấu và tính lại vào số dư — đánh dấu lại sau nếu mọi người đã trả đủ." />
        ) : null}
        {error ? <ErrorView message={error} onRetry={reload} /> : null}

        {data ? (
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}>
            <TextField
              label="Nội dung"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Ăn tối, xăng xe, phòng nghỉ…"
              autoCapitalize="sentences"
            />

            <TextField
              label="Thời điểm"
              type="datetime-local"
              value={paidAtText}
              onChange={(event) => setPaidAtText(event.target.value)}
              error={dateInvalid ? 'Ngày giờ không hợp lệ.' : null}
              hint="Mặc định là lúc này. Sửa được để ghi bù khoản cũ."
            />

            <div>
              <p className="mb-1 text-sm font-medium text-foreground">Người đại diện đã trả</p>
              <button
                type="button"
                aria-label="Chọn người đại diện đã trả"
                onClick={() => setPicker('payer')}
                className="flex min-h-12 w-full items-center justify-between rounded-xl border border-input bg-muted px-3 text-left text-base text-foreground">
                <span className="min-w-0 flex-1 truncate">{paidBy ? nameOf(paidBy) : 'Chọn người…'}</span>
                <ChevronDown size={18} className="text-muted-foreground" aria-hidden />
              </button>
            </div>

            <div>
              <p className="mb-1 text-sm font-medium text-foreground">Cách chia</p>
              <SegmentedControl
                options={[
                  { value: 'equal' as const, label: 'Chia đều' },
                  { value: 'exact' as const, label: 'Tính riêng từng người' },
                ]}
                value={mode}
                onChange={changeMode}
                ariaLabel="Cách xác định số tiền từng người"
              />
            </div>

            {mode === 'equal' ? (
              <TextField
                label="Tổng khoản chi"
                value={totalText}
                onChange={(event) => setTotalText(event.target.value)}
                placeholder={hasDecimals ? '12.50' : '450.000'}
                inputMode={amountInputMode}
                autoComplete="off"
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
              {rows.length === 0 ? <p className="text-sm text-muted-foreground">Chưa thêm ai.</p> : null}
              {rows.map((row) => {
                const amount = amountOf(row.memberId);
                return (
                  <div key={row.memberId} className="flex items-center gap-2 py-1">
                    <span className="min-h-11 min-w-0 flex-1 truncate py-2.5 text-base text-foreground">
                      {nameOf(row.memberId)}
                    </span>
                    {mode === 'exact' ? (
                      <input
                        value={row.amountText}
                        onChange={(event) => {
                          const text = event.target.value;
                          setRows((current) =>
                            current.map((item) => (item.memberId === row.memberId ? { ...item, amountText: text } : item)),
                          );
                        }}
                        placeholder="0"
                        inputMode={amountInputMode}
                        autoComplete="off"
                        aria-label={`Số tiền của ${nameOf(row.memberId)}`}
                        className="min-h-11 w-28 rounded-xl bg-muted px-2 text-right text-base text-foreground placeholder:text-muted-foreground"
                      />
                    ) : (
                      <span className="whitespace-nowrap pl-2 text-base font-semibold text-foreground">
                        {amount ? formatMoney(amount) : '—'}
                      </span>
                    )}
                    <IconButton
                      icon={X}
                      label={`Bỏ ${nameOf(row.memberId)} khỏi khoản chi`}
                      onClick={() => setRows((current) => current.filter((item) => item.memberId !== row.memberId))}
                    />
                  </div>
                );
              })}
              {missingMembers.length > 0 ? (
                <div className="mt-3 flex gap-3">
                  <Button label="＋ Thêm người" variant="secondary" onClick={() => setPicker('addMember')} />
                  <Button label={`Thêm cả ${missingMembers.length} người`} variant="ghost" onClick={addEveryone} />
                </div>
              ) : null}
            </SectionCard>

            <SectionCard title="Kiểm chứng">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Tổng khoản chi</span>
                <span className={`pl-3 text-base font-semibold ${splitError ? 'text-negative' : 'text-positive'}`}>
                  {splitError || total === null ? '✗' : `✓ ${formatMoney(total)}`}
                </span>
              </div>
              <p className={`mt-1 text-xs ${splitError ? 'text-negative' : 'text-muted-foreground'}`}>
                {splitError ?? 'Tổng các phần chia khớp tuyệt đối tới từng đơn vị nhỏ nhất.'}
              </p>
            </SectionCard>

            <Button type="submit" label={isEditing ? 'Lưu thay đổi' : 'Tạo khoản chi'} busy={busy && !confirmingDelete} />
          </form>
        ) : null}
      </Screen>

      <PickerSheet
        open={picker === 'addMember'}
        title="Thêm người vào khoản chi"
        emptyText="Mọi thành viên đã có trong khoản chi này."
        items={missingMembers.map((member) => ({ value: member.id, label: member.displayName }))}
        onSelect={addMember}
        onClose={() => setPicker(null)}
      />
      <PickerSheet
        open={picker === 'payer'}
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
      <ConfirmDialog
        open={confirmingDelete}
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
