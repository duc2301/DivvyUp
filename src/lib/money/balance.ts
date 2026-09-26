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
 * Số người có số dư khác 0 — SAU khi đã tách các cặp khớp đúng số tiền — tối đa
 * để còn tìm lời giải TỐI ƯU bằng duyệt mọi tập con, O(2^n · n). 14 người ≈
 * 230 nghìn bước: vài ms kể cả trên Hermes (không có JIT). Vượt ngưỡng thì dùng
 * tham lam: vẫn đúng tiền, chỉ có thể thừa vài lần chuyển.
 */
export const MAX_EXACT_SIMPLIFY = 14;

interface Party {
  readonly id: string;
  remaining: number;
}

/**
 * Ghép tham lam trong MỘT nhóm có tổng bằng 0: người nợ nhiều nhất trả người
 * được nhận nhiều nhất. Nhóm k người cho tối đa k-1 giao dịch.
 */
function settleGreedy(
  nets: readonly { id: string; minor: number }[],
  currency: CurrencyCode,
): Transfer[] {
  // Sắp xếp tất định: giá trị trước, id sau. Cùng đầu vào luôn ra cùng kết quả.
  const debtors: Party[] = nets
    .filter((item) => item.minor < 0)
    .map((item) => ({ id: item.id, remaining: -item.minor }))
    .sort((a, b) => b.remaining - a.remaining || a.id.localeCompare(b.id));
  const creditors: Party[] = nets
    .filter((item) => item.minor > 0)
    .map((item) => ({ id: item.id, remaining: item.minor }))
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
 * Chia những người có số dư ≠ 0 thành NHIỀU NHÓM NHẤT có thể mà mỗi nhóm tự
 * cân (tổng bằng 0). Số giao dịch tối thiểu của cả chuyến đúng bằng
 * (số người) − (số nhóm), nên nhiều nhóm hơn = ít lần chuyển hơn.
 *
 * Quy hoạch động trên tập con: best[mask] = số nhóm cân nhiều nhất có thể xếp
 * được từ các phần tử trong mask. Duyệt ngược để lấy ra thứ tự thêm phần tử;
 * mỗi lần tổng tiền tố về 0 là đóng một nhóm.
 */
function zeroSumGroups(
  nets: readonly { id: string; minor: number }[],
): { id: string; minor: number }[][] {
  const n = nets.length;
  const size = 1 << n;
  const sum = new Float64Array(size);
  const best = new Int16Array(size);

  for (let mask = 1; mask < size; mask += 1) {
    const low = mask & -mask;
    const index = 31 - Math.clz32(low);
    sum[mask] = sum[mask ^ low] + nets[index].minor;
    let value = -1;
    for (let i = 0; i < n; i += 1) {
      const bit = 1 << i;
      if ((mask & bit) !== 0 && best[mask ^ bit] > value) value = best[mask ^ bit];
    }
    best[mask] = value + (sum[mask] === 0 ? 1 : 0);
  }

  // Lấy lại thứ tự: từ tập đầy, bỏ dần phần tử (chỉ số nhỏ nhất thoả) sao cho
  // vẫn giữ được giá trị tối ưu — tất định vì luôn thử theo thứ tự chỉ số.
  const removal: number[] = [];
  let mask = size - 1;
  while (mask !== 0) {
    const target = best[mask] - (sum[mask] === 0 ? 1 : 0);
    for (let i = 0; i < n; i += 1) {
      const bit = 1 << i;
      if ((mask & bit) !== 0 && best[mask ^ bit] === target) {
        removal.push(i);
        mask ^= bit;
        break;
      }
    }
  }

  const groups: { id: string; minor: number }[][] = [];
  let current: { id: string; minor: number }[] = [];
  let running = 0;
  for (const index of removal.reverse()) {
    current.push(nets[index]);
    running += nets[index].minor;
    if (running === 0) {
      groups.push(current);
      current = [];
    }
  }
  return groups;
}

/**
 * Tối giản công nợ: từ danh sách số dư, sinh ra tập giao dịch để ai cũng về 0.
 *
 * Luôn tách trước các cặp khớp đúng số tiền. Phần còn lại tới
 * MAX_EXACT_SIMPLIFY người: lời giải TỐI ƯU về số lần chuyển (tách thành nhiều
 * nhóm tự cân nhất, rồi ghép tham lam trong từng nhóm). Nhiều hơn: tham lam.
 * Cả hai đường đều cho tối đa n-1 giao dịch và KHÔNG đổi số dư của ai.
 *
 * Lưu ý khi giải thích cho người dùng: giao dịch là để CÂN SỐ DƯ, không phải
 * trả lại đúng người đã ứng tiền cho mình. A có thể chuyển cho C dù chưa từng
 * chi chung với C — tổng tiền A trả ra và C nhận về vẫn đúng từng đồng.
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

  const nets = balances
    .filter((balance) => balance.net.minor !== 0)
    .map((balance) => ({ id: balance.participantId, minor: balance.net.minor }))
    .sort((a, b) => a.id.localeCompare(b.id));
  if (nets.length === 0) return [];

  // Tách trước các cặp khớp đúng số tiền: mỗi cặp là một nhóm cân hai người và
  // luôn nằm trong một lời giải tối ưu (đổi chỗ được với mọi cách chia nhóm có
  // chứa hai người đó). Vừa giữ tối ưu vừa làm phần duyệt tập con nhỏ đi nhiều.
  const transfers: Transfer[] = [];
  const used = new Set<number>();
  for (let i = 0; i < nets.length; i += 1) {
    if (used.has(i) || nets[i].minor >= 0) continue;
    for (let j = 0; j < nets.length; j += 1) {
      if (!used.has(j) && nets[j].minor === -nets[i].minor) {
        used.add(i);
        used.add(j);
        transfers.push({
          from: nets[i].id,
          to: nets[j].id,
          amount: money(nets[j].minor, currency),
        });
        break;
      }
    }
  }
  const rest = nets.filter((_, index) => !used.has(index));
  if (rest.length === 0) return transfers;

  const settled =
    rest.length <= MAX_EXACT_SIMPLIFY
      ? zeroSumGroups(rest).flatMap((group) => settleGreedy(group, currency))
      : settleGreedy(rest, currency);
  return transfers.concat(settled);
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
