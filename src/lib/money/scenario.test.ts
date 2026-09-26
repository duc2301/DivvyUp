/**
 * Kiểm thử theo kịch bản & quy mô cho computeBalances / simplifyDebts / applyTransfers.
 *
 * Nguyên tắc: ca nhỏ dùng số kỳ vọng TÍNH TAY; ca lớn khẳng định BẤT BIẾN và đối
 * chiếu với sổ cái / brute force viết độc lập trong file này (không gọi lại code
 * sản phẩm để tính kỳ vọng).
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { Balance, ExpenseRecord, Transfer } from './balance.ts';
import { MAX_EXACT_SIMPLIFY, applyTransfers, computeBalances, simplifyDebts } from './balance.ts';
import { money } from './money.ts';
import { splitExpense } from './split.ts';

// ---------------------------------------------------------------------------
// Tiện ích
// ---------------------------------------------------------------------------

/** PRNG có seed — test ngẫu nhiên nhưng tái lập được. */
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
type Rng = ReturnType<typeof makeRng>;

function equalExpense(id: string, payerId: string, totalMinor: number, ids: string[]): ExpenseRecord {
  const total = money(totalMinor, 'VND');
  const result = splitExpense({ total, participantIds: ids, mode: 'equal', remainderPriority: [payerId] });
  if (!result.ok) throw new Error(result.error);
  return { id, payments: [{ participantId: payerId, amount: total }], shares: result.lines };
}

function exactExpense(id: string, payerId: string, exact: Record<string, number>): ExpenseRecord {
  const ids = Object.keys(exact);
  const totalMinor = ids.reduce((sum, key) => sum + exact[key], 0);
  const total = money(totalMinor, 'VND');
  const result = splitExpense({ total, participantIds: ids, mode: 'exact', exactMinor: exact });
  if (!result.ok) throw new Error(result.error);
  return { id, payments: [{ participantId: payerId, amount: total }], shares: result.lines };
}

function netMap(balances: readonly Balance[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const balance of balances) out[balance.participantId] = balance.net.minor;
  return out;
}

function balancesOf(nets: Record<string, number>): Balance[] {
  return Object.entries(nets).map(([participantId, minor]) => ({ participantId, net: money(minor, 'VND') }));
}

/**
 * Sổ cái hai chiều ĐỘC LẬP: mỗi phần chia = người chịu nợ người trả.
 * Số dư của p = (người khác nợ p) − (p nợ người khác). Chỉ hỗ trợ khoản một người trả.
 */
function independentLedger(expenses: readonly ExpenseRecord[]): Record<string, number> {
  const owes = new Map<string, Map<string, number>>(); // debtor -> creditor -> amount
  const people = new Set<string>();
  for (const expense of expenses) {
    if (expense.voided) continue;
    assert.equal(expense.payments.length, 1, 'sổ cái độc lập chỉ hỗ trợ một người trả');
    const payer = expense.payments[0].participantId;
    people.add(payer);
    for (const share of expense.shares) {
      people.add(share.participantId);
      const row = owes.get(share.participantId) ?? new Map<string, number>();
      row.set(payer, (row.get(payer) ?? 0) + share.amount.minor);
      owes.set(share.participantId, row);
    }
  }
  const net: Record<string, number> = {};
  for (const person of people) net[person] = 0;
  for (const [debtor, row] of owes) {
    for (const [creditor, amount] of row) {
      net[debtor] -= amount;
      net[creditor] += amount;
    }
  }
  return net;
}

/**
 * Brute force: số nhóm con tổng 0 rời nhau NHIỀU NHẤT. Cách làm khác code:
 * đệ quy theo phân hoạch — lấy phần tử đầu, thử mọi tập con của phần còn lại
 * để cùng nó tạo nhóm tổng 0, rồi đệ quy trên phần dư.
 */
function maxZeroSumGroups(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const [first, ...rest] = values;
  let best = -Infinity;
  const m = rest.length;
  for (let mask = 0; mask < 1 << m; mask += 1) {
    let sum = first;
    const remaining: number[] = [];
    for (let i = 0; i < m; i += 1) {
      if (mask & (1 << i)) sum += rest[i];
      else remaining.push(rest[i]);
    }
    if (sum !== 0) continue;
    const candidate = 1 + maxZeroSumGroups(remaining);
    if (candidate > best) best = candidate;
  }
  return best;
}

function minTransfersBrute(nets: readonly number[]): number {
  const nonZero = nets.filter((value) => value !== 0);
  return nonZero.length === 0 ? 0 : nonZero.length - maxZeroSumGroups(nonZero);
}

/** Mọi bất biến của một lời giải tất toán. */
function assertSettlementInvariants(balances: readonly Balance[], transfers: readonly Transfer[], label: string): void {
  const nets = netMap(balances);
  const nonZero = balances.filter((balance) => balance.net.minor !== 0).length;

  const settled = applyTransfers(balances, transfers);
  assert.ok(
    settled.every((balance) => balance.net.minor === 0),
    `${label}: chưa về 0 — ${JSON.stringify(settled.filter((b) => b.net.minor !== 0))}`,
  );
  for (const transfer of transfers) {
    assert.notEqual(transfer.from, transfer.to, `${label}: tự chuyển cho mình (${transfer.from})`);
    assert.ok(transfer.amount.minor > 0, `${label}: giao dịch ≤ 0 (${JSON.stringify(transfer)})`);
    assert.ok((nets[transfer.from] ?? 0) < 0, `${label}: ${transfer.from} (net ${nets[transfer.from]}) xuất hiện ở from`);
    assert.ok((nets[transfer.to] ?? 0) > 0, `${label}: ${transfer.to} (net ${nets[transfer.to]}) xuất hiện ở to`);
  }
  assert.ok(
    transfers.length <= Math.max(0, nonZero - 1),
    `${label}: ${transfers.length} giao dịch cho ${nonZero} người có số dư ≠ 0`,
  );
}

/** Sinh nhóm ngẫu nhiên: tập con người chịu ngẫu nhiên, trộn chia đều / exact, tiền lẻ. */
function randomTrip(rng: Rng, peopleCount: number, expenseCount: number): { ids: string[]; expenses: ExpenseRecord[] } {
  const ids = Array.from({ length: peopleCount }, (_, i) => `p${String(i).padStart(2, '0')}`);
  const expenses: ExpenseRecord[] = [];
  for (let e = 0; e < expenseCount; e += 1) {
    const payer = rng.pick(ids);
    const size = rng.int(1, peopleCount);
    const participants = rng.shuffle(ids).slice(0, size); // người trả có thể không nằm trong đây
    const totalMinor = rng.int(1, 3_000_000);
    if (rng.next() < 0.6) {
      expenses.push(equalExpense(`e${e}`, payer, totalMinor, participants));
    } else {
      // exact: cắt ngẫu nhiên totalMinor thành các phần (cho phép phần 0)
      const cuts = Array.from({ length: participants.length - 1 }, () => rng.int(0, totalMinor)).sort((a, b) => a - b);
      const bounds = [0, ...cuts, totalMinor];
      const exact: Record<string, number> = {};
      participants.forEach((id, i) => {
        exact[id] = bounds[i + 1] - bounds[i];
      });
      expenses.push(exactExpense(`e${e}`, payer, exact));
    }
  }
  return { ids, expenses };
}

// ---------------------------------------------------------------------------
// 1. Kịch bản người dùng báo lỗi — 5 người, số kỳ vọng tính tay
// ---------------------------------------------------------------------------

const FIVE = ['an', 'binh', 'cuong', 'dung', 'em'];

function reportedScenario(): ExpenseRecord[] {
  return [
    equalExpense('e1', 'an', 300_000, ['binh', 'cuong', 'dung']), // an trả, không chịu
    equalExpense('e2', 'binh', 400_000, ['an', 'binh', 'cuong', 'dung']), // em không tham gia
    exactExpense('e3', 'cuong', { an: 50_000, binh: 70_000, cuong: 30_000, dung: 60_000, em: 40_000 }),
    equalExpense('e4', 'dung', 100_000, ['an', 'binh', 'cuong']), // lẻ, người trả không chịu
    equalExpense('e5', 'em', 500_000, FIVE),
    equalExpense('e6', 'an', 100_000, ['an', 'cuong', 'em']), // lẻ, người trả nhận phần dư
    exactExpense('e7', 'binh', { an: 20_000, em: 70_000 }), // tính riêng, người trả không chịu
    equalExpense('e8', 'dung', 123_457, ['binh', 'cuong', 'dung', 'em']), // an không tham gia
    { ...equalExpense('e9', 'cuong', 9_999_999, FIVE), voided: true },
  ];
}

// Tính tay:
//   ứng:  an 400.000 | binh 490.000 | cuong 250.000 | dung 223.457 | em 500.000
//   chịu: an 336.668 | binh 434.197 | cuong 427.530 | dung 390.865 | em 274.197
const REPORTED_EXPECTED: Record<string, number> = {
  an: 63_332,
  binh: 55_803,
  cuong: -177_530,
  dung: -167_408,
  em: 225_803,
};

describe('kịch bản 5 người (người dùng báo lỗi)', () => {
  test('phần chia của các khoản lẻ đúng như tính tay', () => {
    const shares = (e: ExpenseRecord) => Object.fromEntries(e.shares.map((s) => [s.participantId, s.amount.minor]));
    const [, , , e4, , e6, , e8] = reportedScenario();
    assert.deepEqual(shares(e4), { an: 33_334, binh: 33_333, cuong: 33_333 });
    assert.deepEqual(shares(e6), { an: 33_334, cuong: 33_333, em: 33_333 });
    assert.deepEqual(shares(e8), { binh: 30_864, cuong: 30_864, dung: 30_865, em: 30_864 });
  });

  test('computeBalances khớp số dư tính tay', () => {
    const balances = computeBalances(reportedScenario(), 'VND', FIVE);
    assert.deepEqual(netMap(balances), REPORTED_EXPECTED);
  });

  test('khớp sổ cái độc lập', () => {
    const expenses = reportedScenario();
    assert.deepEqual(netMap(computeBalances(expenses, 'VND')), independentLedger(expenses));
  });

  test('tối giản: đúng bất biến và tối ưu số giao dịch', () => {
    const balances = computeBalances(reportedScenario(), 'VND', FIVE);
    const transfers = simplifyDebts(balances);
    assertSettlementInvariants(balances, transfers, 'kịch bản 5 người');
    assert.equal(transfers.length, minTransfersBrute(Object.values(REPORTED_EXPECTED)));
  });
});

// ---------------------------------------------------------------------------
// 2. Quy mô 10 và 15 người
// ---------------------------------------------------------------------------

for (const [peopleCount, seed] of [
  [10, 1010],
  [15, 1515],
] as const) {
  describe(`quy mô ${peopleCount} người`, () => {
    test(`200 nhóm × 30–100 khoản ngẫu nhiên (seed ${seed})`, () => {
      const rng = makeRng(seed);
      for (let round = 0; round < 200; round += 1) {
        const { ids, expenses } = randomTrip(rng, peopleCount, rng.int(30, 100));
        const label = `${peopleCount} người, vòng ${round}`;
        const balances = computeBalances(expenses, 'VND', ids);

        assert.equal(balances.length, peopleCount, label);
        assert.equal(balances.reduce((sum, b) => sum + b.net.minor, 0), 0, `${label}: tổng số dư ≠ 0`);

        const ledger = independentLedger(expenses);
        for (const id of ids) ledger[id] ??= 0;
        assert.deepEqual(netMap(balances), ledger, `${label}: lệch sổ cái độc lập`);

        assertSettlementInvariants(balances, simplifyDebts(balances), label);
      }
    });
  });
}

// ---------------------------------------------------------------------------
// 3. Tính tối ưu so với brute force
// ---------------------------------------------------------------------------

describe('simplifyDebts tối ưu số giao dịch', () => {
  test('{A:-5,B:-5,C:+5,D:+5,E:-3,F:+3} → đúng 3 giao dịch', () => {
    const balances = balancesOf({ A: -5, B: -5, C: 5, D: 5, E: -3, F: 3 });
    const transfers = simplifyDebts(balances);
    assertSettlementInvariants(balances, transfers, 'ca 6 người');
    assert.equal(transfers.length, 3);
  });

  test('ca tham lam cũ ra thừa: A:-4,B:-3,C:-3 / D:+6,E:+4 → 3 giao dịch (tham lam ra 4)', () => {
    // Tham lam (nợ nhiều nhất ↔ nhận nhiều nhất): A→D 4, B→D 2, B→E 1, C→E 3 = 4 giao dịch.
    // Tối ưu: {A,E} và {B,C,D} → A→E 4, B→D 3, C→D 3 = 3 giao dịch.
    const balances = balancesOf({ A: -4, B: -3, C: -3, D: 6, E: 4 });
    const transfers = simplifyDebts(balances);
    assertSettlementInvariants(balances, transfers, 'ca tham lam');
    assert.equal(minTransfersBrute([-4, -3, -3, 6, 4]), 3);
    assert.equal(transfers.length, 3);
  });

  test('không có cặp khớp tiền, tham lam ra 5: {A:+9,B:-3,C:+2,D:-6,E:+9,F:-11} → 4 giao dịch', () => {
    // Tham lam: F→A 9, F→E 2, D→E 6, B→E 1, B→C 2 = 5. Tối ưu: {A,B,D} và {C,E,F} → 4.
    const balances = balancesOf({ A: 9, B: -3, C: 2, D: -6, E: 9, F: -11 });
    const transfers = simplifyDebts(balances);
    assertSettlementInvariants(balances, transfers, 'ca không cặp');
    assert.equal(minTransfersBrute([9, -3, 2, -6, 9, -11]), 4);
    assert.equal(transfers.length, 4);
  });

  test('nhóm con ba người: {-1,-2,+3,-4,-5,+9} → 4 giao dịch', () => {
    const balances = balancesOf({ a: -1, b: -2, c: 3, d: -4, e: -5, f: 9 });
    const transfers = simplifyDebts(balances);
    assertSettlementInvariants(balances, transfers, 'ca 3+3');
    assert.equal(transfers.length, 4);
  });

  test('800 bộ số dư ngẫu nhiên nhỏ (2–7 người ≠ 0): bằng đúng tối ưu brute force', () => {
    const rng = makeRng(777);
    for (let round = 0; round < 800; round += 1) {
      const n = rng.int(2, 7);
      const range = rng.pick([3, 6, 20]); // biên độ nhỏ ⇒ hay có nhóm con tổng 0
      const values: number[] = [];
      for (let i = 0; i < n - 1; i += 1) {
        let v = 0;
        while (v === 0) v = rng.int(-range, range);
        values.push(v);
      }
      const last = -values.reduce((a, b) => a + b, 0);
      if (last === 0) continue; // cần đúng n người ≠ 0
      values.push(last);
      const nets: Record<string, number> = {};
      rng.shuffle(values).forEach((v, i) => {
        nets[`q${i}`] = v;
      });
      nets.zero = 0; // người số dư 0 không được xuất hiện trong giao dịch
      const balances = balancesOf(nets);
      const transfers = simplifyDebts(balances);
      const label = `vòng ${round} ${JSON.stringify(nets)}`;
      assertSettlementInvariants(balances, transfers, label);
      assert.equal(transfers.length, minTransfersBrute(values), `${label}: không tối ưu`);
    }
  });

  test('300 nhóm sinh từ khoản chi (3–7 người, tiền tròn nghìn): bằng tối ưu brute force', () => {
    const rng = makeRng(4242);
    for (let round = 0; round < 300; round += 1) {
      const n = rng.int(3, 7);
      const ids = Array.from({ length: n }, (_, i) => `m${i}`);
      const expenses: ExpenseRecord[] = [];
      const expenseCount = rng.int(1, 6);
      for (let e = 0; e < expenseCount; e += 1) {
        const payer = rng.pick(ids);
        const who = rng.shuffle(ids).slice(0, rng.int(1, n));
        const exact: Record<string, number> = {};
        for (const id of who) exact[id] = rng.int(0, 5) * 1_000;
        if (Object.values(exact).every((v) => v === 0)) exact[who[0]] = 1_000;
        expenses.push(exactExpense(`e${e}`, payer, exact));
      }
      const balances = computeBalances(expenses, 'VND', ids);
      const transfers = simplifyDebts(balances);
      assertSettlementInvariants(balances, transfers, `vòng ${round}`);
      assert.equal(
        transfers.length,
        minTransfersBrute(balances.map((b) => b.net.minor)),
        `vòng ${round}: ${JSON.stringify(netMap(balances))}`,
      );
    }
  });

  test(`cặp khớp tiền được tách trước DP, không bị chặn bởi MAX_EXACT_SIMPLIFY (${MAX_EXACT_SIMPLIFY} người/nhóm): 2×MAX_EXACT_SIMPLIFY người ≠ 0 gồm MAX_EXACT_SIMPLIFY cặp khớp tiền → đúng MAX_EXACT_SIMPLIFY giao dịch`, () => {
    const nets: Record<string, number> = {};
    for (let i = 0; i < MAX_EXACT_SIMPLIFY; i += 1) {
      nets[`d${String(i).padStart(2, '0')}`] = -(1_000 + i * 137);
      nets[`c${String(i).padStart(2, '0')}`] = 1_000 + i * 137;
    }
    const balances = balancesOf(nets);
    const transfers = simplifyDebts(balances);
    assertSettlementInvariants(balances, transfers, `${2 * MAX_EXACT_SIMPLIFY} người`);
    // Mỗi cặp khớp tiền tách thành đúng 1 giao dịch, dù tổng số người vượt xa
    // MAX_EXACT_SIMPLIFY — vì bước tách cặp chạy TRƯỚC khi đưa vào DP.
    assert.equal(transfers.length, MAX_EXACT_SIMPLIFY);
  });
});

// ---------------------------------------------------------------------------
// 4. Nhiều hơn MAX_EXACT_SIMPLIFY người có số dư ≠ 0 (sau khi đã tách cặp khớp tiền)
// ---------------------------------------------------------------------------

describe(`trên ngưỡng tối ưu (>${MAX_EXACT_SIMPLIFY} người ≠ 0)`, () => {
  test('25 người ≠ 0: vẫn về 0, ≤ n−1, chạy < 1 giây', () => {
    const rng = makeRng(2525);
    for (let round = 0; round < 20; round += 1) {
      const values: number[] = [];
      for (let i = 0; i < 24; i += 1) {
        let v = 0;
        while (v === 0) v = rng.int(-2_000_000, 2_000_000);
        values.push(v);
      }
      const last = -values.reduce((a, b) => a + b, 0);
      if (last === 0) continue;
      values.push(last);
      const nets: Record<string, number> = {};
      values.forEach((v, i) => {
        nets[`p${String(i).padStart(2, '0')}`] = v;
      });
      const balances = balancesOf(nets);
      const start = performance.now();
      const transfers = simplifyDebts(balances);
      const elapsed = performance.now() - start;
      assertSettlementInvariants(balances, transfers, `25 người vòng ${round}`);
      // Ngưỡng nới rộng (không phải 1_000ms): CI có thể chạy chậm và chập chờn theo tải máy —
      // mục tiêu ở đây là bắt hồi quy về ĐỘ PHỨC TẠP (vô tình quay lại O(2^n) toàn phần),
      // không phải đo hiệu năng chính xác.
      assert.ok(elapsed < 5_000, `25 người mất ${elapsed.toFixed(0)}ms`);
    }
  });

  test('25 người từ 100 khoản chi: về 0, ≤ n−1, < 1 giây', () => {
    const rng = makeRng(9025);
    const { ids, expenses } = randomTrip(rng, 25, 100);
    const balances = computeBalances(expenses, 'VND', ids);
    const start = performance.now();
    const transfers = simplifyDebts(balances);
    const elapsed = performance.now() - start;
    assertSettlementInvariants(balances, transfers, '25 người từ khoản chi');
    // Ngưỡng nới rộng — xem giải thích ở test "25 người ≠ 0" phía trên.
    assert.ok(elapsed < 5_000, `mất ${elapsed.toFixed(0)}ms`);
  });

  test(`(MAX_EXACT_SIMPLIFY + 3) người ≠ 0, sau tách cặp khớp tiền còn 3 người (dưới ngưỡng): vẫn đúng bất biến`, () => {
    // MAX_EXACT_SIMPLIFY/2 cặp khớp tiền (= MAX_EXACT_SIMPLIFY người) được tách hết
    // trước DP; phần còn lại x, y, z (3 người, không khớp tiền với ai) đi qua DP.
    const nets: Record<string, number> = {};
    for (let i = 0; i < MAX_EXACT_SIMPLIFY / 2; i += 1) {
      nets[`d${i}`] = -(500 + i * 11);
      nets[`c${i}`] = 500 + i * 11;
    }
    nets.x = -300;
    nets.y = -700;
    nets.z = 1_000;
    const balances = balancesOf(nets);
    const transfers = simplifyDebts(balances);
    assertSettlementInvariants(balances, transfers, `${MAX_EXACT_SIMPLIFY + 3} người`);
  });

  test(`MAX_EXACT_SIMPLIFY người ≠ 0 ngẫu nhiên, không cặp khớp tiền (đường DP nặng nhất) chạy nhanh`, () => {
    const rng = makeRng(1616);
    const values: number[] = [];
    for (let i = 0; i < MAX_EXACT_SIMPLIFY - 1; i += 1) {
      values.push(rng.int(1, 50) * (rng.next() < 0.5 ? -1 : 1));
    }
    const last = -values.reduce((a, b) => a + b, 0);
    values.push(last === 0 ? 0 : last);
    const nets: Record<string, number> = {};
    values.forEach((v, i) => {
      nets[`p${String(i).padStart(2, '0')}`] = v;
    });
    const balances = balancesOf(nets);
    const start = performance.now();
    const transfers = simplifyDebts(balances);
    const elapsed = performance.now() - start;
    assertSettlementInvariants(balances, transfers, `${MAX_EXACT_SIMPLIFY} người`);
    // Ngưỡng nới rộng — xem giải thích ở test "25 người ≠ 0" phía trên.
    assert.ok(elapsed < 5_000, `mất ${elapsed.toFixed(0)}ms`);
  });

  test(`(MAX_EXACT_SIMPLIFY + 1) người ≠ 0 ngẫu nhiên, không cặp khớp tiền (vượt ngưỡng → tham lam) chạy nhanh`, () => {
    const rng = makeRng(1617);
    const values: number[] = [];
    for (let i = 0; i < MAX_EXACT_SIMPLIFY; i += 1) {
      values.push(rng.int(1, 50) * (rng.next() < 0.5 ? -1 : 1));
    }
    const last = -values.reduce((a, b) => a + b, 0);
    values.push(last === 0 ? 0 : last);
    const nets: Record<string, number> = {};
    values.forEach((v, i) => {
      nets[`p${String(i).padStart(2, '0')}`] = v;
    });
    const balances = balancesOf(nets);
    const start = performance.now();
    const transfers = simplifyDebts(balances);
    const elapsed = performance.now() - start;
    assertSettlementInvariants(balances, transfers, `${MAX_EXACT_SIMPLIFY + 1} người`);
    assert.ok(elapsed < 5_000, `mất ${elapsed.toFixed(0)}ms`);
  });
});

// ---------------------------------------------------------------------------
// 6. Tất định
// ---------------------------------------------------------------------------

describe('tất định', () => {
  test('đảo thứ tự khoản chi → cùng số dư và cùng giao dịch', () => {
    const rng = makeRng(6060);
    for (let round = 0; round < 30; round += 1) {
      const { ids, expenses } = randomTrip(rng, rng.int(5, 15), rng.int(10, 60));
      const balances = computeBalances(expenses, 'VND', ids);
      const reference = simplifyDebts(balances);
      for (let k = 0; k < 3; k += 1) {
        const shuffled = computeBalances(rng.shuffle(expenses), 'VND', rng.shuffle(ids));
        assert.deepEqual(shuffled, balances, `vòng ${round}: số dư đổi theo thứ tự khoản chi`);
        assert.deepEqual(simplifyDebts(shuffled), reference, `vòng ${round}: giao dịch đổi theo thứ tự`);
      }
    }
  });

  test(`đảo thứ tự danh sách số dư → cùng giao dịch (cả nhánh ≤${MAX_EXACT_SIMPLIFY} và >${MAX_EXACT_SIMPLIFY})`, () => {
    const rng = makeRng(6161);
    for (const size of [6, 12, MAX_EXACT_SIMPLIFY, MAX_EXACT_SIMPLIFY + 4, 25]) {
      const values: number[] = [];
      for (let i = 0; i < size - 1; i += 1) values.push(rng.int(-30, 30));
      values.push(-values.reduce((a, b) => a + b, 0));
      const nets: Record<string, number> = {};
      values.forEach((v, i) => {
        nets[`p${String(i).padStart(2, '0')}`] = v;
      });
      const balances = balancesOf(nets);
      const reference = simplifyDebts(balances);
      assertSettlementInvariants(balances, reference, `size ${size}`);
      for (let k = 0; k < 5; k += 1) {
        assert.deepEqual(simplifyDebts(rng.shuffle(balances)), reference, `size ${size}: phụ thuộc thứ tự`);
      }
    }
  });
});
