import type { ReactNode } from 'react';
import { useId, useLayoutEffect, useRef } from 'react';

import type { PeerCursor } from '@/entities/note';

/** Tên lớp màu viết LIỀN chữ để Tailwind giữ lại khi build. */
const CURSOR_BG = ['bg-cursor-0', 'bg-cursor-1', 'bg-cursor-2', 'bg-cursor-3', 'bg-cursor-4', 'bg-cursor-5'];

/** Lớp chữ dùng chung cho ô nhập và lớp soi gương — lệch một thuộc tính là con trỏ lệch chỗ. */
const TEXT_LAYOUT =
  'w-full min-w-0 rounded-xl border p-3 text-base leading-6 whitespace-pre-wrap break-words [overflow-wrap:anywhere]';

interface CollabTextareaProps {
  readonly label: string;
  readonly value: string;
  readonly disabled: boolean;
  /** Vượt giới hạn: tô đỏ bộ đếm (không chặn gõ — xem collab-note-editor). */
  readonly overLimit: boolean;
  readonly placeholder?: string;
  readonly hint?: string;
  readonly cursors: readonly PeerCursor[];
  readonly nameOf: (memberId: string) => string;
  /** Con trỏ của mình sau khi người khác sửa phía trước — đặt lại nếu đang gõ. */
  readonly ownSelection: { readonly anchor: number; readonly head: number } | null;
  /** Tăng mỗi lần chữ đổi do người khác — mốc để đặt lại con trỏ. */
  readonly remoteRevision: number;
  readonly onEdit: (next: string, caret: number) => void;
  readonly onSelection: (anchor: number | null, head?: number) => void;
}

/**
 * Không đặt maxLength: phiên cho phép vượt tạm và báo "rút ngắn để lưu"; cắt
 * chữ ở ô nhập thì lần sửa kế tiếp phát lệnh xoá phần bị cắt cho cả phòng.
 *
 * Ô nội dung đồng soạn: <textarea> + lớp "soi gương" đè lên, cùng font/padding/
 * độ rộng, chứa đúng chữ (trong suốt) với vạch con trỏ của người khác chèn vào
 * đúng chỉ số — trình duyệt tự dàn dòng giống hệt textarea nên con trỏ đúng chỗ.
 * Ô tự cao theo chữ (không cuộn bên trong) để khỏi phải đồng bộ cuộn.
 */
export function CollabTextarea({
  label,
  value,
  disabled,
  overLimit,
  placeholder,
  hint,
  cursors,
  nameOf,
  ownSelection,
  remoteRevision,
  onEdit,
  onSelection,
}: CollabTextareaProps) {
  const id = useId();
  const area = useRef<HTMLTextAreaElement>(null);

  // Tự cao theo chữ.
  useLayoutEffect(() => {
    const element = area.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.max(element.scrollHeight, 256)}px`;
  }, [value]);

  // React đặt lại value khi chữ người khác về → trình duyệt nhảy con trỏ về cuối.
  // Đặt lại đúng chỗ (đã được dời theo phần người khác chèn) nếu mình đang gõ —
  // theo remoteRevision, kể cả khi họ gõ PHÍA SAU (vị trí đúng không đổi).
  const anchor = ownSelection?.anchor ?? null;
  const head = ownSelection?.head ?? null;
  useLayoutEffect(() => {
    const element = area.current;
    if (!element || remoteRevision === 0 || anchor === null || head === null) return;
    if (document.activeElement !== element) return;
    const start = Math.min(anchor, head);
    const end = Math.max(anchor, head);
    if (element.selectionStart !== start || element.selectionEnd !== end) {
      element.setSelectionRange(start, end);
    }
  }, [remoteRevision, anchor, head]);

  const visible = cursors
    .filter((cursor) => cursor.head !== null)
    .map((cursor) => ({ ...cursor, at: Math.min(cursor.head ?? 0, value.length) }))
    .sort((a, b) => a.at - b.at);

  const pieces: ReactNode[] = [];
  let from = 0;
  for (const cursor of visible) {
    pieces.push(value.slice(from, cursor.at));
    const color = CURSOR_BG[cursor.slot] ?? CURSOR_BG[0];
    pieces.push(
      <span key={cursor.key} className="relative">
        <span className={`absolute -top-0.5 bottom-0 -left-px w-0.5 ${color}`} />
        <span
          className={`absolute bottom-full left-0 -mb-0.5 whitespace-nowrap rounded-md rounded-bl-none px-1.5 py-0.5 text-xs font-semibold text-cursor-foreground ${color}`}>
          {nameOf(cursor.memberId)}
        </span>
      </span>,
    );
    from = cursor.at;
  }
  pieces.push(value.slice(from));

  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-foreground">
        {label}
      </label>
      <div className="relative">
        <textarea
          id={id}
          ref={area}
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(event) => onEdit(event.target.value, event.target.selectionEnd)}
          onSelect={(event) =>
            onSelection(event.currentTarget.selectionStart, event.currentTarget.selectionEnd)
          }
          onBlur={() => onSelection(null)}
          className={`${TEXT_LAYOUT} block resize-none overflow-hidden border-input bg-muted text-foreground placeholder:text-muted-foreground disabled:opacity-60`}
        />
        {/* Soi gương: chữ trong suốt, chỉ vạch con trỏ hiện. Ký tự rộng 0 cuối
            giữ dòng trống cuối cùng (chữ kết thúc bằng xuống dòng). */}
        <div
          aria-hidden
          className={`${TEXT_LAYOUT} pointer-events-none absolute inset-0 border-transparent text-transparent`}>
          {pieces}
          {'​'}
        </div>
      </div>
      {hint ? (
        <p className={`mt-1 text-right text-xs ${overLimit ? 'text-negative' : 'text-muted-foreground'}`}>{hint}</p>
      ) : null}
    </div>
  );
}
