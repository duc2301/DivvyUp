import { Check, Trash2 } from 'lucide-react';
import { useState } from 'react';

import type { NotePreset, TripNote } from '@/entities/note';
import {
  createTripNote,
  deleteTripNote,
  listTripNotes,
  NOTE_BODY_MAX,
  NOTE_STALE_MESSAGE,
  NOTE_TITLE_MAX,
  presetOf,
  updateTripNote,
} from '@/entities/note';
import { DataError, describeError } from '@/shared/lib/async';
import { AppHeader, Button, ConfirmDialog, ErrorView, IconButton, Screen, TextArea, TextField } from '@/shared/ui';

/** Ghi chú đang soạn: mới từ một mẫu, hoặc ghi chú có sẵn. */
export type NoteDraftSource =
  | { readonly kind: 'new'; readonly template: NotePreset }
  | { readonly kind: 'existing'; readonly note: TripNote };

interface NoteEditorProps {
  readonly tripId: string;
  readonly source: NoteDraftSource;
  /** Lưu/xoá xong, hoặc huỷ. */
  readonly onClose: (changed: boolean) => void;
}

export function NoteEditor({ tripId, source, onClose }: NoteEditorProps) {
  const template = source.kind === 'new' ? source.template : presetOf(source.note.template);
  const noteId = source.kind === 'existing' ? source.note.id : null;

  const [title, setTitle] = useState(source.kind === 'new' ? template.title : source.note.title);
  const [body, setBody] = useState(source.kind === 'new' ? template.body : source.note.body);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // updatedAt LÚC MỞ — nguyên chuỗi từ máy chủ, không qua Date (mất micro giây
  // là không khớp). Người khác sửa trong lúc đó thì máy chủ từ chối lưu.
  const [loadedAt, setLoadedAt] = useState(source.kind === 'existing' ? source.note.updatedAt : '');

  const save = async (): Promise<void> => {
    if (busy) return;
    const finalTitle = title.trim() || template.label;
    setBusy(true);
    setError(null);
    try {
      if (noteId === null) {
        await createTripNote(tripId, { title: finalTitle, body, template: template.key });
      } else {
        await updateTripNote(noteId, { title: finalTitle, body }, loadedAt);
      }
      onClose(true);
    } catch (caught) {
      if (caught instanceof DataError && caught.message === NOTE_STALE_MESSAGE && noteId !== null) {
        // Người khác vừa sửa: GIỮ nguyên bản nháp và nhận mốc sửa mới nhất, để
        // lần Lưu kế tiếp là quyết định ghi đè có ý thức (giống notes.tsx).
        const fresh = (await listTripNotes(tripId).catch(() => [])).find((note) => note.id === noteId);
        if (fresh) {
          setLoadedAt(fresh.updatedAt);
          setError(
            'Người khác vừa sửa ghi chú này. Nội dung bạn đang gõ vẫn còn nguyên — bấm ✓ lần nữa để lưu đè bản của họ, hoặc Huỷ để xem bản mới.',
          );
          return;
        }
      }
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (): Promise<void> => {
    if (!noteId) return;
    setBusy(true);
    setError(null);
    try {
      await deleteTripNote(noteId);
      setConfirmingDelete(false);
      onClose(true);
    } catch (caught) {
      setConfirmingDelete(false);
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Screen
        header={
          <AppHeader
            title={noteId === null ? 'Ghi chú mới' : 'Sửa ghi chú'}
            subtitle={`${template.emoji} ${template.label}`}
            showBack
            onBack={() => onClose(false)}
            right={
              <>
                {noteId !== null ? (
                  <IconButton
                    icon={Trash2}
                    label="Xoá ghi chú"
                    variant="danger"
                    disabled={busy}
                    onClick={() => setConfirmingDelete(true)}
                  />
                ) : null}
                <IconButton
                  icon={Check}
                  label="Lưu ghi chú"
                  variant="primary"
                  busy={busy && !confirmingDelete}
                  onClick={() => void save()}
                />
              </>
            }
          />
        }>
        {error ? <ErrorView message={error} /> : null}
        <TextField
          label="Tiêu đề"
          value={title}
          maxLength={NOTE_TITLE_MAX}
          onChange={(event) => setTitle(event.target.value)}
          placeholder={template.label}
        />
        <TextArea
          label="Nội dung"
          value={body}
          maxLength={NOTE_BODY_MAX}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Viết gì đó cho cả nhóm…"
          hint={`${body.length}/${NOTE_BODY_MAX}`}
        />
        <Button label="Lưu ghi chú" busy={busy && !confirmingDelete} onClick={() => void save()} />
        <Button label="Huỷ, quay lại danh sách" variant="ghost" onClick={() => onClose(false)} />
      </Screen>

      <ConfirmDialog
        open={confirmingDelete}
        title="Xoá ghi chú?"
        message={`“${title.trim() || template.label}” sẽ bị xoá khỏi chuyến đi với cả nhóm.`}
        confirmLabel="Xoá"
        destructive
        busy={busy}
        onConfirm={() => void remove()}
        onCancel={() => setConfirmingDelete(false)}
      />
    </>
  );
}
