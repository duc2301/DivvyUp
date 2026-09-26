import { Circle, CircleCheck } from 'lucide-react';
import { useState } from 'react';

import type { ExpenseSummary } from '@/entities/expense';
import { canMarkSettled, setExpenseSettled } from '@/entities/expense';
import { describeError } from '@/shared/lib/async';
import { Spinner } from '@/shared/ui';

interface MemberLike {
  readonly id: string;
  readonly displayName: string;
  readonly isMe: boolean;
  readonly claimed: boolean;
  readonly role: string;
}

interface SettleToggleProps {
  readonly expense: ExpenseSummary;
  readonly members: readonly MemberLike[];
  readonly myUserId: string | null;
  /** Một khoản khác đang gửi — khoá mọi vòng tròn để không bấm chồng. */
  readonly disabled: boolean;
  readonly onBusyChange: (expenseId: string | null) => void;
  readonly onDone: () => void;
  readonly onError: (message: string | null) => void;
}

/**
 * Vòng tròn "đã xong" bên trái một khoản chi. Nút riêng, tách khỏi vùng bấm để
 * sửa: chạm nhầm cả dòng không được âm thầm đổi số dư của cả nhóm.
 */
export function SettleToggle({
  expense,
  members,
  myUserId,
  disabled,
  onBusyChange,
  onDone,
  onError,
}: SettleToggleProps) {
  const [busy, setBusy] = useState(false);
  const settled = expense.settledAt !== null;

  const toggle = async (): Promise<void> => {
    if (busy || disabled) return;
    const payer = members.find((member) => member.id === expense.paidByMemberId);
    const me = members.find((member) => member.isMe);
    if (!settled && !canMarkSettled({ me, payer, createdBy: expense.createdBy, myUserId })) {
      onError(
        `Chỉ ${payer?.displayName ?? 'Không rõ'} (người đã trả) hoặc chủ chuyến mới đánh dấu "${expense.description}" là đã xong.`,
      );
      return;
    }
    setBusy(true);
    onBusyChange(expense.id);
    onError(null);
    try {
      await setExpenseSettled(expense.id, !settled);
      onDone();
    } catch (caught) {
      onError(describeError(caught));
    } finally {
      setBusy(false);
      onBusyChange(null);
    }
  };

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={settled}
      aria-busy={busy || undefined}
      aria-label={`Đánh dấu ${expense.description} đã xong`}
      disabled={disabled && !busy}
      onClick={() => void toggle()}
      className="flex min-h-16 w-14 shrink-0 items-center justify-center rounded-l-2xl hover:bg-muted/60 active:bg-muted disabled:cursor-not-allowed">
      {busy ? (
        <Spinner size={22} />
      ) : settled ? (
        <CircleCheck size={24} className="text-positive" aria-hidden />
      ) : (
        <Circle size={24} className="text-muted-foreground" aria-hidden />
      )}
    </button>
  );
}
