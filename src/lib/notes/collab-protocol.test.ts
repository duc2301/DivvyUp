import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { encodeBase64 } from './collab.ts';
import type { NoteCollabEvent } from './collab-protocol.ts';
import { MAX_FIELD_CHARS, noteTopic, parseEvent, serializeEvent } from './collab-protocol.ts';

const bytes = new Uint8Array([1, 2, 3, 250]);
const b64 = encodeBase64(bytes);

describe('parseEvent — gói từ kênh là dữ liệu không đáng tin', () => {
  test('payload không phải object (null, mảng, số, chuỗi) → null', () => {
    for (const payload of [null, undefined, [], 42, 'x', true]) {
      assert.equal(parseEvent('update', payload), null, String(payload));
    }
  });

  test('tên sự kiện lạ → null', () => {
    assert.equal(parseEvent('delete-everything', { update: b64 }), null);
  });

  test('thiếu trường hoặc sai kiểu → null', () => {
    assert.equal(parseEvent('update', {}), null);
    assert.equal(parseEvent('update', { update: 123 }), null);
    assert.equal(parseEvent('sync-request', { from: 'a' }), null);
    assert.equal(parseEvent('sync-response', { from: 'a', to: 'b', update: b64 }), null);
    assert.equal(parseEvent('cursor', { memberId: 'm' }), null);
    assert.equal(parseEvent('saved', { mark: { updatedAt: 'x' } }), null);
  });

  test('base64 hỏng → null, không ném lỗi', () => {
    assert.equal(parseEvent('update', { update: 'ab!d' }), null);
    assert.equal(parseEvent('update', { update: 'abc' }), null);
  });

  test('trường dài quá giới hạn → null', () => {
    assert.equal(parseEvent('update', { update: 'A'.repeat(MAX_FIELD_CHARS + 4) }), null);
  });

  test('lastSave hỏng trong sync-response → bỏ riêng lastSave, giữ phần còn lại', () => {
    const event = parseEvent('sync-response', {
      from: 'a',
      to: 'b',
      update: b64,
      stateVector: b64,
      lastSave: { updatedAt: 1 },
    });
    assert.ok(event && event.type === 'sync-response');
    assert.equal(event.lastSave, null);
  });

  test('con trỏ: anchor/head không phải chuỗi → null (không đặt con trỏ)', () => {
    const event = parseEvent('cursor', { from: 'a', memberId: 'm', anchor: 5, head: {} });
    assert.ok(event && event.type === 'cursor');
    assert.equal(event.cursor.anchor, null);
    assert.equal(event.cursor.head, null);
  });
});

describe('serializeEvent ↔ parseEvent', () => {
  test('khứ hồi đúng mọi loại sự kiện', () => {
    const events: NoteCollabEvent[] = [
      { type: 'update', update: bytes },
      { type: 'sync-request', from: 'a', stateVector: bytes },
      {
        type: 'sync-response',
        from: 'a',
        to: 'b',
        update: bytes,
        stateVector: bytes,
        lastSave: { updatedAt: '2026-10-17T00:00:00Z', snapshot: b64 },
      },
      { type: 'cursor', cursor: { from: 'a', memberId: 'm', anchor: b64, head: null } },
      { type: 'saved', mark: { updatedAt: '2026-10-17T00:00:00Z', snapshot: b64 } },
    ];
    for (const event of events) {
      const payload = serializeEvent(event);
      assert.ok(payload, event.type);
      assert.deepEqual(parseEvent(event.type, JSON.parse(JSON.stringify(payload))), event);
    }
  });

  test('gói quá lớn → không gửi (null) thay vì gửi rồi bị máy chủ bỏ', () => {
    const huge = new Uint8Array(Math.ceil((MAX_FIELD_CHARS / 4) * 3) + 30);
    assert.equal(serializeEvent({ type: 'update', update: huge }), null);
  });
});

test('noteTopic theo chuyến + ghi chú (khớp regex của can_join_note_channel)', () => {
  assert.equal(noteTopic('t-1', 'n-1'), 'trip-notes:t-1:n-1');
});
