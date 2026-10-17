/**
 * Giao thức tin nhắn đồng soạn ghi chú — kiểu dữ liệu + giải/mã gói tin.
 * File THUẦN (không Supabase): tầng truyền tải ở src/lib/data/note-collab.ts,
 * lõi phiên ở collab-session.ts; test ở collab-protocol.test.ts.
 *
 * Mọi gói nhận về là DỮ LIỆU KHÔNG ĐÁNG TIN (một thành viên có thể gửi gói rác):
 * kiểm kiểu từng trường, giới hạn kích thước, giải base64 trong try. Gói hỏng →
 * null (bỏ), không ném lỗi làm sập phiên.
 */

import { decodeBase64, encodeBase64 } from './collab.ts';

/** Mốc một lần lưu trong phòng: updated_at của DB + snapshot Yjs của đúng nội dung đã lưu. */
export interface SaveMark {
  readonly updatedAt: string;
  readonly snapshot: string;
}

export interface CursorState {
  readonly from: string;
  readonly memberId: string;
  /** Vị trí tương đối (base64) trong nội dung; null = không đặt con trỏ ở nội dung. */
  readonly anchor: string | null;
  readonly head: string | null;
}

export type NoteCollabEvent =
  | { readonly type: 'update'; readonly update: Uint8Array }
  | { readonly type: 'sync-request'; readonly from: string; readonly stateVector: Uint8Array }
  | {
      readonly type: 'sync-response';
      /** Người trả lời — để người khác thấy đã có người trả và khỏi trả trùng. */
      readonly from: string;
      readonly to: string;
      readonly update: Uint8Array;
      /** State vector của người trả lời — người hỏi gửi lại phần người trả lời còn thiếu. */
      readonly stateVector: Uint8Array;
      readonly lastSave: SaveMark | null;
    }
  | { readonly type: 'cursor'; readonly cursor: CursorState }
  | { readonly type: 'saved'; readonly mark: SaveMark };

export type NoteCollabEventType = NoteCollabEvent['type'];

export const EVENT_TYPES: readonly NoteCollabEventType[] = [
  'update',
  'sync-request',
  'sync-response',
  'cursor',
  'saved',
];

export interface PresencePeer {
  /** Khoá phiên (mỗi tab/máy một khoá) — một người mở hai máy là hai phiên. */
  readonly key: string;
  readonly memberId: string;
}

export type ChannelStatus = 'connecting' | 'live' | 'error';

export interface NoteChannel {
  send(event: NoteCollabEvent): void;
  close(): void;
}

/**
 * Gói lớn hơn mức này bị bỏ ở cả hai đầu — Realtime gói Free giới hạn 256 KB
 * mỗi tin (base64 phình 4/3).
 */
export const MAX_FIELD_CHARS = 240_000;

export function noteTopic(tripId: string, noteId: string): string {
  return `trip-notes:${tripId}:${noteId}`;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length <= MAX_FIELD_CHARS ? value : null;
}

function bytes(value: unknown): Uint8Array | null {
  const encoded = text(value);
  if (encoded === null) return null;
  try {
    return decodeBase64(encoded);
  } catch {
    return null;
  }
}

function saveMark(value: unknown): SaveMark | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const updatedAt = text(record.updatedAt);
  const snapshot = text(record.snapshot);
  return updatedAt && snapshot ? { updatedAt, snapshot } : null;
}

/** Giải một gói broadcast thành sự kiện, hoặc null nếu gói rác. */
export function parseEvent(event: string, payload: unknown): NoteCollabEvent | null {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  switch (event) {
    case 'update': {
      const update = bytes(record.update);
      return update ? { type: 'update', update } : null;
    }
    case 'sync-request': {
      const from = text(record.from);
      const stateVector = bytes(record.stateVector);
      return from && stateVector ? { type: 'sync-request', from, stateVector } : null;
    }
    case 'sync-response': {
      const from = text(record.from);
      const to = text(record.to);
      const update = bytes(record.update);
      const stateVector = bytes(record.stateVector);
      if (!from || !to || !update || !stateVector) return null;
      return { type: 'sync-response', from, to, update, stateVector, lastSave: saveMark(record.lastSave) };
    }
    case 'cursor': {
      const from = text(record.from);
      const memberId = text(record.memberId);
      if (!from || !memberId) return null;
      return {
        type: 'cursor',
        cursor: { from, memberId, anchor: text(record.anchor), head: text(record.head) },
      };
    }
    case 'saved': {
      const mark = saveMark(record.mark);
      return mark ? { type: 'saved', mark } : null;
    }
    default:
      return null;
  }
}

/** Mã một sự kiện thành payload JSON; null nếu quá giới hạn (không gửi gói chắc chắn bị bỏ). */
export function serializeEvent(event: NoteCollabEvent): Record<string, unknown> | null {
  let payload: Record<string, unknown>;
  switch (event.type) {
    case 'update':
      payload = { update: encodeBase64(event.update) };
      break;
    case 'sync-request':
      payload = { from: event.from, stateVector: encodeBase64(event.stateVector) };
      break;
    case 'sync-response':
      payload = {
        from: event.from,
        to: event.to,
        update: encodeBase64(event.update),
        stateVector: encodeBase64(event.stateVector),
        lastSave: event.lastSave,
      };
      break;
    case 'cursor':
      payload = { ...event.cursor };
      break;
    case 'saved':
      payload = { mark: event.mark };
      break;
  }
  const oversized = Object.values(payload).some(
    (value) => typeof value === 'string' && value.length > MAX_FIELD_CHARS,
  );
  return oversized ? null : payload;
}
