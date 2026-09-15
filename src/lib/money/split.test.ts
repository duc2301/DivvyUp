import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { formatMoney, money } from './money.ts';
import type { SplitResult } from './split.ts';
import { PERCENT_SCALE, linesBalanceTotal, splitExpense } from './split.ts';

function expectOk(result: SplitResult) {
  assert.equal(result.ok, true, result.ok ? '' : `Mong đợi thành công, nhận lỗi: ${result.error}`);
  if (!result.ok) throw new Error('unreachable');
  return result;
}

function amountsOf(result: SplitResult): number[] {
  return expectOk(result).lines.map((line) => line.amount.minor);
}

describe('chia đều — bất biến tổng', () => {
  test('chia hết thì ai cũng như ai', () => {
    const result = splitExpense({
      total: money(90_000, 'VND'),
      participantIds: ['an', 'binh', 'cuong'],
      mode: 'equal',
    });
    assert.deepEqual(amountsOf(result), [30_000, 30_000, 30_000]);
  });

  test('KHÔNG chia hết: phần dư được rải, tổng vẫn khớp tuyệt đối', () => {
    // 10.000 / 3 = 3.333,33... Cách sai là cho mỗi người 3.333,33 rồi làm tròn.
    const result = splitExpense({
      total: money(10_000, 'VND'),
      participantIds: ['an', 'binh', 'cuong'],
      mode: 'equal',
    });
    const amounts = amountsOf(result);
    assert.deepEqual(amounts, [3_334, 3_333, 3_333]);
    assert.equal(
      amounts.reduce((a, b) => a + b, 0),
      10_000,
      'tổng các phần phải bằng đúng khoản chi',
    );
  });

  test('phần dư 2 đơn vị được chia cho 2 người khác nhau', () => {
    const result = splitExpense({
      total: money(10_001, 'VND'),
      participantIds: ['an', 'binh', 'cuong'],
      mode: 'equal',
    });
    const amounts = amountsOf(result);
    assert.deepEqual(amounts, [3_334, 3_334, 3_333]);
    assert.equal(amounts.reduce((a, b) => a + b, 0), 10_001);
  });

  test('remainderPriority quyết định ai nhận phần lẻ', () => {
    const result = splitExpense({
      total: money(10_000, 'VND'),
      participantIds: ['an', 'binh', 'cuong'],
      mode: 'equal',
      remainderPriority: ['cuong'],
    });
    assert.deepEqual(amountsOf(result), [3_333, 3_333, 3_334]);
  });

  test('kết quả tất định — chạy lại nhiều lần ra y hệt', () => {
    const request = {
      total: money(10_000, 'VND'),
      participantIds: ['an', 'binh', 'cuong'],
      mode: 'equal' as const,
    };
    const first = amountsOf(splitExpense(request));
    for (let i = 0; i < 20; i += 1) {
      assert.deepEqual(amountsOf(splitExpense(request)), first);
    }
  });

  test('một người duy nhất gánh toàn bộ', () => {
    assert.deepEqual(
      amountsOf(splitExpense({ total: money(7, 'VND'), participantIds: ['an'], mode: 'equal' })),
      [7],
    );
  });

  test('số tiền nhỏ hơn số người: có người nhận 0, không ai nhận số âm', () => {
    const amounts = amountsOf(
      splitExpense({
        total: money(2, 'VND'),
        participantIds: ['an', 'binh', 'cuong'],
        mode: 'equal',
      }),
    );
    assert.deepEqual(amounts, [1, 1, 0]);
    assert.equal(amounts.reduce((a, b) => a + b, 0), 2);
    assert.ok(amounts.every((value) => value >= 0));
  });
});

describe('chia theo phần', () => {
  test('tỷ lệ 2:1:1', () => {
    const result = splitExpense({
      total: money(100_000, 'VND'),
      participantIds: ['an', 'binh', 'cuong'],
      mode: 'shares',
      shares: { an: 2, binh: 1, cuong: 1 },
    });
    assert.deepEqual(amountsOf(result), [50_000, 25_000, 25_000]);
  });

  test('phần 0 thì không phải trả gì', () => {
    const result = splitExpense({
      total: money(100_000, 'VND'),
      participantIds: ['an', 'binh', 'cuong'],
      mode: 'shares',
      shares: { an: 1, binh: 1, cuong: 0 },
    });
    assert.deepEqual(amountsOf(result), [50_000, 50_000, 0]);
  });

  test('tỷ lệ lẻ vẫn giữ bất biến tổng', () => {
    const total = 100_000;
    const result = splitExpense({
      total: money(total, 'VND'),
      participantIds: ['an', 'binh', 'cuong'],
      mode: 'shares',
      shares: { an: 1, binh: 1, cuong: 1 },
    });
    assert.equal(amountsOf(result).reduce((a, b) => a + b, 0), total);
  });

  test('báo lỗi rõ ràng khi dữ liệu sai', () => {
    const base = {
      total: money(100_000, 'VND'),
      participantIds: ['an', 'binh'],
      mode: 'shares' as const,
    };
    assert.equal(splitExpense({ ...base, shares: { an: 1 } }).ok, false);
    assert.equal(splitExpense({ ...base, shares: { an: 0, binh: 0 } }).ok, false);
    assert.equal(splitExpense({ ...base, shares: { an: 1.5, binh: 1 } }).ok, false);
    assert.equal(splitExpense({ ...base, shares: { an: -1, binh: 2 } }).ok, false);
  });
});

describe('chia theo phần trăm', () => {
  test('tỷ lệ tròn', () => {
    const result = splitExpense({
      total: money(100_000, 'VND'),
      participantIds: ['an', 'binh'],
      mode: 'percent',
      percentBps: { an: 7_000, binh: 3_000 },
    });
    assert.deepEqual(amountsOf(result), [70_000, 30_000]);
  });

  test('33,33% × 3 không bao giờ tròn 100% — phải bị từ chối', () => {
    const result = splitExpense({
      total: money(90_000, 'VND'),
      participantIds: ['an', 'binh', 'cuong'],
      mode: 'percent',
      percentBps: { an: 3_333, binh: 3_333, cuong: 3_333 },
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /100%/);
  });

  test('tổng đúng 100% với tỷ lệ lẻ thì vẫn khớp tổng tiền', () => {
    const result = splitExpense({
      total: money(100_000, 'VND'),
      participantIds: ['an', 'binh', 'cuong'],
      mode: 'percent',
      percentBps: { an: 3_334, binh: 3_333, cuong: 3_333 },
    });
    assert.equal(amountsOf(result).reduce((a, b) => a + b, 0), 100_000);
  });

  test('PERCENT_SCALE là 10000 điểm cơ bản', () => {
    assert.equal(PERCENT_SCALE, 10_000);
  });
});

describe('chia theo số tiền cụ thể', () => {
  test('khớp tổng thì chấp nhận', () => {
    const result = splitExpense({
      total: money(100_000, 'VND'),
      participantIds: ['an', 'binh'],
      mode: 'exact',
      exactMinor: { an: 60_000, binh: 40_000 },
    });
    assert.deepEqual(amountsOf(result), [60_000, 40_000]);
  });

  test('lệch tổng thì báo lỗi kèm số tiền chênh lệch cụ thể', () => {
    const result = splitExpense({
      total: money(100_000, 'VND'),
      participantIds: ['an', 'binh'],
      mode: 'exact',
      exactMinor: { an: 60_000, binh: 30_000 },
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /thiếu/);
      assert.match(result.error, /10\.000/);
    }
  });
});

describe('xác thực đầu vào', () => {
  test('từ chối khoản chi bằng 0 hoặc âm', () => {
    assert.equal(
      splitExpense({ total: money(0, 'VND'), participantIds: ['an'], mode: 'equal' }).ok,
      false,
    );
    assert.equal(
      splitExpense({ total: money(-100, 'VND'), participantIds: ['an'], mode: 'equal' }).ok,
      false,
    );
  });

  test('từ chối danh sách rỗng hoặc trùng người', () => {
    assert.equal(splitExpense({ total: money(100, 'VND'), participantIds: [], mode: 'equal' }).ok, false);
    assert.equal(
      splitExpense({ total: money(100, 'VND'), participantIds: ['an', 'an'], mode: 'equal' }).ok,
      false,
    );
  });
});

describe('bất biến tổng trên dải đầu vào rộng', () => {
  test('1200 tổ hợp ngẫu nhiên đều giữ đúng tổng, không phần nào âm', () => {
    // Bộ sinh giả ngẫu nhiên có hạt giống cố định: test thất bại thì lặp lại được y hệt.
    let seed = 20260915;
    const nextInt = (bound: number): number => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed % bound;
    };

    for (let round = 0; round < 1_200; round += 1) {
      const peopleCount = 1 + nextInt(8);
      const ids = Array.from({ length: peopleCount }, (_, i) => `p${i}`);
      const totalMinor = 1 + nextInt(5_000_000);
      const total = money(totalMinor, 'VND');

      const equalResult = splitExpense({ total, participantIds: ids, mode: 'equal' });
      const equal = expectOk(equalResult);
      assert.ok(linesBalanceTotal(total, equal.lines), `chia đều lệch tổng ở vòng ${round}`);
      assert.ok(
        equal.lines.every((line) => line.amount.minor >= 0),
        `chia đều ra số âm ở vòng ${round}`,
      );

      const shares: Record<string, number> = {};
      let allZero = true;
      for (const id of ids) {
        const value = nextInt(10);
        shares[id] = value;
        if (value > 0) allZero = false;
      }
      if (allZero) shares[ids[0]] = 1;

      const sharesResult = splitExpense({ total, participantIds: ids, mode: 'shares', shares });
      const byShares = expectOk(sharesResult);
      assert.ok(
        linesBalanceTotal(total, byShares.lines),
        `chia theo phần lệch tổng ở vòng ${round}: ${formatMoney(total)}`,
      );
      assert.ok(
        byShares.lines.every((line) => line.amount.minor >= 0),
        `chia theo phần ra số âm ở vòng ${round}`,
      );
    }
  });
});
