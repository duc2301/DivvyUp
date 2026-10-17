import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  canOfferMemberRemoval,
  countMemberExpenses,
  guestRemovalBlock,
  memberRemovalBlock,
} from './member-removal.ts';

describe('canOfferMemberRemoval', () => {
  const slot = { role: 'member', claimed: false };

  test('chủ chuyến + chỗ chưa nhận → có nút xoá', () => {
    assert.equal(canOfferMemberRemoval(slot, true), true);
  });

  test('không phải chủ chuyến → không có nút', () => {
    assert.equal(canOfferMemberRemoval(slot, false), false);
  });

  test('chỗ đã có người nhận → không có nút (gỡ không thu hồi được quyền)', () => {
    assert.equal(canOfferMemberRemoval({ role: 'member', claimed: true }, true), false);
  });

  test('chỗ của chủ chuyến → không có nút, kể cả khi chưa nhận', () => {
    assert.equal(canOfferMemberRemoval({ role: 'owner', claimed: false }, true), false);
  });
});

describe('countMemberExpenses', () => {
  const expenses = [
    { id: 'e1', paidByMemberId: 'a', shares: [{ participantId: 'a' }, { participantId: 'b' }] },
    { id: 'e2', paidByMemberId: 'c', shares: [{ participantId: 'b' }] },
    { id: 'e3', paidByMemberId: 'b', shares: [{ participantId: 'c' }] },
    { id: 'e4', paidByMemberId: 'c', shares: [{ participantId: 'c' }] },
  ];

  test('đếm cả khoản mình trả lẫn khoản có phần chia', () => {
    assert.equal(countMemberExpenses('b', expenses), 3);
  });

  test('vừa trả vừa có phần chia trong cùng khoản → chỉ tính một lần', () => {
    assert.equal(countMemberExpenses('a', expenses), 1);
  });

  test('không dính khoản nào → 0', () => {
    assert.equal(countMemberExpenses('x', expenses), 0);
    assert.equal(countMemberExpenses('a', []), 0);
  });
});

describe('memberRemovalBlock', () => {
  test('không dính gì → xoá được', () => {
    assert.equal(memberRemovalBlock('Tuấn', { expenses: 0, settlements: 0 }), null);
  });

  test('còn khoản chi → báo đúng số khoản', () => {
    const message = memberRemovalBlock('Tuấn', { expenses: 2, settlements: 0 });
    assert.ok(message?.includes('"Tuấn"'));
    assert.ok(message?.includes('2 khoản chi'));
    assert.ok(!message?.includes('tất toán'));
  });

  test('chỉ còn tất toán → vẫn chặn', () => {
    const message = memberRemovalBlock('Hoa', { expenses: 0, settlements: 1 });
    assert.ok(message?.includes('1 lần tất toán'));
  });

  test('cả hai → nêu cả hai', () => {
    const message = memberRemovalBlock('Hoa', { expenses: 3, settlements: 1 });
    assert.ok(message?.includes('3 khoản chi và 1 lần tất toán'));
  });
});

describe('guestRemovalBlock (chế độ khách — chốt duy nhất, không có DB kiểm lại)', () => {
  const expenses = [
    { id: 'e1', paidByMemberId: 'm0', shares: [{ participantId: 'm0' }, { participantId: 'm1' }] },
    { id: 'e2', paidByMemberId: 'm2', shares: [{ participantId: 'm0' }] },
  ];
  const slot = (id: string, extra: Partial<{ role: string; isMe: boolean }> = {}) => ({
    id,
    displayName: 'Người ' + id,
    role: 'member',
    isMe: false,
    ...extra,
  });

  test('chỗ "Bạn" (isMe) → không xoá', () => {
    assert.equal(guestRemovalBlock(slot('m9', { isMe: true }), []), 'Không xoá được chỗ của chính bạn.');
  });

  test('chỗ chủ chuyến → không xoá', () => {
    assert.ok(guestRemovalBlock(slot('m9', { role: 'owner' }), []));
  });

  test('chỉ có phần chia (không trả) → vẫn chặn, báo số khoản', () => {
    assert.ok(guestRemovalBlock(slot('m1'), expenses)?.includes('1 khoản chi'));
  });

  test('là người trả → chặn', () => {
    assert.ok(guestRemovalBlock(slot('m2'), expenses)?.includes('1 khoản chi'));
  });

  test('không dính khoản nào → xoá được', () => {
    assert.equal(guestRemovalBlock(slot('m3'), expenses), null);
  });
});
