import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  archiveCardCopy,
  dismissReminder,
  endedTrips,
  isTripEnded,
  shouldRemindArchive,
  splitByArchive,
} from './archive.ts';

function trip(id: string, startDate: string | null = null, endDate: string | null = null) {
  return { id, startDate, endDate };
}

const TODAY = '2026-09-26';

describe('isTripEnded', () => {
  test('ngày về trước hôm nay → đã kết thúc', () => {
    assert.equal(isTripEnded(trip('a', '2026-09-20', '2026-09-25'), TODAY), true);
  });

  test('ngày về đúng hôm nay → chưa kết thúc (đang ở ngày cuối)', () => {
    assert.equal(isTripEnded(trip('a', '2026-09-20', TODAY), TODAY), false);
  });

  test('ngày về trong tương lai → chưa kết thúc', () => {
    assert.equal(isTripEnded(trip('a', '2026-09-20', '2026-10-01'), TODAY), false);
  });

  test('chưa đặt ngày về: dùng ngày đi', () => {
    assert.equal(isTripEnded(trip('a', '2026-09-25', null), TODAY), true);
    assert.equal(isTripEnded(trip('a', TODAY, null), TODAY), false);
  });

  test('chỉ có ngày về', () => {
    assert.equal(isTripEnded(trip('a', null, '2026-09-01'), TODAY), true);
  });

  test('chưa đặt ngày nào → không bao giờ kết thúc', () => {
    assert.equal(isTripEnded(trip('a'), '2999-01-01'), false);
  });

  test('so theo ngày, không theo độ dài chuỗi: sang tháng/năm', () => {
    assert.equal(isTripEnded(trip('a', null, '2025-12-31'), '2026-01-01'), true);
    assert.equal(isTripEnded(trip('a', null, '2026-10-01'), '2026-09-30'), false);
  });
});

describe('splitByArchive', () => {
  test('tách đúng hai kệ, danh sách chính giữ thứ tự đầu vào', () => {
    const trips = [trip('a'), trip('b'), trip('c'), trip('d')];
    const archived = new Map([
      ['b', '2026-09-01T00:00:00.000Z'],
      ['d', '2026-09-10T00:00:00.000Z'],
    ]);
    const { active, archived: shelf } = splitByArchive(trips, archived);
    assert.deepEqual(active.map((t) => t.id), ['a', 'c']);
    // Mới lưu trữ lên trước.
    assert.deepEqual(shelf.map((t) => t.id), ['d', 'b']);
  });

  test('id lưu trữ không còn trong danh sách chuyến (đã rời chuyến) thì bỏ qua', () => {
    const { active, archived } = splitByArchive([trip('a')], new Map([['zzz', 'x']]));
    assert.deepEqual(active.map((t) => t.id), ['a']);
    assert.equal(archived.length, 0);
  });

  test('không lưu trữ gì → tất cả ở danh sách chính, không mất chuyến nào', () => {
    const trips = [trip('a'), trip('b')];
    const { active, archived } = splitByArchive(trips, new Map());
    assert.equal(active.length + archived.length, trips.length);
    assert.equal(archived.length, 0);
  });

  test('không sửa mảng đầu vào', () => {
    const trips = [trip('a'), trip('b')];
    const snapshot = JSON.stringify(trips);
    splitByArchive(trips, new Map([['a', '2026-01-01']]));
    assert.equal(JSON.stringify(trips), snapshot);
  });
});

describe('archiveCardCopy', () => {
  test('chưa lưu trữ, chưa kết thúc → không hiện thẻ', () => {
    assert.equal(archiveCardCopy(false, false, 3), null);
  });

  test('đã lưu trữ → luôn hiện nút bỏ lưu trữ, kể cả chuyến chưa kết thúc', () => {
    assert.equal(archiveCardCopy(true, false, 0)?.action, 'Bỏ lưu trữ');
    assert.equal(archiveCardCopy(true, true, 2)?.action, 'Bỏ lưu trữ');
  });

  test('đã kết thúc, còn nợ → nói rõ số lần chuyển và nợ vẫn còn', () => {
    const copy = archiveCardCopy(false, true, 2);
    assert.equal(copy?.action, 'Lưu trữ chuyến đi');
    assert.match(copy?.hint ?? '', /Còn 2 lần chuyển tiền/);
    assert.match(copy?.hint ?? '', /khoản nợ vẫn còn/);
  });

  test('đã kết thúc, hết nợ → báo đã thanh toán xong', () => {
    assert.match(archiveCardCopy(false, true, 0)?.hint ?? '', /thanh toán xong/);
  });
});

describe('nhắc lưu trữ', () => {
  const ended = [trip('a', null, '2026-09-01'), trip('b', null, '2026-09-02')];

  test('endedTrips chỉ lấy chuyến đã kết thúc, giữ thứ tự', () => {
    const active = [trip('x', null, '2026-12-01'), ...ended, trip('y')];
    assert.deepEqual(endedTrips(active, TODAY).map((t) => t.id), ['a', 'b']);
  });

  test('chưa bấm "Để sau" → nhắc', () => {
    assert.equal(shouldRemindArchive(ended, new Set()), true);
  });

  test('đã "Để sau" cho mọi chuyến đang nhắc → không nhắc', () => {
    assert.equal(shouldRemindArchive(ended, new Set(['a', 'b'])), false);
  });

  test('có thêm một chuyến vừa kết thúc → nhắc lại', () => {
    const more = [...ended, trip('c', null, '2026-09-25')];
    assert.equal(shouldRemindArchive(more, new Set(['a', 'b'])), true);
  });

  test('không có chuyến nào kết thúc → không nhắc', () => {
    assert.equal(shouldRemindArchive([], new Set()), false);
  });

  test('dismissReminder gộp id cũ + đang nhắc, bỏ id không còn chuyến', () => {
    const next = dismissReminder(new Set(['old-gone', 'a']), ended, new Set(['a', 'b', 'x']));
    assert.deepEqual([...next].sort(), ['a', 'b']);
  });

  test('sau dismissReminder thì không nhắc nữa với cùng danh sách', () => {
    const all = new Set(ended.map((t) => t.id));
    const next = new Set(dismissReminder(new Set(), ended, all));
    assert.equal(shouldRemindArchive(ended, next), false);
  });
});
