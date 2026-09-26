/**
 * Ma trận ca cho diffSnapshots — so hai ảnh chụp khoản chi.
 *
 * Nhóm ca:
 *  - Từng trường đơn: nội dung, tổng tiền, người trả, thời điểm, cách chia.
 *  - Phần chia: thêm người, bỏ người ("không chịu"), đổi số tiền.
 *  - Không đổi gì → [].
 *  - Nhiều trường đổi cùng lúc → mỗi trường một dòng, đúng thứ tự khai báo trong code.
 *
 * Không kiểm lẫn đơn vị tiền tệ ở đây: diffSnapshots chỉ định dạng độc lập từng vế,
 * không cộng trừ hai bên nên không có chỗ để MoneyError xảy ra.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { ExpenseSnapshot } from '../data/expenses.ts';
import { formatDateTime } from '../datetime.ts';
import { money } from '../money/money.ts';
import { SPLIT_LABEL, diffSnapshots } from './diff-snapshot.ts';

const NAMES: Record<string, string> = {
  an: 'An',
  binh: 'Bình',
  cuong: 'Cường',
};
const nameOf = (id: string): string => NAMES[id] ?? id;

function baseSnapshot(overrides: Partial<ExpenseSnapshot> = {}): ExpenseSnapshot {
  return {
    description: 'Ăn tối',
    total: money(300_000, 'VND'),
    paidByMemberId: 'an',
    splitMode: 'equal',
    paidAt: '2026-09-15T19:30:00.000Z',
    settledAt: null,
    shares: [
      { participantId: 'an', amount: money(100_000, 'VND') },
      { participantId: 'binh', amount: money(100_000, 'VND') },
      { participantId: 'cuong', amount: money(100_000, 'VND') },
    ],
    ...overrides,
  };
}

function labelsOf(before: ExpenseSnapshot, after: ExpenseSnapshot): string[] {
  return diffSnapshots(before, after, nameOf).map((change) => change.label);
}

describe('diffSnapshots — từng trường đơn', () => {
  test('đổi nội dung', () => {
    const before = baseSnapshot();
    const after = baseSnapshot({ description: 'Ăn trưa' });
    const changes = diffSnapshots(before, after, nameOf);
    assert.deepEqual(changes, [{ label: 'Nội dung', before: 'Ăn tối', after: 'Ăn trưa' }]);
  });

  test('đổi tổng tiền', () => {
    const before = baseSnapshot();
    const after = baseSnapshot({ total: money(450_000, 'VND') });
    const changes = diffSnapshots(before, after, nameOf);
    assert.equal(changes.length, 1);
    assert.equal(changes[0].label, 'Tổng tiền');
    assert.ok(changes[0].before.includes('300.000'));
    assert.ok(changes[0].after.includes('450.000'));
  });

  test('đổi người trả', () => {
    const before = baseSnapshot({ paidByMemberId: 'an' });
    const after = baseSnapshot({ paidByMemberId: 'binh' });
    const changes = diffSnapshots(before, after, nameOf);
    assert.deepEqual(changes, [{ label: 'Người trả', before: 'An', after: 'Bình' }]);
  });

  test('đổi thời điểm', () => {
    const before = baseSnapshot({ paidAt: '2026-09-15T19:30:00.000Z' });
    const after = baseSnapshot({ paidAt: '2026-09-16T08:00:00.000Z' });
    const changes = diffSnapshots(before, after, nameOf);
    assert.deepEqual(changes, [
      {
        label: 'Thời điểm',
        before: formatDateTime(new Date('2026-09-15T19:30:00.000Z')),
        after: formatDateTime(new Date('2026-09-16T08:00:00.000Z')),
      },
    ]);
  });

  test('đổi cách chia', () => {
    const before = baseSnapshot({ splitMode: 'equal' });
    const after = baseSnapshot({ splitMode: 'exact' });
    const changes = diffSnapshots(before, after, nameOf);
    assert.deepEqual(changes, [
      { label: 'Cách chia', before: SPLIT_LABEL.equal, after: SPLIT_LABEL.exact },
    ]);
  });
});

describe('diffSnapshots — phần chia theo từng người', () => {
  test('thêm người mới vào phần chia', () => {
    const before = baseSnapshot({
      shares: [
        { participantId: 'an', amount: money(150_000, 'VND') },
        { participantId: 'binh', amount: money(150_000, 'VND') },
      ],
    });
    const after = baseSnapshot({
      shares: [
        { participantId: 'an', amount: money(100_000, 'VND') },
        { participantId: 'binh', amount: money(100_000, 'VND') },
        { participantId: 'cuong', amount: money(100_000, 'VND') },
      ],
    });
    const changes = diffSnapshots(before, after, nameOf);
    const cuong = changes.find((c) => c.label === 'Phần của Cường');
    assert.ok(cuong, 'phải có dòng cho người mới thêm');
    assert.equal(cuong!.before, 'không chịu');
  });

  test('bỏ người khỏi phần chia', () => {
    const before = baseSnapshot({
      shares: [
        { participantId: 'an', amount: money(100_000, 'VND') },
        { participantId: 'binh', amount: money(100_000, 'VND') },
        { participantId: 'cuong', amount: money(100_000, 'VND') },
      ],
    });
    const after = baseSnapshot({
      shares: [
        { participantId: 'an', amount: money(150_000, 'VND') },
        { participantId: 'binh', amount: money(150_000, 'VND') },
      ],
    });
    const changes = diffSnapshots(before, after, nameOf);
    const cuong = changes.find((c) => c.label === 'Phần của Cường');
    assert.ok(cuong, 'phải có dòng cho người bị bỏ');
    assert.equal(cuong!.after, 'không chịu');
  });

  test('đổi số tiền của một người, người khác giữ nguyên thì không xuất hiện', () => {
    const before = baseSnapshot();
    const after = baseSnapshot({
      shares: [
        { participantId: 'an', amount: money(100_000, 'VND') },
        { participantId: 'binh', amount: money(150_000, 'VND') },
        { participantId: 'cuong', amount: money(50_000, 'VND') },
      ],
    });
    const changes = diffSnapshots(before, after, nameOf);
    assert.equal(changes.length, 2);
    assert.ok(changes.some((c) => c.label === 'Phần của Bình'));
    assert.ok(changes.some((c) => c.label === 'Phần của Cường'));
    assert.ok(!changes.some((c) => c.label === 'Phần của An'), 'An không đổi thì không được xuất hiện');
  });

  test('không đổi gì thì trả về mảng rỗng', () => {
    const before = baseSnapshot();
    const after = baseSnapshot();
    assert.deepEqual(diffSnapshots(before, after, nameOf), []);
  });

  test('cùng cấu trúc, giá trị y hệt (deep equal khác reference) vẫn coi là không đổi', () => {
    const before = baseSnapshot({
      shares: [
        { participantId: 'an', amount: money(100_000, 'VND') },
        { participantId: 'binh', amount: money(200_000, 'VND') },
      ],
      total: money(300_000, 'VND'),
    });
    const after = baseSnapshot({
      shares: [
        { participantId: 'an', amount: money(100_000, 'VND') },
        { participantId: 'binh', amount: money(200_000, 'VND') },
      ],
      total: money(300_000, 'VND'),
    });
    assert.deepEqual(diffSnapshots(before, after, nameOf), []);
  });
});

describe('diffSnapshots — nhiều trường đổi cùng lúc', () => {
  test('đổi nội dung, tổng tiền và phần chia cùng lúc → mỗi thứ một dòng, đúng thứ tự', () => {
    const before = baseSnapshot();
    const after = baseSnapshot({
      description: 'Ăn tối (đổi quán)',
      total: money(330_000, 'VND'),
      shares: [
        { participantId: 'an', amount: money(110_000, 'VND') },
        { participantId: 'binh', amount: money(110_000, 'VND') },
        { participantId: 'cuong', amount: money(110_000, 'VND') },
      ],
    });
    assert.deepEqual(labelsOf(before, after), [
      'Nội dung',
      'Tổng tiền',
      'Phần của An',
      'Phần của Bình',
      'Phần của Cường',
    ]);
  });
});
