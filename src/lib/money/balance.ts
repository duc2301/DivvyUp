/**
 * Tính số dư của từng người và tối giản công nợ.
 *
 * Quy ước dấu:  net > 0 nghĩa là người đó ĐƯỢC NHẬN LẠI,
 *               net < 0 nghĩa là người đó ĐANG NỢ.
 *
 * Hai bất biến:
 *   1. Tổng net của cả nhóm luôn bằng 0.
 *   2. simplifyDebts() không làm thay đổi net của bất kỳ ai — nó chỉ gộp
 *      đường đi của tiền, không đổi ai được bao nhiêu.
 *
 * Số dư luôn được tính lại từ đầu, từ danh sách khoản chi. Không cộng dồn theo
 * delta: cộng dồn sẽ trôi dần và không có cách nào sửa lại cho đúng.
 */

import type { CurrencyCode } from './currency.ts';
import type { Money } from './money.ts';
import { MoneyError, money } from './money.ts';
import type { SplitLine } from './split.ts';

export interface Payment {
  readonly participantId: string;
  readonly amount: Money;
}

export interface ExpenseRecord {
  readonly id: string;
  /** Ai đã ứng tiền. Hỗ trợ nhiều người cùng trả một khoản. */
  readonly payments: readonly Payment[];
  /** Ai gánh bao nhiêu — kết quả của splitExpense(). */
  readonly shares: readonly SplitLine[];
  /** Xoá mềm: khoản chi bị huỷ vẫn giữ lại để truy vết, nhưng không tính vào số dư. */
  readonly voided?: boolean;
}

export interface Balance {
  readonly participantId: string;
  readonly net: Money;
}

export interface Transfer {
  readonly from: string;
  readonly to: string;
  readonly amount: Money;
}

/**
 * Tính số dư ròng của từng người.
 *
 * Ném MoneyError nếu một khoản chi có tổng tiền ứng khác tổng phần chia —
 * đó là dữ liệu hỏng, và im lặng bỏ qua sẽ khiến số dư sai mà không ai biết.
 */
export function computeBalances(
  expenses: readonly ExpenseRecord[],
  currency: CurrencyCode,
  participantIds?: readonly string[],
): Balance[] {
  const net = new Map<string, number>();

  const touch = (id: string): void => {
    if (!net.has(id)) net.set(id, 0);
  };

  for (const id of participantIds ?? []) touch(id);

  for (const expense of expenses) {
    if (expense.voided) continue;

    let paidTotal = 0;
    for (const payment of expense.payments) {
      if (payment.amount.currency !== currency) {
        throw new MoneyError(
          `Khoản chi "${expense.id}" dùng ${payment.amount.currency} nhưng đang tính số dư theo ${currency}.`,
        );
      }
      touch(payment.participantId);
      net.set(payment.participantId, net.get(payment.participantId)! + payment.amount.minor);
      paidTotal += payment.amount.minor;
    }

    let owedTotal = 0;
    for (const share of expense.shares) {
      if (share.amount.currency !== currency) {
        throw new MoneyError(
          `Khoản chi "${expense.id}" dùng ${share.amount.currency} nhưng đang tính số dư theo ${currency}.`,
        );
      }
      touch(share.participantId);
      net.set(share.participantId, net.get(share.participantId)! - share.amount.minor);
      owedTotal += share.amount.minor;
    }

    if (paidTotal !== owedTotal) {
      throw new MoneyError(
        `Khoản chi "${expense.id}" không cân: đã ứng ${paidTotal} nhưng chia ${owedTotal} (đơn vị nhỏ nhất).`,
      );
    }
  }

  return [...net.entries()]
    .map(([participantId, minor]) => ({ participantId, net: money(minor, currency) }))
    .sort((a, b) => a.participantId.localeCompare(b.participantId));
}

/**
 * Tối giản công nợ: từ danh sách số dư, sinh ra tập giao dịch ít nhất có thể
 * bằng thuật toán tham lam (ghép người nợ nhiều nhất với người được nhận nhiều nhất).
 *
 * Kết quả tối đa n-1 giao dịch. Đây không phải lời giải tối ưu tuyệt đối
 * (bài toán đó là NP-hard), nhưng tốt hơn hẳn việc ai nợ ai trả nấy và
 * đủ tốt cho quy mô một nhóm bạn.
 */
export function simplifyDebts(balances: readonly Balance[]): Transfer[] {
  if (balances.length === 0) return [];

  const currency = balances[0].net.currency;
  for (const balance of balances) {
    if (balance.net.currency !== currency) {
      throw new MoneyError('Không thể tối giản công nợ trên nhiều đơn vị tiền tệ.');
    }
  }

  const sum = balances.reduce((acc, balance) => acc + balance.net.minor, 0);
  if (sum !== 0) {
    throw new MoneyError(`Tổng số dư của nhóm phải bằng 0, đang là ${sum} (đơn vị nhỏ nhất).`);
  }

  // Sắp xếp tất định: giá trị trước, id sau. Cùng đầu vào luôn ra cùng kết quả.
  const debtors = balances
    .filter((balance) => balance.net.minor < 0)
    .map((balance) => ({ id: balance.participantId, remaining: -balance.net.minor }))
    .sort((a, b) => b.remaining - a.remaining || a.id.localeCompare(b.id));

  const creditors = balances
    .filter((balance) => balance.net.minor > 0)
    .map((balance) => ({ id: balance.participantId, remaining: balance.net.minor }))
    .sort((a, b) => b.remaining - a.remaining || a.id.localeCompare(b.id));

  const transfers: Transfer[] = [];
  let debtorIndex = 0;
  let creditorIndex = 0;

  while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
    const debtor = debtors[debtorIndex];
    const creditor = creditors[creditorIndex];
    const amount = Math.min(debtor.remaining, creditor.remaining);

    if (amount > 0) {
      transfers.push({ from: debtor.id, to: creditor.id, amount: money(amount, currency) });
      debtor.remaining -= amount;
      creditor.remaining -= amount;
    }

    if (debtor.remaining === 0) debtorIndex += 1;
    if (creditor.remaining === 0) creditorIndex += 1;
  }

  return transfers;
}

/**
 * Áp một tập giao dịch lên số dư. Dùng để kiểm chứng: sau khi áp toàn bộ
 * giao dịch do simplifyDebts sinh ra, mọi số dư phải về 0.
 */
export function applyTransfers(
  balances: readonly Balance[],
  transfers: readonly Transfer[],
): Balance[] {
  const net = new Map<string, number>();
  let currency: CurrencyCode | null = null;

  for (const balance of balances) {
    net.set(balance.participantId, balance.net.minor);
    currency = balance.net.currency;
  }
  if (currency === null) return [];

  for (const transfer of transfers) {
    // Người nợ trả tiền đi → số dư âm của họ tiến về 0.
    net.set(transfer.from, (net.get(transfer.from) ?? 0) + transfer.amount.minor);
    net.set(transfer.to, (net.get(transfer.to) ?? 0) - transfer.amount.minor);
  }

  return [...net.entries()]
    .map(([participantId, minor]) => ({ participantId, net: money(minor, currency!) }))
    .sort((a, b) => a.participantId.localeCompare(b.participantId));
}
