import { formatRelativeDateTime } from '@/shared/lib/datetime';

import type { TripNote } from '../api';
import { presetOf } from '../api';

interface NoteCardProps {
  readonly note: TripNote;
  /** Tên người sửa cuối, null nếu không xác định. */
  readonly editorName: string | null;
  readonly onOpen: () => void;
}

export function NoteCard({ note, editorName, onOpen }: NoteCardProps) {
  const template = presetOf(note.template);
  return (
    <button
      type="button"
      aria-label={`Mở ghi chú ${note.title}`}
      onClick={onOpen}
      className="w-full rounded-3xl border border-border bg-card p-5 text-left shadow-sm hover:bg-muted/40 active:bg-muted">
      <span className="flex items-center gap-2">
        <span aria-hidden className="text-lg">
          {template.emoji}
        </span>
        <span className="min-w-0 flex-1 truncate text-base font-semibold text-foreground">
          {note.title}
        </span>
      </span>
      {note.body.trim() !== '' ? (
        <span className="mt-2 line-clamp-4 whitespace-pre-line text-sm leading-5 text-muted-foreground">
          {note.body}
        </span>
      ) : null}
      <span className="mt-2 block text-xs text-muted-foreground">
        Sửa {formatRelativeDateTime(new Date(note.updatedAt))}
        {editorName ? ` · ${editorName}` : ''}
      </span>
    </button>
  );
}
