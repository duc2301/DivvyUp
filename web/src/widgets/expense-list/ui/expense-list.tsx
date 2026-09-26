import { useState } from 'react';
import { Link } from 'react-router';

import type { ExpenseSummary } from '@/entities/expense';
import type { TripMember } from '@/entities/member';
import { memberLookup } from '@/entities/member';
import { SettleToggle } from '@/features/settle-expense';
import { formatRelativeDateTime } from '@/shared/lib/datetime';
import { formatMoney } from '@/shared/lib/money';
import { EmptyView, ErrorView } from '@/shared/ui';

interface ExpenseListProps {
  readonly expenses: readonly ExpenseSummary[];
  readonly members: readonly TripMember[];
  readonly myUserId: string | null;
  readonly editHref: (expenseId: string) => string;
  readonly onChanged: () => void;
}

/** Danh sách khoản chi: vòng tròn "đã xong" bên trái, chạm phần còn lại để sửa. */
export function ExpenseList({ expenses, members, myUserId, editHref, onChanged }: ExpenseListProps) {
  const [settlingId, setSettlingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { nameOf } = memberLookup(members);
  const hasMembers = members.length > 0;
  const settledCount = expenses.filter((expense) => expense.settledAt).length;

  if (expenses.length === 0) {
    return (
      <EmptyView
        title="Chưa có khoản chi nào"
        hint={
          hasMembers
            ? 'Bấm "Thêm khoản chi" ở trên để ghi khoản đầu tiên.'
            : 'Thêm thành viên trước, rồi mới ghi được khoản chi.'
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {error ? <ErrorView message={error} /> : null}
      {settledCount === 0 ? (
        <p className="px-1 text-xs text-muted-foreground">
          Chạm vòng tròn bên trái một khoản chi khi mọi người đã trả xong khoản đó.
        </p>
      ) : (
        <p className="px-1 text-xs leading-5 text-muted-foreground">
          {settledCount} khoản đã xong không tính vào số dư. Chỉ đánh dấu khi mọi người đã trả đủ RIÊNG
          khoản đó — nếu trả theo "Chi tiết người trả" (đã gộp nhiều khoản) thì đánh dấu hết các khoản
          cùng lúc.
        </p>
      )}

      <ul className="flex flex-col gap-3">
        {expenses.map((expense) => {
          const settled = expense.settledAt !== null;
          return (
            <li
              key={expense.id}
              className={`flex items-stretch rounded-2xl border border-border bg-card shadow-sm ${settled ? 'opacity-60' : ''}`}>
              <SettleToggle
                expense={expense}
                members={members}
                myUserId={myUserId}
                disabled={settlingId !== null && settlingId !== expense.id}
                onBusyChange={setSettlingId}
                onDone={onChanged}
                onError={setError}
              />
              <Link
                to={editHref(expense.id)}
                aria-label={`Sửa khoản chi ${expense.description}`}
                className="min-w-0 flex-1 rounded-r-2xl py-4 pr-4 hover:bg-muted/40 active:bg-muted">
                <span className="flex items-start justify-between gap-3">
                  <span className={`min-w-0 flex-1 break-words text-base font-medium text-foreground ${settled ? 'line-through' : ''}`}>
                    {expense.description}
                  </span>
                  <span className="whitespace-nowrap text-base font-semibold text-foreground">
                    {formatMoney(expense.total)}
                  </span>
                </span>
                <span className="mt-1 flex items-center justify-between">
                  <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                    {nameOf(expense.paidByMemberId)} ứng · {formatRelativeDateTime(new Date(expense.paidAt))}
                  </span>
                  {settled ? (
                    <span className="pl-2 text-xs font-semibold text-positive">Đã xong</span>
                  ) : (
                    <span className="pl-2 text-xs font-medium text-accent-strong">Sửa ›</span>
                  )}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
