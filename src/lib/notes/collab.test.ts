import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import * as Y from 'yjs';

import {
  absoluteFrom,
  BODY_FIELD,
  buildSeedUpdate,
  createNoteDoc,
  cursorSlot,
  CURSOR_SLOTS,
  decodeBase64,
  diffText,
  encodeBase64,
  encodeSnapshotOf,
  mergeExternalEdit,
  readContent,
  relativeAt,
  seedClientId,
  setText,
  TITLE_FIELD,
} from './collab.ts';

function sync(a: Y.Doc, b: Y.Doc): void {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));
}

function seeded(noteId: string, title: string, body: string): Y.Doc {
  const doc = createNoteDoc();
  Y.applyUpdate(doc, buildSeedUpdate(noteId, { title, body }));
  return doc;
}

describe('base64', () => {
  test('khứ hồi đúng mọi độ dài (0, 1, 2, 3 byte dư)', () => {
    for (let length = 0; length < 40; length += 1) {
      const bytes = Uint8Array.from({ length }, (_, index) => (index * 37 + 11) % 256);
      assert.deepEqual(decodeBase64(encodeBase64(bytes)), bytes);
    }
  });

  test('khớp chuẩn base64', () => {
    assert.equal(encodeBase64(new TextEncoder().encode('Đà Lạt')), 'xJDDoCBM4bqhdA==');
  });

  test('chuỗi rác → ném lỗi, không trả dữ liệu sai', () => {
    assert.throws(() => decodeBase64('abc'));
    assert.throws(() => decodeBase64('ab!d'));
  });
});

describe('diffText', () => {
  const apply = (prev: string, next: string, caret?: number): string => {
    const edit = diffText(prev, next, caret);
    if (!edit) return prev;
    return prev.slice(0, edit.index) + edit.insert + prev.slice(edit.index + edit.deleteCount);
  };

  test('không đổi → null', () => {
    assert.equal(diffText('abc', 'abc'), null);
  });

  test('gõ, xoá, thay, dán đều tái tạo đúng chuỗi mới', () => {
    for (const [prev, next] of [
      ['', 'xin chào'],
      ['xin chào', ''],
      ['Đà Lạt', 'Đà Lạt cuối tuần'],
      ['Đà Lạt cuối tuần', 'Đà Lạt tuần'],
      ['hello world', 'hello brave new world'],
      ['abc', 'xyz'],
    ] as const) {
      assert.equal(apply(prev, next), next, `${prev} → ${next}`);
    }
  });

  test('ký tự lặp: gõ "a" vào đầu "aa" (con trỏ sau 1) là chèn ở 0', () => {
    assert.deepEqual(diffText('aa', 'aaa', 1), { index: 0, deleteCount: 0, insert: 'a' });
  });

  test('ký tự lặp: gõ ở cuối (con trỏ sau 3) là chèn ở 2', () => {
    assert.deepEqual(diffText('aa', 'aaa', 3), { index: 2, deleteCount: 0, insert: 'a' });
  });

  test('không cắt đôi emoji (cặp surrogate)', () => {
    const edit = diffText('a😀', 'a😃');
    assert.ok(edit);
    assert.equal(edit.index, 1);
    assert.equal(edit.insert, '😃');
    assert.equal(apply('a😀', 'a😃'), 'a😃');
  });

  test('bộ gõ tiếng Việt thay chữ đã gõ (a → â) vẫn đúng', () => {
    assert.equal(apply('Ca', 'Câ', 2), 'Câ');
    assert.equal(apply('Cân', 'Cần', 3), 'Cần');
  });
});

describe('gieo tất định', () => {
  test('cùng nội dung → cùng clientID; khác một ký tự → khác', () => {
    const content = { title: 'Kế hoạch', body: 'Ngày 1' };
    assert.equal(seedClientId('n1', content), seedClientId('n1', content));
    assert.notEqual(seedClientId('n1', content), seedClientId('n1', { ...content, body: 'Ngày 2' }));
    assert.notEqual(seedClientId('n1', content), seedClientId('n2', content));
    assert.notEqual(
      seedClientId('n1', { title: 'ab', body: 'c' }),
      seedClientId('n1', { title: 'a', body: 'bc' }),
      'ranh giới tiêu đề/nội dung phải nằm trong mã băm',
    );
  });

  test('hai người cùng gieo từ một dòng DB rồi gặp nhau → KHÔNG nhân đôi chữ', () => {
    const a = seeded('n1', 'Kế hoạch', 'Ngày 1: Đà Lạt');
    const b = seeded('n1', 'Kế hoạch', 'Ngày 1: Đà Lạt');
    sync(a, b);
    assert.deepEqual(readContent(a), { title: 'Kế hoạch', body: 'Ngày 1: Đà Lạt' });
    assert.deepEqual(readContent(b), readContent(a));
  });

  test('gieo xong mỗi người gõ một chỗ → hội tụ, giữ chữ của cả hai', () => {
    const a = seeded('n1', 'T', 'abc');
    const b = seeded('n1', 'T', 'abc');
    setText(a, BODY_FIELD, 'Xabc', 1);
    setText(b, BODY_FIELD, 'abcY', 4);
    sync(a, b);
    assert.equal(a.getText(BODY_FIELD).toString(), 'XabcY');
    assert.equal(b.getText(BODY_FIELD).toString(), 'XabcY');
  });

  test('ghi chú rỗng gieo được', () => {
    assert.deepEqual(readContent(seeded('n1', '', '')), { title: '', body: '' });
  });
});

describe('mergeExternalEdit — gộp bản lưu từ app cũ', () => {
  test('người trong phòng gõ thêm sau lần lưu, app cũ sửa chỗ khác → giữ cả hai', () => {
    const doc = seeded('n1', 'Kế hoạch', 'Mang áo ấm.');
    const base = encodeSnapshotOf(doc); // lần lưu gần nhất: "Mang áo ấm."
    setText(doc, BODY_FIELD, 'Mang áo ấm. Đặt phòng.', 22); // gõ thêm sau khi lưu

    // App cũ mở bản đã lưu, sửa đầu câu rồi lưu đè cả ghi chú.
    const update = mergeExternalEdit(doc, base, { title: 'Kế hoạch', body: 'Nhớ mang áo ấm.' });
    assert.ok(update);
    Y.applyUpdate(doc, update);
    assert.equal(doc.getText(BODY_FIELD).toString(), 'Nhớ mang áo ấm. Đặt phòng.');
  });

  test('app cũ đổi tiêu đề → tiêu đề đổi, nội dung đang gõ còn nguyên', () => {
    const doc = seeded('n1', 'Lưu ý', 'abc');
    const base = encodeSnapshotOf(doc);
    setText(doc, BODY_FIELD, 'abcd', 4);
    const update = mergeExternalEdit(doc, base, { title: 'Lưu ý quan trọng', body: 'abc' });
    assert.ok(update);
    Y.applyUpdate(doc, update);
    assert.deepEqual(readContent(doc), { title: 'Lưu ý quan trọng', body: 'abcd' });
  });

  test('bản ngoài trùng base → không có thay đổi', () => {
    const doc = seeded('n1', 'T', 'abc');
    const base = encodeSnapshotOf(doc);
    const update = mergeExternalEdit(doc, base, { title: 'T', body: 'abc' });
    assert.ok(update);
    const before = readContent(doc);
    Y.applyUpdate(doc, update);
    assert.deepEqual(readContent(doc), before);
  });

  test('máy khác nhận update gộp qua đồng bộ → cùng kết quả', () => {
    const a = seeded('n1', 'T', 'abc');
    const b = seeded('n1', 'T', 'abc');
    const base = encodeSnapshotOf(a);
    const update = mergeExternalEdit(a, base, { title: 'T', body: 'abcX' });
    assert.ok(update);
    Y.applyUpdate(a, update);
    sync(a, b);
    assert.equal(b.getText(BODY_FIELD).toString(), 'abcX');
  });

  test('snapshot rác → null, không làm hỏng doc', () => {
    const doc = seeded('n1', 'T', 'abc');
    assert.equal(mergeExternalEdit(doc, 'rác!!', { title: 'T', body: 'x' }), null);
    assert.equal(doc.getText(BODY_FIELD).toString(), 'abc');
  });
});

describe('vị trí con trỏ tương đối', () => {
  test('người khác chèn phía trước → con trỏ vẫn đứng đúng chữ', () => {
    const a = seeded('n1', 'T', 'Đà Lạt');
    const b = seeded('n1', 'T', 'Đà Lạt');
    const cursor = relativeAt(b, BODY_FIELD, 3); // trước chữ "Lạt"
    setText(a, BODY_FIELD, 'Đi Đà Lạt', 3);
    sync(a, b);
    assert.equal(absoluteFrom(a, BODY_FIELD, cursor), 6);
  });

  test('chỉ số vượt độ dài → kẹp về cuối', () => {
    const doc = seeded('n1', 'T', 'abc');
    assert.equal(absoluteFrom(doc, BODY_FIELD, relativeAt(doc, BODY_FIELD, 99)), 3);
  });

  test('vị trí của trường khác hoặc rác → null', () => {
    const doc = seeded('n1', 'Tiêu đề', 'abc');
    assert.equal(absoluteFrom(doc, BODY_FIELD, relativeAt(doc, TITLE_FIELD, 2)), null);
    assert.equal(absoluteFrom(doc, BODY_FIELD, 'không-phải-base64'), null);
  });
});

describe('cursorSlot', () => {
  test('cố định theo người, nằm trong bảng màu', () => {
    for (const id of ['m0', 'm1', '7c2f9f8e-772c-4d7f-b59c-c8902ec3c3f0']) {
      const slot = cursorSlot(id);
      assert.equal(cursorSlot(id), slot);
      assert.ok(slot >= 0 && slot < CURSOR_SLOTS);
    }
  });

  test('nhiều người khác nhau → dùng nhiều màu khác nhau (không dồn một màu)', () => {
    const slots = new Set(Array.from({ length: 30 }, (_, index) => cursorSlot('member-' + index)));
    assert.ok(slots.size >= 4, String(slots.size));
  });
});
