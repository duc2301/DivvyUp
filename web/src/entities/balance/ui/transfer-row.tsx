import { ArrowRight } from 'lucide-react';

import type { Money } from '@/shared/lib/money';
import { formatMoney } from '@/shared/lib/money';
import { Avatar } from '@/shared/ui';

export interface TransferPerson {
  readonly name: string;
  readonly avatarUrl: string | null;
  /** Chỗ chưa ai nhận trong app — avatar viền đứt. */
  readonly pending: boolean;
}

interface TransferRowProps {
  readonly from: TransferPerson;
  readonly to: TransferPerson;
  readonly amount: Money;
  readonly onClick?: () => void;
  /** Dòng phụ dưới mũi tên, ví dụ "2 khoản · chạm để xem". */
  readonly caption?: string;
}

function Person({ person }: { readonly person: TransferPerson }) {
  return (
    <div className="flex w-20 shrink-0 flex-col items-center gap-1">
      <Avatar name={person.name} uri={person.avatarUrl} size="md" pending={person.pending} />
      <span className="line-clamp-2 text-center text-xs font-medium leading-4 text-foreground">
        {person.name}
      </span>
    </div>
  );
}

/**
 * "A chuyển cho B": avatar TRÊN tên cho CẢ người gửi và người nhận, số tiền +
 * mũi tên ở giữa — đọc trái sang phải đúng chiều tiền đi.
 */
export function TransferRow({ from, to, amount, onClick, caption }: TransferRowProps) {
  const label = `${from.name} chuyển ${formatMoney(amount)} cho ${to.name}`;
  const body = (
    <div className="flex items-start gap-1 py-2.5">
      <Person person={from} />
      <div className="flex min-w-0 flex-1 flex-col items-center pt-1.5">
        <span className="max-w-full truncate text-base font-bold text-foreground">
          {formatMoney(amount)}
        </span>
        <span className="mt-0.5 flex h-5 w-full items-center text-primary" aria-hidden>
          <span className="h-px flex-1 bg-border" />
          <ArrowRight size={18} />
        </span>
        {caption ? (
          <span className="mt-0.5 max-w-full truncate text-[11px] text-muted-foreground">{caption}</span>
        ) : null}
      </div>
      <Person person={to} />
    </div>
  );

  if (!onClick) {
    return (
      <div role="group" aria-label={label}>
        {body}
      </div>
    );
  }
  return (
    <button
      type="button"
      aria-label={`${label}. Chạm để xem chi tiết`}
      onClick={onClick}
      className="-mx-2 block w-[calc(100%+1rem)] rounded-2xl px-2 text-left hover:bg-muted/60 active:bg-muted">
      {body}
    </button>
  );
}
