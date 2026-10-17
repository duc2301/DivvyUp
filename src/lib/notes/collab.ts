/**
 * Đồng soạn ghi chú (kiểu Google Docs) — phần thuần: không React, không Supabase.
 * Dùng chung mobile và web (web import qua @core). Truyền tải nằm ở
 * src/lib/data/note-collab.ts, vòng đời ở src/lib/notes/use-note-collab.ts.
 *
 * Mô hình: mỗi ghi chú là một Y.Doc (CRDT Yjs) có hai Y.Text — tiêu đề và nội
 * dung. Mọi máy áp cùng tập thao tác thì hội tụ về cùng một chữ, không ai đè ai.
 * Bảng trip_notes vẫn là nơi lưu lâu dài (cột title/body), ghi định kỳ.
 *
 * Doc tạo với gc: false: giữ lại phần đã xoá để dựng được "doc tại lần lưu gần
 * nhất" (Y.createDocFromSnapshot) — cần cho việc gộp bản lưu từ app cũ
 * (mergeExternalEdit). Ghi chú tối đa 10.000 ký tự và doc dựng lại mỗi phiên từ
 * DB, nên lịch sử không phình mãi.
 */

import * as Y from 'yjs';

export const TITLE_FIELD = 'title';
export const BODY_FIELD = 'body';

export function createNoteDoc(): Y.Doc {
  return new Y.Doc({ gc: false });
}

// ---------------------------------------------------------------------------
// base64 — tự viết: lib0/buffer chọn nhánh Node trên React Native rồi gọi
// Buffer (không tồn tại trên RN).
// ---------------------------------------------------------------------------

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const LOOKUP = new Map<string, number>([...ALPHABET].map((char, index) => [char, index]));

export function encodeBase64(bytes: Uint8Array): string {
  let out = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index] ?? 0;
    const b = bytes[index + 1];
    const c = bytes[index + 2];
    const triple = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    out += ALPHABET[(triple >> 18) & 63];
    out += ALPHABET[(triple >> 12) & 63];
    out += b === undefined ? '=' : ALPHABET[(triple >> 6) & 63];
    out += c === undefined ? '=' : ALPHABET[triple & 63];
  }
  return out;
}

/** Ném lỗi với chuỗi không phải base64 hợp lệ — dữ liệu từ mạng là không đáng tin. */
export function decodeBase64(text: string): Uint8Array {
  if (text.length % 4 !== 0) throw new Error('base64 không hợp lệ');
  const padding = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0;
  const out = new Uint8Array((text.length / 4) * 3 - padding);
  let cursor = 0;
  for (let index = 0; index < text.length; index += 4) {
    const values = [0, 1, 2, 3].map((offset) => {
      const char = text[index + offset] ?? '';
      if (char === '=') return 0;
      const value = LOOKUP.get(char);
      if (value === undefined) throw new Error('base64 không hợp lệ');
      return value;
    });
    const triple = (values[0] << 18) | (values[1] << 12) | (values[2] << 6) | values[3];
    for (const shift of [16, 8, 0]) {
      if (cursor < out.length) out[cursor++] = (triple >> shift) & 255;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Chuyển "chuỗi cũ → chuỗi mới" (ô nhập chỉ cho biết giá trị mới) thành MỘT cặp
// xoá + chèn. Gõ, xoá, dán, sửa tự động đều là một vùng liền nhau.
// ---------------------------------------------------------------------------

export interface TextEdit {
  readonly index: number;
  readonly deleteCount: number;
  readonly insert: string;
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

/**
 * @param caret vị trí con trỏ SAU khi sửa (selectionEnd), nếu biết — dùng để đặt
 * đúng chỗ khi ký tự lặp: gõ "a" vào đầu "aa" phải là chèn ở 0, không phải ở 2
 * (chữ giống nhau nhưng con trỏ của người khác bám sai chỗ).
 */
export function diffText(prev: string, next: string, caret?: number): TextEdit | null {
  if (prev === next) return null;
  const minLength = Math.min(prev.length, next.length);
  let prefix = 0;
  while (prefix < minLength && prev.charCodeAt(prefix) === next.charCodeAt(prefix)) prefix += 1;

  if (caret !== undefined) {
    const grew = Math.max(0, next.length - prev.length);
    prefix = Math.max(0, Math.min(prefix, caret - grew));
  }
  // Không cắt đôi cặp surrogate (emoji): lùi về đầu ký tự.
  if (prefix > 0 && isHighSurrogate(next.charCodeAt(prefix - 1))) prefix -= 1;

  let suffix = 0;
  while (
    suffix < minLength - prefix &&
    prev.charCodeAt(prev.length - 1 - suffix) === next.charCodeAt(next.length - 1 - suffix)
  ) {
    suffix += 1;
  }
  if (suffix > 0 && isHighSurrogate(next.charCodeAt(next.length - suffix - 1))) suffix -= 1;

  return {
    index: prefix,
    deleteCount: prev.length - prefix - suffix,
    insert: next.slice(prefix, next.length - suffix),
  };
}

/** Áp một thay đổi vào Y.Text (trong transaction của người gọi). */
export function applyTextEdit(text: Y.Text, edit: TextEdit): void {
  if (edit.deleteCount > 0) text.delete(edit.index, edit.deleteCount);
  if (edit.insert !== '') text.insert(edit.index, edit.insert);
}

/** Đặt Y.Text thành `next` bằng thay đổi tối thiểu. */
export function setText(doc: Y.Doc, field: string, next: string, caret?: number, origin?: unknown): void {
  const text = doc.getText(field);
  const edit = diffText(text.toString(), next, caret);
  if (!edit) return;
  doc.transact(() => applyTextEdit(text, edit), origin);
}

// ---------------------------------------------------------------------------
// Gieo nội dung ban đầu từ DB — TẤT ĐỊNH.
//
// Hai người mở ghi chú cùng lúc khi phòng trống thì cả hai đều gieo từ DB. Gieo
// bằng clientID ngẫu nhiên → hai lần chèn khác nhau → chữ NHÂN ĐÔI (và bị lưu
// xuống DB). Gieo trong một doc riêng với clientID tính từ TOÀN BỘ nội dung →
// cùng dòng DB ra đúng cùng thao tác → Yjs gộp như một.
// Mã băm phủ cả tiêu đề lẫn nội dung: cùng ID mà khác nội dung thì các máy không
// bao giờ hội tụ.
// ---------------------------------------------------------------------------

export interface NoteContent {
  readonly title: string;
  readonly body: string;
}

/** FNV-1a 32 bit — đủ để tách hai phiên bản nội dung, không dùng cho bảo mật. */
export function seedClientId(noteId: string, content: NoteContent): number {
  let hash = 0x811c9dc5;
  const input = `${noteId}\u0000${content.title}\u0000${content.body}`;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  // clientID 0 tránh dùng (một số chỗ của Yjs coi là "chưa có").
  return hash === 0 ? 1 : hash;
}

export function buildSeedUpdate(noteId: string, content: NoteContent): Uint8Array {
  const seed = createNoteDoc();
  seed.clientID = seedClientId(noteId, content);
  seed.transact(() => {
    if (content.title !== '') seed.getText(TITLE_FIELD).insert(0, content.title);
    if (content.body !== '') seed.getText(BODY_FIELD).insert(0, content.body);
  });
  const update = Y.encodeStateAsUpdate(seed);
  seed.destroy();
  return update;
}

export function readContent(doc: Y.Doc): NoteContent {
  return { title: doc.getText(TITLE_FIELD).toString(), body: doc.getText(BODY_FIELD).toString() };
}

// ---------------------------------------------------------------------------
// Gộp bản lưu từ NGOÀI phòng (app cũ chưa nhận OTA lưu đè cả ghi chú).
//
// "Như Google Docs" = không ai mất chữ. Ta biết nội dung ở lần lưu gần nhất trong
// phòng (base, dựng lại từ snapshot) và nội dung vừa bị ghi đè (external). Phần
// người dùng app cũ thật sự sửa = diff(base → external). Áp diff đó lên doc dựng
// tại base với một clientID mới, rồi lấy phần thao tác mới ra: thao tác neo đúng
// vị trí trong lịch sử CRDT, nên gộp với mọi thứ đã gõ sau base mà không đè.
// ---------------------------------------------------------------------------

export function encodeSnapshotOf(doc: Y.Doc): string {
  return encodeBase64(Y.encodeSnapshot(Y.snapshot(doc)));
}

/**
 * @returns update cần áp vào doc chính (rỗng nghĩa là không có gì để gộp), hoặc
 * null nếu không dựng được doc tại base (doc chưa có đủ thao tác của snapshot).
 */
export function mergeExternalEdit(
  doc: Y.Doc,
  baseSnapshot: string,
  external: NoteContent,
): Uint8Array | null {
  let baseDoc: Y.Doc;
  try {
    baseDoc = Y.createDocFromSnapshot(doc, Y.decodeSnapshot(decodeBase64(baseSnapshot)));
  } catch {
    return null;
  }
  const before = Y.encodeStateVector(baseDoc);
  baseDoc.transact(() => {
    for (const field of [TITLE_FIELD, BODY_FIELD] as const) {
      const text = baseDoc.getText(field);
      const edit = diffText(text.toString(), external[field]);
      if (edit) applyTextEdit(text, edit);
    }
  });
  const update = Y.encodeStateAsUpdate(baseDoc, before);
  baseDoc.destroy();
  return update;
}

// ---------------------------------------------------------------------------
// Con trỏ của người khác: vị trí TƯƠNG ĐỐI (bám theo ký tự, không theo số thứ
// tự) — người khác gõ phía trước thì con trỏ vẫn đứng đúng chữ.
// ---------------------------------------------------------------------------

export function relativeAt(doc: Y.Doc, field: string, index: number): string {
  const text = doc.getText(field);
  const clamped = Math.max(0, Math.min(index, text.length));
  return encodeBase64(Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(text, clamped)));
}

/** null nếu vị trí không giải được (dữ liệu rác, thao tác chưa về tới). */
export function absoluteFrom(doc: Y.Doc, field: string, relative: string): number | null {
  try {
    const position = Y.createAbsolutePositionFromRelativePosition(
      Y.decodeRelativePosition(decodeBase64(relative)),
      doc,
    );
    if (!position || position.type !== doc.getText(field)) return null;
    return position.index;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Màu con trỏ: cố định theo người (cùng người cùng màu trên mọi máy). Trả về
// CHỈ SỐ ô màu — mã màu nằm trong bảng token (--cursor-N), không ở đây.
// ---------------------------------------------------------------------------

export const CURSOR_SLOTS = 6;

export function cursorSlot(memberId: string): number {
  let hash = 0;
  for (let index = 0; index < memberId.length; index += 1) {
    hash = (Math.imul(hash, 31) + memberId.charCodeAt(index)) >>> 0;
  }
  return hash % CURSOR_SLOTS;
}
