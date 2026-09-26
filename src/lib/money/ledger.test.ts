import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { Balance, ExpenseRecord } from './balance.ts';
import { applyTransfers, computeBalances } from './balance.ts';
import type { LedgerExpense, LedgerSettlement, MemberStatement, PairDebt } from './ledger.ts';
import { buildStatements, pairwiseDebts, statementsToBalances } from './ledger.ts';
import { MoneyError, money } from './money.ts';
import { splitExpense } from './split.ts';

// ---------------------------------------------------------------------------
// Tiện ích
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function makeRng(seed: number) {
  const next = mulberry32(seed);
  const int = (lo: number, hi: number): number => lo + Math.floor(next() * (hi - lo + 1));
  const pick = <T>(items: readonly T[]): T => items[int(0, items.length - 1)];
  const shuffle = <T>(items: readonly T[]): T[] => {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = int(0, i);
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  };
  return { next, int, pick, shuffle };
}

function equalLedger(
  id: string,
  payerId: string,
  totalMinor: number,
  ids: string[],
  extra: Partial<LedgerExpense> = {},
): LedgerExpense {
  const total = money(totalMinor, 'VND');
  const result = splitExpense({
    total,
    participantIds: ids,
    mode: 'equal',
    remainderPriority: [payerId],
  });
  if (!result.ok) throw new Error(result.error);
  return {
    id,
    description: `Khoản ${id}`,
    paidAt: `2026-09-01T00:00:${id.padStart(2, '0')}`,
    payerId,
    total,
    shares: result.lines,
    ...extra,
  };
}

function exactLedger(
  id: string,
  payerId: string,
  exact: Record<string, number>,
  extra: Partial<LedgerExpense> = {},
): LedgerExpense {
  const totalMinor = Object.values(exact).reduce((a, b) => a + b, 0);
  const total = money(totalMinor, 'VND');
  const result = splitExpense({
    total,
    participantIds: Object.keys(exact),
    mode: 'exact',
    exactMinor: exact,
  });
  if (!result.ok) throw new Error(result.error);
  return {
    id,
    description: `Khoản ${id}`,
    paidAt: `2026-09-01T00:00:${id.padStart(2, '0')}`,
    payerId,
    total,
    shares: result.lines,
    ...extra,
  };
}

function settle(id: string, fromId: string, toId: string, amount: number): LedgerSettlement {
  return { id, fromId, toId, amount: money(amount, 'VND') };
}

function toRecord(expense: LedgerExpense): ExpenseRecord {
  return {
    id: expense.id,
    payments: [{ participantId: expense.payerId, amount: expense.total }],
    shares: expense.shares,
    voided: expense.excluded,
  };
}

function netMap(balances: readonly Balance[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const balance of balances) out[balance.participantId] = balance.net.minor;
  return out;
}

const sumMinor = (items: readonly { amount: { minor: number } }[]): number =>
  items.reduce((sum, item) => sum + item.amount.minor, 0);

function assertStatementArithmetic(statements: readonly MemberStatement[], label: string): void {
  for (const s of statements) {
    let deltaSum = 0;
    let paidSum = 0;
    let owedSum = 0;
    for (const line of s.lines) {
      assert.equal(
        line.delta.minor,
        line.paid.minor - line.owed.minor,
        `${label}: delta ≠ paid − owed (${s.participantId}/${line.expenseId})`,
      );
      deltaSum += line.delta.minor;
      paidSum += line.paid.minor;
      owedSum += line.owed.minor;
    }
    assert.equal(s.paidTotal.minor, paidSum, `${label}: paidTotal ${s.participantId}`);
    assert.equal(s.owedTotal.minor, owedSum, `${label}: owedTotal ${s.participantId}`);
    assert.equal(
      deltaSum + s.settledOut.minor - s.settledIn.minor,
      s.net.minor,
      `${label}: Σdelta + settledOut − settledIn ≠ net (${s.participantId})`,
    );
  }
}

function assertPairInvariants(
  debts: readonly PairDebt[],
  statements: readonly MemberStatement[],
  excludedIds: ReadonlySet<string>,
  label: string,
): void {
  const pairs = new Set<string>();
  for (const debt of debts) {
    assert.notEqual(debt.from, debt.to, `${label}: nợ chính mình`);
    assert.ok(debt.amount.minor > 0, `${label}: amount ≤ 0`);
    const key = [debt.from, debt.to].sort().join('|');
    assert.ok(!pairs.has(key), `${label}: cặp ${key} xuất hiện hai lần`);
    pairs.add(key);
    assert.ok(debt.cycleOffset.minor >= 0, `${label}: cycleOffset âm`);
    assert.equal(
      debt.amount.minor,
      debt.owedTotal.minor - debt.offsetTotal.minor - debt.cycleOffset.minor,
      `${label}: amount ≠ owed − offset − cycleOffset`,
    );
    assert.equal(
      debt.owedTotal.minor,
      sumMinor(debt.owedItems),
      `${label}: owedTotal ≠ Σ owedItems`,
    );
    assert.equal(
      debt.offsetTotal.minor,
      sumMinor(debt.offsetItems),
      `${label}: offsetTotal ≠ Σ offsetItems`,
    );
    for (const item of [...debt.owedItems, ...debt.offsetItems]) {
      assert.ok(
        !excludedIds.has(item.sourceId),
        `${label}: khoản excluded ${item.sourceId} lọt vào`,
      );
    }
  }
  // Kết quả không được còn vòng nợ: vòng nghĩa là có người được bảo chuyển
  // tiền đi rồi nhận lại chính số đó — người đã hết nợ vẫn phải chuyển.
  const next = new Map<string, string[]>();
  for (const debt of debts) next.set(debt.from, [...(next.get(debt.from) ?? []), debt.to]);
  const state = new Map<string, number>();
  const hasCycle = (node: string): boolean => {
    state.set(node, 1);
    for (const to of next.get(node) ?? []) {
      if (state.get(to) === 1) return true;
      if (!state.has(to) && hasCycle(to)) return true;
    }
    state.set(node, 2);
    return false;
  };
  assert.ok(
    ![...next.keys()].some((node) => !state.has(node) && hasCycle(node)),
    `${label}: còn vòng nợ`,
  );

  const settled = applyTransfers(statementsToBalances(statements), debts);
  assert.ok(
    settled.every((b) => b.net.minor === 0),
    `${label}: áp pairwise chưa về 0 — ${JSON.stringify(settled.filter((b) => b.net.minor !== 0))}`,
  );
}

/** Nợ ròng từng cặp tính độc lập: key "a|b" (a<b) → số dương nghĩa là a nợ b. */
function independentPairs(
  expenses: readonly LedgerExpense[],
  settlements: readonly LedgerSettlement[],
): Map<string, number> {
  const out = new Map<string, number>();
  const owe = (debtor: string, creditor: string, amount: number) => {
    if (debtor === creditor || amount === 0) return;
    const [a, b] = debtor < creditor ? [debtor, creditor] : [creditor, debtor];
    const sign = debtor < creditor ? 1 : -1;
    out.set(`${a}|${b}`, (out.get(`${a}|${b}`) ?? 0) + sign * amount);
  };
  for (const e of expenses) {
    if (e.excluded) continue;
    for (const s of e.shares) owe(s.participantId, e.payerId, s.amount.minor);
  }
  for (const s of settlements) owe(s.toId, s.fromId, s.amount.minor);
  for (const [key, value] of out) if (value === 0) out.delete(key);
  return out;
}

/** Nợ sau bù trừ hai chiều, TRƯỚC khi triệt tiêu vòng — để so với sổ cặp độc lập. */
function pairsAsMap(debts: readonly PairDebt[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const d of debts) {
    const [a, b] = d.from < d.to ? [d.from, d.to] : [d.to, d.from];
    const netted = d.owedTotal.minor - d.offsetTotal.minor;
    out.set(`${a}|${b}`, d.from < d.to ? netted : -netted);
  }
  return out;
}

/** Sổ cặp độc lập, bỏ các cặp đã bị triệt tiêu hết (không còn trong kết quả). */
function restrictTo(
  expected: Map<string, number>,
  actual: Map<string, number>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const key of actual.keys()) if (expected.has(key)) out.set(key, expected.get(key)!);
  return out;
}

// ---------------------------------------------------------------------------
// Ca nhỏ tính tay
// ---------------------------------------------------------------------------

describe('buildStatements — ca tính tay', () => {
  const expenses = [
    equalLedger('1', 'an', 90_000, ['an', 'binh', 'cuong']),
    exactLedger('2', 'binh', { an: 50_000, binh: 10_000 }),
    equalLedger('3', 'cuong', 5_000_000, ['an', 'binh', 'cuong'], { excluded: true }),
  ];

  test('số dư từng người và dòng kê', () => {
    const statements = buildStatements(expenses, [], 'VND', ['an', 'binh', 'cuong', 'dung']);
    assert.deepEqual(netMap(statementsToBalances(statements)), {
      an: 10_000,
      binh: 20_000,
      cuong: -30_000,
      dung: 0,
    });
    const an = statements.find((s) => s.participantId === 'an')!;
    assert.deepEqual(
      an.lines.map((l) => [l.expenseId, l.paid.minor, l.owed.minor, l.delta.minor]),
      [
        ['1', 90_000, 30_000, 60_000],
        ['2', 0, 50_000, -50_000],
      ],
    );
    assert.equal(statements.find((s) => s.participantId === 'dung')!.lines.length, 0);
    assertStatementArithmetic(statements, 'tính tay');
  });

  test('khoản excluded không xuất hiện ở dòng kê nào', () => {
    const statements = buildStatements(expenses, [], 'VND');
    assert.ok(statements.every((s) => s.lines.every((l) => l.expenseId !== '3')));
  });

  test('khớp computeBalances', () => {
    assert.deepEqual(
      statementsToBalances(buildStatements(expenses, [], 'VND')),
      computeBalances(expenses.map(toRecord), 'VND'),
    );
  });

  test('dòng kê luôn theo paidAt tăng dần dù đầu vào bị đảo ngược thứ tự chèn', () => {
    const reversed = [
      equalLedger('late', 'an', 30_000, ['an', 'binh'], { paidAt: '2026-09-20T00:00:00' }),
      equalLedger('mid', 'binh', 30_000, ['an', 'binh'], { paidAt: '2026-09-10T00:00:00' }),
      equalLedger('early', 'an', 30_000, ['an', 'binh'], { paidAt: '2026-09-01T00:00:00' }),
    ];
    const statements = buildStatements(reversed, [], 'VND', ['an', 'binh']);
    for (const s of statements) {
      const paidAts = s.lines.map((l) => l.paidAt);
      const sorted = [...paidAts].sort();
      assert.deepEqual(paidAts, sorted, `${s.participantId}: dòng kê không theo thứ tự thời gian tăng dần`);
      assert.deepEqual(paidAts, ['2026-09-01T00:00:00', '2026-09-10T00:00:00', '2026-09-20T00:00:00']);
    }
  });

  test('tất toán được cộng vào settledOut/settledIn và net', () => {
    const statements = buildStatements(expenses, [settle('s1', 'cuong', 'an', 30_000)], 'VND');
    const cuong = statements.find((s) => s.participantId === 'cuong')!;
    assert.equal(cuong.settledOut.minor, 30_000);
    assert.equal(cuong.net.minor, 0);
    assert.equal(statements.find((s) => s.participantId === 'an')!.net.minor, -20_000);
    assertStatementArithmetic(statements, 'tất toán');
  });
});

describe('pairwiseDebts — ca tính tay', () => {
  test('bù trừ hai chiều, mỗi cặp một chiều', () => {
    const expenses = [
      equalLedger('1', 'an', 90_000, ['an', 'binh', 'cuong']),
      exactLedger('2', 'binh', { an: 50_000, binh: 10_000 }),
    ];
    const debts = pairwiseDebts(expenses, [], 'VND');
    assert.deepEqual(
      debts.map((d) => [d.from, d.to, d.amount.minor, d.owedTotal.minor, d.offsetTotal.minor]),
      [
        ['cuong', 'an', 30_000, 30_000, 0],
        ['an', 'binh', 20_000, 50_000, 30_000],
      ],
    );
    assertPairInvariants(debts, buildStatements(expenses, [], 'VND'), new Set(), 'tính tay');
  });

  test('người trả tự chịu phần mình không sinh nợ với chính mình', () => {
    const debts = pairwiseDebts(
      [equalLedger('1', 'an', 90_000, ['an', 'binh', 'cuong'])],
      [],
      'VND',
    );
    assert.equal(debts.length, 2);
    assert.ok(debts.every((d) => d.from !== d.to && d.to === 'an'));
    assert.equal(sumMinor(debts), 60_000); // phần 30k của an không thành nợ
  });

  test('tất toán A→B làm giảm nợ A→B', () => {
    const expenses = [exactLedger('1', 'B', { A: 100_000 })];
    const partial = pairwiseDebts(expenses, [settle('s1', 'A', 'B', 40_000)], 'VND');
    assert.deepEqual(
      partial.map((d) => [d.from, d.to, d.amount.minor, d.owedTotal.minor, d.offsetTotal.minor]),
      [['A', 'B', 60_000, 100_000, 40_000]],
    );
    assert.deepEqual(
      partial[0].offsetItems.map((i) => [i.kind, i.sourceId]),
      [['settlement', 's1']],
    );

    assert.deepEqual(pairwiseDebts(expenses, [settle('s1', 'A', 'B', 100_000)], 'VND'), []);

    const over = pairwiseDebts(expenses, [settle('s1', 'A', 'B', 120_000)], 'VND');
    assert.deepEqual(
      over.map((d) => [d.from, d.to, d.amount.minor]),
      [['B', 'A', 20_000]],
    );
  });

  test('khoản excluded không xuất hiện', () => {
    const expenses = [
      equalLedger('1', 'an', 90_000, ['an', 'binh', 'cuong']),
      exactLedger('2', 'binh', { an: 777_000 }, { excluded: true }),
    ];
    const debts = pairwiseDebts(expenses, [], 'VND');
    assert.ok(
      debts.every((d) => [...d.owedItems, ...d.offsetItems].every((i) => i.sourceId !== '2')),
    );
    assert.ok(!debts.some((d) => d.from === 'an' && d.to === 'binh'));
  });

  test('khoản chi lệch tổng → ném MoneyError', () => {
    const good = equalLedger('1', 'an', 90_000, ['an', 'binh']);
    const broken: LedgerExpense = { ...good, id: '9', total: money(100_000, 'VND') };
    assert.throws(() => pairwiseDebts([broken], [], 'VND'), MoneyError);
    assert.throws(() => buildStatements([broken], [], 'VND'), MoneyError);
  });

  test('khoản chi có total dùng đơn vị khác chuyến đi → ném MoneyError', () => {
    const good = equalLedger('1', 'an', 90_000, ['an', 'binh']);
    const mixed: LedgerExpense = { ...good, id: '9', total: money(900, 'USD') };
    assert.throws(() => buildStatements([mixed], [], 'VND'), MoneyError);
    assert.throws(() => pairwiseDebts([mixed], [], 'VND'), MoneyError);
  });

  test('khoản chi có share dùng đơn vị khác chuyến đi → ném MoneyError', () => {
    const good = equalLedger('1', 'an', 90_000, ['an', 'binh']);
    const mixed: LedgerExpense = {
      ...good,
      id: '9',
      shares: [
        { participantId: 'an', amount: money(450, 'USD') },
        { participantId: 'binh', amount: money(45_000, 'VND') },
      ],
    };
    assert.throws(() => buildStatements([mixed], [], 'VND'), MoneyError);
    assert.throws(() => pairwiseDebts([mixed], [], 'VND'), MoneyError);
  });

  test('lần tất toán dùng đơn vị khác chuyến đi → ném MoneyError', () => {
    const expenses = [equalLedger('1', 'an', 90_000, ['an', 'binh'])];
    const mixedSettlement = settle('s1', 'binh', 'an', 45_000);
    const usdSettlement: LedgerSettlement = { ...mixedSettlement, amount: money(450, 'USD') };
    assert.throws(() => buildStatements(expenses, [usdSettlement], 'VND'), MoneyError);
    assert.throws(() => pairwiseDebts(expenses, [usdSettlement], 'VND'), MoneyError);
  });
});

// ---------------------------------------------------------------------------
// Ngẫu nhiên quy mô 10–15 người
// ---------------------------------------------------------------------------

describe('ledger trên dữ liệu ngẫu nhiên (10–15 người)', () => {
  test('150 nhóm: statements khớp computeBalances, pairwise khớp sổ độc lập và đưa về 0', () => {
    const rng = makeRng(31337);
    for (let round = 0; round < 150; round += 1) {
      const n = rng.int(10, 15);
      const ids = Array.from({ length: n }, (_, i) => `p${String(i).padStart(2, '0')}`);
      const expenses: LedgerExpense[] = [];
      const count = rng.int(30, 100);
      for (let e = 0; e < count; e += 1) {
        const payer = rng.pick(ids);
        const who = rng.shuffle(ids).slice(0, rng.int(1, n));
        const extra = {
          excluded: rng.next() < 0.1,
          paidAt: `2026-09-${String(rng.int(1, 28)).padStart(2, '0')}`,
        };
        if (rng.next() < 0.6) {
          expenses.push(equalLedger(`e${e}`, payer, rng.int(1, 3_000_000), who, extra));
        } else {
          const exact: Record<string, number> = {};
          for (const id of who) exact[id] = rng.int(0, 500_000);
          if (Object.values(exact).every((v) => v === 0)) exact[who[0]] = 1;
          expenses.push(exactLedger(`e${e}`, payer, exact, extra));
        }
      }
      const excludedIds = new Set(expenses.filter((e) => e.excluded).map((e) => e.id));
      const label = `vòng ${round}`;

      // Không tất toán: khớp computeBalances
      const plain = buildStatements(expenses, [], 'VND', ids);
      assert.deepEqual(
        netMap(statementsToBalances(plain)),
        netMap(computeBalances(expenses.map(toRecord), 'VND', ids)),
        `${label}: statements ≠ computeBalances`,
      );
      assertStatementArithmetic(plain, label);
      for (const s of plain)
        assert.ok(
          s.lines.every((l) => !excludedIds.has(l.expenseId)),
          `${label}: excluded lọt vào dòng kê`,
        );

      // Có tất toán
      const settlements: LedgerSettlement[] = [];
      for (let k = 0; k < rng.int(0, 8); k += 1) {
        const [from, to] = rng.shuffle(ids);
        settlements.push(settle(`s${k}`, from, to, rng.int(1, 400_000)));
      }
      const withSettle = buildStatements(expenses, settlements, 'VND', ids);
      assertStatementArithmetic(withSettle, `${label} (tất toán)`);
      assert.equal(
        withSettle.reduce((s, m) => s + m.net.minor, 0),
        0,
        `${label}: tổng net ≠ 0`,
      );

      const debts = pairwiseDebts(expenses, settlements, 'VND');
      assertPairInvariants(debts, withSettle, excludedIds, label);
      const actualPairs = pairsAsMap(debts);
      assert.deepEqual(
        actualPairs,
        restrictTo(independentPairs(expenses, settlements), actualPairs),
        `${label}: pairwise ≠ sổ cặp độc lập`,
      );
    }
  });
});

describe('pairwiseDebts — triệt tiêu vòng nợ', () => {
  test('tất toán đi theo đường tối giản không tạo vòng nợ giả', () => {
    // A ứng 100k cho B, B ứng 100k cho C. Tối giản: C chuyển thẳng 100k cho A,
    // và đã ghi tất toán C→A. Không còn ai nợ ai — B không được bị bảo chuyển tiền.
    const expenses = [
      exactLedger('ab', 'A', { B: 100_000 }),
      exactLedger('bc', 'B', { C: 100_000 }),
      exactLedger('de', 'D', { E: 50_000 }),
    ];
    const debts = pairwiseDebts(expenses, [settle('s1', 'C', 'A', 100_000)], 'VND');
    assert.deepEqual(
      debts.map((debt) => [debt.from, debt.to, debt.amount.minor]),
      [['E', 'D', 50_000]],
    );
  });

  test('vòng ba người chỉ triệt tiêu phần chung, giữ phần dư', () => {
    const expenses = [
      exactLedger('1', 'B', { A: 100_000 }), // A nợ B 100k
      exactLedger('2', 'C', { B: 60_000 }), // B nợ C 60k
      exactLedger('3', 'A', { C: 60_000 }), // C nợ A 60k
    ];
    const debts = pairwiseDebts(expenses, [], 'VND');
    assert.deepEqual(
      debts.map((debt) => [debt.from, debt.to, debt.amount.minor, debt.cycleOffset.minor]),
      [['A', 'B', 40_000, 60_000]],
    );
  });
});
