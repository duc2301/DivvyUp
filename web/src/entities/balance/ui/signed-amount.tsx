import type { Money } from '@/shared/lib/money';

import { signed, toneOf } from '../lib/sign';

interface SignedAmountProps {
  readonly amount: Money;
  readonly className?: string;
}

/** Số tiền có dấu +/− và màu dương/âm. */
export function SignedAmount({ amount, className = 'text-base font-semibold' }: SignedAmountProps) {
  const label = amount.minor > 0 ? 'được nhận lại' : amount.minor < 0 ? 'đang nợ' : 'đã cân';
  return (
    <span title={label} className={`whitespace-nowrap ${toneOf(amount)} ${className}`}>
      {signed(amount)}
    </span>
  );
}
