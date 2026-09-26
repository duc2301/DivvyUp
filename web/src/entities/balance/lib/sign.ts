import type { Money } from '@/shared/lib/money';
import { formatMoney } from '@/shared/lib/money';

/** Số dư kèm dấu +/−: không chỉ dựa vào màu (người mù màu đọc dấu). */
export function signed(amount: Money): string {
  return amount.minor === 0 ? '0' : formatMoney(amount, { signDisplay: 'always' });
}

export function toneOf(amount: Money): string {
  if (amount.minor > 0) return 'text-positive';
  if (amount.minor < 0) return 'text-negative';
  return 'text-muted-foreground';
}
