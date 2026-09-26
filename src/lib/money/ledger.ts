/**
 * Sổ cái giải thích số dư — trả lời câu "vì sao tôi phải chuyển số tiền này?".
 *
 * Hai góc nhìn, cùng đi từ danh sách khoản chi gốc:
 *
 *  1. Bảng kê từng người (buildStatements): mỗi khoản chi người đó đã ứng bao
 *     nhiêu, phải chịu bao nhiêu, chênh lệch ra sao → cộng lại thành số dư.
 *     Số dư ở đây PHẢI bằng đúng computeBalances — test khoá điều này.
 *
 *  2. Nợ trực tiếp từng cặp (pairwiseDebts): mỗi phần chia là "người chịu nợ
 *     người ứng". Hai người nợ qua lại thì bù trừ cho nhau, còn lại một chiều.
 *     Đây là cách "ai nợ ai trả nấy" — nhiều lần chuyển hơn tối giản, nhưng mỗi
 *     giao dịch truy ngược được về từng khoản chi cụ thể.
 *
 * Cả hai đều bỏ qua khoản đã xoá và khoản đã đánh dấu xong, và tính cả các lần
 * tất toán đã ghi — cùng ngữ nghĩa với view trip_balances.
 */

import type { Balance, Transfer } from './balance.ts';
import type { CurrencyCode } from './currency.ts';
import type { Money } from './money.ts';
import { MoneyError, money } from './money.ts';
import type { SplitLine } from './split.ts';

export interface LedgerExpense {
  readonly id: string;
  readonly description: string;
  readonly paidAt: string;
  readonly payerId: string;
  readonly total: Money;
  readonly shares: readonly SplitLine[];
  /** Đã đánh dấu xong hoặc đã xoá — không tính vào số dư. */
  readonly excluded?: boolean;
}

export interface LedgerSettlement {
  readonly id: string;
  readonly fromId: string;
  readonly toId: string;
  readonly amount: Money;
}

export interface StatementLine {
  readonly expenseId: string;
  readonly description: string;
  readonly paidAt: string;
  /** Tiền người này đã ứng cho khoản chi. */
  readonly paid: Money;
  /** Phần người này phải chịu. */
  readonly owed: Money;
  /** paid − owed: dương là được nhận lại từ khoản này. */
  readonly delta: Money;
}

export interface MemberStatement {
  readonly participantId: string;
  readonly lines: readonly StatementLine[];
  readonly paidTotal: Money;
  readonly owedTotal: Money;
  /** Tiền đã chuyển đi / nhận về qua các lần tất toán đã ghi. */
  readonly settledOut: Money;
  readonly settledIn: Money;
  /** paidTotal − owedTotal + settledOut − settledIn. */
  readonly net: Money;
}

function assertCurrency(amount: Money, currency: CurrencyCode, where: string): void {
  if (amount.currency !== currency) {
    throw new MoneyError(`${where} dùng ${amount.currency} nhưng chuyến đi tính bằng ${currency}.`);
  }
}

/** Khoản chi còn hiệu lực, đã kiểm tiền tệ và bất biến tổng. */
function activeExpenses(
  expenses: readonly LedgerExpense[],
  currency: CurrencyCode,
): LedgerExpense[] {
  const active = expenses.filter((expense) => !expense.excluded);
  for (const expense of active) {
    assertCurrency(expense.total, currency, `Khoản "${expense.description}"`);
    let sum = 0;
    for (const share of expense.shares) {
      assertCurrency(share.amount, currency, `Khoản "${expense.description}"`);
      sum += share.amount.minor;
    }
    if (sum !== expense.total.minor) {
      throw new MoneyError(
        `Khoản "${expense.description}" không cân: tổng ${expense.total.minor} nhưng chia ${sum}.`,
      );
    }
  }
  return active;
}

/**
 * Bảng kê của từng người. Người không dính khoản nào vẫn có mặt với số dư 0
 * (nếu có trong participantIds). Dòng xếp theo thời gian chi, cũ trước.
 */
export function buildStatements(
  expenses: readonly LedgerExpense[],
  settlements: readonly LedgerSettlement[],
  currency: CurrencyCode,
  participantIds: readonly string[] = [],
): MemberStatement[] {
  const active = activeExpenses(expenses, currency).sort(
    (a, b) => a.paidAt.localeCompare(b.paidAt) || a.id.localeCompare(b.id),
  );

  const ids = new Set(participantIds);
  for (const expense of active) {
    ids.add(expense.payerId);
    for (const share of expense.shares) ids.add(share.participantId);
  }
  for (const settlement of settlements) {
    ids.add(settlement.fromId);
    ids.add(settlement.toId);
  }

  return [...ids].sort().map((id) => {
    const lines: StatementLine[] = [];
    let paidTotal = 0;
    let owedTotal = 0;

    for (const expense of active) {
      const paid = expense.payerId === id ? expense.total.minor : 0;
      const owed = expense.shares
        .filter((share) => share.participantId === id)
        .reduce((sum, share) => sum + share.amount.minor, 0);
      if (paid === 0 && owed === 0) continue;
      paidTotal += paid;
      owedTotal += owed;
      lines.push({
        expenseId: expense.id,
        description: expense.description,
        paidAt: expense.paidAt,
        paid: money(paid, currency),
        owed: money(owed, currency),
        delta: money(paid - owed, currency),
      });
    }

    let settledOut = 0;
    let settledIn = 0;
    for (const settlement of settlements) {
      assertCurrency(settlement.amount, currency, 'Lần tất toán');
      if (settlement.fromId === id) settledOut += settlement.amount.minor;
      if (settlement.toId === id) settledIn += settlement.amount.minor;
    }

    return {
      participantId: id,
      lines,
      paidTotal: money(paidTotal, currency),
      owedTotal: money(owedTotal, currency),
      settledOut: money(settledOut, currency),
      settledIn: money(settledIn, currency),
      net: money(paidTotal - owedTotal + settledOut - settledIn, currency),
    };
  });
}

export function statementsToBalances(statements: readonly MemberStatement[]): Balance[] {
  return statements.map((statement) => ({
    participantId: statement.participantId,
    net: statement.net,
  }));
}

/** Một khoản làm phát sinh nợ trực tiếp giữa hai người. */
export interface PairItem {
  /** id khoản chi, hoặc id lần tất toán. */
  readonly sourceId: string;
  readonly kind: 'expense' | 'settlement';
  readonly description: string;
  readonly amount: Money;
}

export interface PairDebt extends Transfer {
  /** Các khoản làm `from` nợ `to`. */
  readonly owedItems: readonly PairItem[];
  /** Các khoản ngược chiều (`to` nợ `from`) đã được bù trừ đi. */
  readonly offsetItems: readonly PairItem[];
  /** Tổng hai chiều trước khi bù trừ. */
  readonly owedTotal: Money;
  readonly offsetTotal: Money;
  /**
   * Phần nợ đi vòng qua người khác đã triệt tiêu (A nợ B, B nợ C, C nợ A →
   * không ai phải chuyển phần chung đó). amount = owedTotal − offsetTotal − cycleOffset.
   */
  readonly cycleOffset: Money;
}

const PAIR_SEPARATOR = '\u0000';

/**
 * Triệt tiêu các vòng nợ: A→B→C→A cùng có nợ thì trừ phần nhỏ nhất trên vòng
 * khỏi mọi cạnh của vòng. Không đổi số dư ròng của ai — mỗi người trên vòng bớt
 * một khoản phải trả và một khoản được nhận bằng nhau.
 *
 * Bắt buộc phải có: một lần tất toán đi theo đường TỐI GIẢN (C trả thẳng A thay
 * cho chuỗi C→B→A) được ghi thành "A nợ lại C", và bù trừ theo cặp không nhìn
 * thấy vòng C→B→A→C. Thiếu bước này, màn "Trả trực tiếp" bảo B — người đã hết
 * nợ — chuyển tiền cho A.
 *
 * `edges` bị sửa tại chỗ. Duyệt theo id đã sắp xếp nên kết quả tất định.
 * Trả về lượng đã triệt tiêu trên từng cạnh.
 */
function cancelCycles(edges: Map<string, Map<string, number>>): Map<string, number> {
  const reduced = new Map<string, number>();

  const findCycle = (): string[] | null => {
    const state = new Map<string, 1 | 2>();
    const stack: string[] = [];
    const visit = (node: string): string[] | null => {
      state.set(node, 1);
      stack.push(node);
      const next = [...(edges.get(node)?.keys() ?? [])].sort();
      for (const to of next) {
        const mark = state.get(to);
        if (mark === 1) return stack.slice(stack.indexOf(to));
        if (mark === undefined) {
          const found = visit(to);
          if (found) return found;
        }
      }
      stack.pop();
      state.set(node, 2);
      return null;
    };
    for (const node of [...edges.keys()].sort()) {
      if (state.has(node)) continue;
      const found = visit(node);
      if (found) return found;
    }
    return null;
  };

  for (let cycle = findCycle(); cycle !== null; cycle = findCycle()) {
    const ring = cycle;
    const hops = ring.map((from, index) => [from, ring[(index + 1) % ring.length]] as const);
    const smallest = Math.min(...hops.map(([from, to]) => edges.get(from)!.get(to)!));
    for (const [from, to] of hops) {
      const out = edges.get(from)!;
      const left = out.get(to)! - smallest;
      if (left === 0) out.delete(to);
      else out.set(to, left);
      const key = from + PAIR_SEPARATOR + to;
      reduced.set(key, (reduced.get(key) ?? 0) + smallest);
    }
  }
  return reduced;
}

/**
 * Nợ trực tiếp từng cặp: bù trừ hai chiều, rồi triệt tiêu vòng nợ. Áp toàn bộ
 * kết quả như các giao dịch thì mọi người về 0 — cùng đích với simplifyDebts,
 * chỉ khác đường đi.
 */
export function pairwiseDebts(
  expenses: readonly LedgerExpense[],
  settlements: readonly LedgerSettlement[],
  currency: CurrencyCode,
): PairDebt[] {
  // Khoá theo cặp (debtor, creditor) có hướng.
  const gross = new Map<
    string,
    { debtor: string; creditor: string; items: PairItem[]; total: number }
  >();
  const add = (debtor: string, creditor: string, item: PairItem): void => {
    if (debtor === creditor || item.amount.minor === 0) return;
    const key = `${debtor}\u0000${creditor}`;
    const entry = gross.get(key) ?? { debtor, creditor, items: [], total: 0 };
    entry.items.push(item);
    entry.total += item.amount.minor;
    gross.set(key, entry);
  };

  for (const expense of activeExpenses(expenses, currency)) {
    for (const share of expense.shares) {
      add(share.participantId, expense.payerId, {
        sourceId: expense.id,
        kind: 'expense',
        description: expense.description,
        amount: share.amount,
      });
    }
  }

  // Tất toán A → B nghĩa là A đã trả bớt: tương đương "B nợ lại A" số đó.
  for (const settlement of settlements) {
    assertCurrency(settlement.amount, currency, 'Lần tất toán');
    add(settlement.toId, settlement.fromId, {
      sourceId: settlement.id,
      kind: 'settlement',
      description: 'Đã chuyển trả',
      amount: settlement.amount,
    });
  }

  // Bước 1 — bù trừ hai chiều cho từng cặp.
  interface Netted {
    readonly from: string;
    readonly to: string;
    readonly owedItems: readonly PairItem[];
    readonly offsetItems: readonly PairItem[];
    readonly owedTotal: number;
    readonly offsetTotal: number;
  }
  const netted: Netted[] = [];
  const seen = new Set<string>();
  for (const entry of gross.values()) {
    const pair = [entry.debtor, entry.creditor].sort().join(PAIR_SEPARATOR);
    if (seen.has(pair)) continue;
    seen.add(pair);

    const reverse = gross.get(entry.creditor + PAIR_SEPARATOR + entry.debtor);
    const forwardTotal = entry.total;
    const reverseTotal = reverse?.total ?? 0;
    if (forwardTotal === reverseTotal) continue;

    const forwardWins = forwardTotal > reverseTotal;
    const winner = forwardWins ? entry : reverse!;
    const loser = forwardWins ? reverse : entry;
    netted.push({
      from: winner.debtor,
      to: winner.creditor,
      owedItems: winner.items,
      offsetItems: loser?.items ?? [],
      owedTotal: winner.total,
      offsetTotal: loser?.total ?? 0,
    });
  }

  // Bước 2 — triệt tiêu vòng nợ đi qua nhiều người.
  const edges = new Map<string, Map<string, number>>();
  for (const debt of netted) {
    const out = edges.get(debt.from) ?? new Map<string, number>();
    out.set(debt.to, debt.owedTotal - debt.offsetTotal);
    edges.set(debt.from, out);
    if (!edges.has(debt.to)) edges.set(debt.to, new Map());
  }
  const reduced = cancelCycles(edges);

  const debts: PairDebt[] = [];
  for (const debt of netted) {
    const remaining = edges.get(debt.from)?.get(debt.to) ?? 0;
    if (remaining <= 0) continue;
    debts.push({
      from: debt.from,
      to: debt.to,
      amount: money(remaining, currency),
      owedItems: debt.owedItems,
      offsetItems: debt.offsetItems,
      owedTotal: money(debt.owedTotal, currency),
      offsetTotal: money(debt.offsetTotal, currency),
      cycleOffset: money(reduced.get(debt.from + PAIR_SEPARATOR + debt.to) ?? 0, currency),
    });
  }

  return debts.sort(
    (a, b) =>
      b.amount.minor - a.amount.minor || a.from.localeCompare(b.from) || a.to.localeCompare(b.to),
  );
}
