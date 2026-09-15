import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { Balance, ExpenseRecord } from './balance.ts';
import { applyTransfers, computeBalances, simplifyDebts } from './balance.ts';
import { MoneyError, money } from './money.ts';
import { splitExpense } from './split.ts';

function expense(id: string, payerId: string, totalMinor: number, ids: string[]): ExpenseRecord {
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
    payments: [{ participantId: payerId, amount: total }],
    shares: result.lines,
  };
}

function netOf(balances: readonly Balance[], id: string): number {
  return balances.find((balance) => balance.participantId === id)?.net.minor ?? 0;
}

describe('computeBalances', () => {
  test('một người trả, cả nhóm chia đều', () => {
    const balances = computeBalances([expense('e1', 'an', 90_000, ['an', 'binh', 'cuong'])], 'VND');
    assert.equal(netOf(balances, 'an'), 60_000); // ứng 90k, gánh 30k
    assert.equal(netOf(balances, 'binh'), -30_000);
    assert.equal(netOf(balances, 'cuong'), -30_000);
  });

  test('tổng số dư của nhóm LUÔN bằng 0', () => {
    const expenses = [
      expense('e1', 'an', 90_000, ['an', 'binh', 'cuong']),
      expense('e2', 'binh', 10_000, ['an', 'binh', 'cuong']),
      expense('e3', 'cuong', 55_555, ['an', 'binh']),
    ];
    const balances = computeBalances(expenses, 'VND');
    assert.equal(
      balances.reduce((sum, balance) => sum + balance.net.minor, 0),
      0,
    );
  });

  test('khoản chi bị huỷ không tính vào số dư', () => {
    const active = expense('e1', 'an', 90_000, ['an', 'binh', 'cuong']);
    const voided: ExpenseRecord = { ...expense('e2', 'binh', 60_000, ['an', 'binh']), voided: true };
    const balances = computeBalances([active, voided], 'VND');
    assert.equal(netOf(balances, 'an'), 60_000);
    assert.equal(netOf(balances, 'binh'), -30_000);
  });

  test('nhiều người cùng ứng tiền cho một khoản', () => {
    const total = money(100_000, 'VND');
    const split = splitExpense({
      total,
      participantIds: ['an', 'binh', 'cuong', 'dung'],
      mode: 'equal',
    });
    assert.ok(split.ok);
    const balances = computeBalances(
      [
        {
          id: 'e1',
          payments: [
            { participantId: 'an', amount: money(60_000, 'VND') },
            { participantId: 'binh', amount: money(40_000, 'VND') },
          ],
          shares: split.lines,
        },
      ],
      'VND',
    );
    assert.equal(netOf(balances, 'an'), 35_000);
    assert.equal(netOf(balances, 'binh'), 15_000);
    assert.equal(netOf(balances, 'cuong'), -25_000);
    assert.equal(netOf(balances, 'dung'), -25_000);
  });

  test('người chưa có giao dịch nào vẫn xuất hiện với số dư 0', () => {
    const balances = computeBalances([], 'VND', ['an', 'binh']);
    assert.equal(balances.length, 2);
    assert.ok(balances.every((balance) => balance.net.minor === 0));
  });

  test('phát hiện khoản chi hỏng: tiền ứng khác tổng phần chia', () => {
    const broken: ExpenseRecord = {
      id: 'hong',
      payments: [{ participantId: 'an', amount: money(100_000, 'VND') }],
      shares: [{ participantId: 'binh', amount: money(90_000, 'VND') }],
    };
    assert.throws(() => computeBalances([broken], 'VND'), MoneyError);
  });

  test('tính lại từ đầu: thêm rồi bỏ một khoản chi phải quay về số dư cũ', () => {
    const base = [expense('e1', 'an', 90_000, ['an', 'binh', 'cuong'])];
    const before = computeBalances(base, 'VND');
    const extra = [...base, expense('e2', 'binh', 33_333, ['an', 'binh', 'cuong'])];
    computeBalances(extra, 'VND');
    const after = computeBalances(base, 'VND');
    assert.deepEqual(after, before);
  });
});

describe('simplifyDebts — không được đổi số dư của bất kỳ ai', () => {
  test('trường hợp đơn giản: một chủ nợ, hai con nợ', () => {
    const balances = computeBalances([expense('e1', 'an', 90_000, ['an', 'binh', 'cuong'])], 'VND');
    const transfers = simplifyDebts(balances);
    assert.equal(transfers.length, 2);
    assert.ok(transfers.every((transfer) => transfer.to === 'an'));
    assert.equal(
      transfers.reduce((sum, transfer) => sum + transfer.amount.minor, 0),
      60_000,
    );
  });

  test('sau khi áp hết giao dịch, mọi số dư về 0', () => {
    const expenses = [
      expense('e1', 'an', 90_000, ['an', 'binh', 'cuong']),
      expense('e2', 'binh', 10_000, ['an', 'binh', 'cuong']),
      expense('e3', 'cuong', 55_555, ['an', 'binh', 'cuong']),
      expense('e4', 'dung', 1_234_567, ['an', 'binh', 'cuong', 'dung']),
    ];
    const balances = computeBalances(expenses, 'VND');
    const settled = applyTransfers(balances, simplifyDebts(balances));
    assert.ok(
      settled.every((balance) => balance.net.minor === 0),
      `còn số dư chưa tất toán: ${JSON.stringify(settled)}`,
    );
  });

  test('số giao dịch không vượt quá n-1', () => {
    const expenses = [
      expense('e1', 'an', 90_000, ['an', 'binh', 'cuong', 'dung', 'em']),
      expense('e2', 'binh', 70_000, ['an', 'binh', 'cuong', 'dung', 'em']),
      expense('e3', 'cuong', 30_000, ['an', 'binh', 'cuong', 'dung', 'em']),
    ];
    const balances = computeBalances(expenses, 'VND');
    const transfers = simplifyDebts(balances);
    assert.ok(transfers.length <= balances.length - 1, `sinh ra ${transfers.length} giao dịch`);
  });

  test('không ai tự chuyển tiền cho chính mình, không có giao dịch 0 đồng', () => {
    const expenses = [
      expense('e1', 'an', 99_999, ['an', 'binh', 'cuong']),
      expense('e2', 'binh', 99_999, ['an', 'binh', 'cuong']),
      expense('e3', 'cuong', 99_999, ['an', 'binh', 'cuong']),
    ];
    const transfers = simplifyDebts(computeBalances(expenses, 'VND'));
    assert.ok(transfers.every((transfer) => transfer.from !== transfer.to));
    assert.ok(transfers.every((transfer) => transfer.amount.minor > 0));
  });

  test('nhóm đã cân thì không sinh giao dịch nào', () => {
    const expenses = [
      expense('e1', 'an', 60_000, ['an', 'binh']),
      expense('e2', 'binh', 60_000, ['an', 'binh']),
    ];
    assert.deepEqual(simplifyDebts(computeBalances(expenses, 'VND')), []);
  });

  test('từ chối danh sách số dư không cân — đó là dấu hiệu có bug ở nơi khác', () => {
    const broken: Balance[] = [
      { participantId: 'an', net: money(100, 'VND') },
      { participantId: 'binh', net: money(-50, 'VND') },
    ];
    assert.throws(() => simplifyDebts(broken), MoneyError);
  });

  test('kết quả tất định qua nhiều lần chạy', () => {
    const expenses = [
      expense('e1', 'an', 123_457, ['an', 'binh', 'cuong', 'dung']),
      expense('e2', 'cuong', 777_777, ['an', 'binh', 'cuong', 'dung']),
    ];
    const balances = computeBalances(expenses, 'VND');
    const first = JSON.stringify(simplifyDebts(balances));
    for (let i = 0; i < 20; i += 1) {
      assert.equal(JSON.stringify(simplifyDebts(balances)), first);
    }
  });
});

describe('tất toán trên dải đầu vào rộng', () => {
  test('300 nhóm ngẫu nhiên: luôn cân về 0 và tổng net giữ nguyên', () => {
    let seed = 424242;
    const nextInt = (bound: number): number => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed % bound;
    };

    for (let round = 0; round < 300; round += 1) {
      const peopleCount = 2 + nextInt(6);
      const ids = Array.from({ length: peopleCount }, (_, i) => `p${i}`);
      const expenses: ExpenseRecord[] = [];

      const expenseCount = 1 + nextInt(6);
      for (let e = 0; e < expenseCount; e += 1) {
        const payer = ids[nextInt(ids.length)];
        expenses.push(expense(`e${e}`, payer, 1 + nextInt(2_000_000), ids));
      }

      const balances = computeBalances(expenses, 'VND', ids);
      assert.equal(
        balances.reduce((sum, balance) => sum + balance.net.minor, 0),
        0,
        `tổng số dư khác 0 ở vòng ${round}`,
      );

      const transfers = simplifyDebts(balances);
      const settled = applyTransfers(balances, transfers);
      assert.ok(
        settled.every((balance) => balance.net.minor === 0),
        `chưa tất toán hết ở vòng ${round}`,
      );
      assert.ok(transfers.length <= peopleCount - 1, `quá nhiều giao dịch ở vòng ${round}`);
    }
  });
});
