/**
 * Hook đồng soạn ghi chú — React thuần (không React Native), để bản web dùng lại
 * qua @core. Toàn bộ logic nằm ở NoteCollabSession (collab-session.ts); hook chỉ
 * tạo phiên theo ghi chú, nối kênh/lưu thật, và đọc trạng thái bằng
 * useSyncExternalStore.
 *
 * Chỉ dùng khi đã đăng nhập (chế độ khách không có realtime — màn hình tự chọn
 * luồng soạn cũ).
 */

import { useEffect, useState, useSyncExternalStore } from 'react';

import { openNoteChannel } from '@/lib/data/note-collab';
import { getNoteContent, saveNoteContent } from '@/lib/data/notes';
import type { StoredNoteContent } from '@/lib/data/notes';
import { describeError } from '@/lib/data/use-async';
import { DataError } from '@/lib/supabase/errors';

import type { SessionDeps, SessionSnapshot } from './collab-session';
import { NoteCollabSession } from './collab-session';

const REAL_DEPS: SessionDeps = {
  openChannel: openNoteChannel,
  saveContent: saveNoteContent,
  loadContent: getNoteContent,
  // NOTE_NOT_FOUND trong notes.ts mang mã 42501: ghi chú đã xoá hoặc mất quyền.
  isGoneError: (error) => error instanceof DataError && error.code === '42501',
  describeError,
  setTimer: (callback, ms) => setTimeout(callback, ms),
  clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  now: () => Date.now(),
  random: () => Math.random(),
};

/** Khoá phiên: một người mở hai máy/tab là hai phiên (hai con trỏ). Không cần mạnh về mật mã. */
function randomSessionKey(): string {
  return `s-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

const noopSubscribe = (): (() => void) => () => undefined;
const nullSnapshot = (): SessionSnapshot | null => null;

interface UseNoteCollabOptions {
  readonly tripId: string;
  readonly noteId: string;
  /** trip_members.id của người đang soạn (isMe). */
  readonly memberId: string;
  readonly initial: StoredNoteContent;
}

export interface NoteCollab {
  /** null trong khoảnh khắc trước khi phiên được tạo — hiện `initial`, khoá ô nhập. */
  readonly snapshot: SessionSnapshot | null;
  readonly session: NoteCollabSession | null;
}

export function useNoteCollab({ tripId, noteId, memberId, initial }: UseNoteCollabOptions): NoteCollab {
  const [sessionKey] = useState(randomSessionKey);
  const [session, setSession] = useState<NoteCollabSession | null>(null);
  const { title, body, updatedAt } = initial;

  useEffect(() => {
    const next = new NoteCollabSession(
      { tripId, noteId, memberId, sessionKey, initial: { title, body, updatedAt } },
      REAL_DEPS,
    );
    next.start();
    setSession(next);
    return () => {
      setSession(null);
      // Thả phiên: lưu nốt rồi mới rời kênh; mất mạng thì phiên chạy ngầm thử
      // lại tới khi lưu được — đóng màn đúng lúc đó không mất chữ.
      next.release();
    };
    // initial chỉ đọc lúc mở: danh sách chỉ tải lại sau khi đóng trình soạn.
  }, [tripId, noteId, memberId, sessionKey, title, body, updatedAt]);

  const snapshot = useSyncExternalStore(
    session ? session.subscribe : noopSubscribe,
    session ? session.getSnapshot : nullSnapshot,
  );
  return { snapshot, session };
}
