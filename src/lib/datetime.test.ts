import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  formatDate,
  formatDateTime,
  formatRelativeDateTime,
  parseDateTime,
  toIsoDate,
} from './datetime.ts';

describe('định dạng', () => {
  test('dd/MM/yyyy HH:mm với số 0 đứng đầu', () => {
    assert.equal(formatDateTime(new Date(2026, 8, 5, 7, 3)), '05/09/2026 07:03');
    assert.equal(formatDateTime(new Date(2026, 11, 25, 23, 59)), '25/12/2026 23:59');
    assert.equal(formatDate(new Date(2026, 0, 1, 0, 0)), '01/01/2026');
  });

  test('toIsoDate cho cột date của Postgres', () => {
    assert.equal(toIsoDate(new Date(2026, 8, 5)), '2026-09-05');
    assert.equal(toIsoDate(new Date(2026, 11, 31)), '2026-12-31');
  });
});

describe('parseDateTime', () => {
  test('đọc được định dạng đầy đủ', () => {
    const parsed = parseDateTime('15/09/2026 19:30');
    assert.ok(parsed);
    assert.equal(parsed.getFullYear(), 2026);
    assert.equal(parsed.getMonth(), 8);
    assert.equal(parsed.getDate(), 15);
    assert.equal(parsed.getHours(), 19);
    assert.equal(parsed.getMinutes(), 30);
  });

  test('thiếu giờ thì mặc định 00:00', () => {
    const parsed = parseDateTime('1/1/2026');
    assert.ok(parsed);
    assert.equal(parsed.getHours(), 0);
    assert.equal(parsed.getMinutes(), 0);
  });

  test('chấp nhận một chữ số và khoảng trắng thừa', () => {
    assert.ok(parseDateTime('  5/9/2026  7:05 '));
  });

  test('từ chối ngày không tồn tại thay vì để Date tự trượt tháng', () => {
    // Date(2026, 1, 31) sẽ thành 03/03 nếu không kiểm lại.
    assert.equal(parseDateTime('31/02/2026'), null);
    assert.equal(parseDateTime('31/04/2026'), null);
  });

  test('chấp nhận 29/02 của năm nhuận, từ chối năm thường', () => {
    assert.ok(parseDateTime('29/02/2028'));
    assert.equal(parseDateTime('29/02/2026'), null);
  });

  test('từ chối giờ phút ngoài khoảng', () => {
    assert.equal(parseDateTime('15/09/2026 24:00'), null);
    assert.equal(parseDateTime('15/09/2026 12:60'), null);
  });

  test('từ chối rác', () => {
    assert.equal(parseDateTime(''), null);
    assert.equal(parseDateTime('hôm nay'), null);
    assert.equal(parseDateTime('2026-09-15'), null);
    assert.equal(parseDateTime('15/13/2026'), null);
  });

  test('format rồi parse phải quay về đúng thời điểm ban đầu', () => {
    const original = new Date(2026, 8, 15, 19, 30, 0, 0);
    const roundTripped = parseDateTime(formatDateTime(original));
    assert.equal(roundTripped?.getTime(), original.getTime());
  });
});

describe('formatRelativeDateTime', () => {
  const now = new Date(2026, 8, 15, 22, 0);

  test('hôm nay và hôm qua', () => {
    assert.equal(formatRelativeDateTime(new Date(2026, 8, 15, 19, 30), now), 'Hôm nay 19:30');
    assert.equal(formatRelativeDateTime(new Date(2026, 8, 14, 12, 5), now), 'Hôm qua 12:05');
  });

  test('xa hơn thì hiện ngày/tháng', () => {
    assert.equal(formatRelativeDateTime(new Date(2026, 8, 13, 8, 0), now), '13/09 08:00');
  });

  test('qua ranh giới tháng vẫn đúng', () => {
    const firstOfMonth = new Date(2026, 9, 1, 9, 0);
    assert.equal(formatRelativeDateTime(new Date(2026, 8, 30, 9, 0), firstOfMonth), 'Hôm qua 09:00');
  });
});
