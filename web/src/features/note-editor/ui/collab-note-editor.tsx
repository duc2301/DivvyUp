import { Check, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import type { TripMember } from '@/entities/member';
import type { NotePreset, SessionSnapshot, TripNote } from '@/entities/note';
import { deleteTripNote, NOTE_BODY_MAX, useNoteCollab } from '@/entities/note';
import { describeError } from '@/shared/lib/async';
import {
  AppHeader,
  Avatar,
  ConfirmDialog,
  ErrorView,
  IconButton,
  LoadingView,
  NoticeView,
  Screen,
  TextField,
} from '@/shared/ui';

import { CollabTextarea } from './collab-textarea';

interface CollabNoteEditorProps {
  readonly tripId: string;
  readonly note: TripNote;
  readonly template: NotePreset;
  readonly members: readonly TripMember[];
  readonly myMemberId: string;
  /** Đóng trình soạn; changed = có thể đã đổi nội dung (tải lại danh sách). */
  readonly onClose: (changed: boolean) => void;
}

function saveLabel(snapshot: SessionSnapshot | null): string {
  if (!snapshot?.ready) return 'Đang kết nối…';
  switch (snapshot.saveState) {
    case 'pending':
    case 'saving':
      return 'Đang lưu…';
    case 'saved':
      return 'Đã lưu';
    case 'error':
      return 'Chưa lưu được';
    default:
      return snapshot.connection === 'solo' ? 'Đang sửa một mình' : 'Tự lưu khi bạn gõ';
  }
}

/**
 * Soạn ghi chú CÙNG LÚC với người khác (kiểu Google Docs) — bản web của
 * src/features/notes/collab-note-editor.tsx. Logic ở lõi dùng chung
 * (useNoteCollab); ở đây chỉ vẽ.
 */
export function CollabNoteEditor({ tripId, note, template, members, myMemberId, onClose }: CollabNoteEditorProps) {
  const { snapshot, session } = useNoteCollab({
    tripId,
    noteId: note.id,
    memberId: myMemberId,
    initial: { title: note.title, body: note.body, updatedAt: note.updatedAt },
  });
  const [closing, setClosing] = useState(false);
  // Đã thử thoát một lần mà chưa lưu được: lần bấm sau cho thoát luôn (phiên
  // chạy ngầm lưu tiếp) — không giữ người dùng kẹt ở màn soạn khi mất mạng.
  const [leaveArmed, setLeaveArmed] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Ẩn tab / chuyển app: lưu ngay — trình duyệt có thể dừng tab trước nhịp tự lưu.
  useEffect(() => {
    if (!session) return;
    const onHide = (): void => {
      if (document.visibilityState === 'hidden') void session.flush();
    };
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  }, [session]);

  // Còn phần chưa lưu mà đóng tab → trình duyệt hỏi lại.
  const unsaved = snapshot?.saveState === 'pending' || snapshot?.saveState === 'saving';
  useEffect(() => {
    if (!unsaved) return;
    const warn = (event: BeforeUnloadEvent): void => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unsaved]);

  // Ghi chú bị xoá / mất quyền: KHÔNG tự đóng — hiện lý do, khoá ô nhập, để
  // người dùng còn chép lại phần chưa lưu.
  const gone = snapshot?.gone ?? false;

  const nameOf = (memberId: string): string =>
    members.find((member) => member.id === memberId)?.displayName ?? 'Ai đó';

  const finish = async (): Promise<void> => {
    if (!session) {
      onClose(false);
      return;
    }
    setClosing(true);
    const clean = await session.flush();
    setClosing(false);
    // Còn chưa lưu được (mất mạng…): ở lại để người dùng thấy lỗi, không đóng
    // mất chữ. Ghi chú đã bị xoá thì đóng được.
    if (!clean && !session.getSnapshot().gone && !leaveArmed) {
      setLeaveArmed(true);
      return;
    }
    onClose(true);
  };

  const remove = async (): Promise<void> => {
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await deleteTripNote(note.id);
      setConfirmingDelete(false);
      onClose(true);
    } catch (caught) {
      setDeleteError(describeError(caught));
    } finally {
      setDeleteBusy(false);
    }
  };

  const ready = snapshot?.ready ?? false;
  const editable = ready && !gone;
  const title = snapshot?.title ?? note.title;
  const body = snapshot?.body ?? note.body;
  const peerMembers = [...new Set((snapshot?.peers ?? []).map((peer) => peer.memberId))].filter(
    (memberId) => memberId !== myMemberId,
  );

  return (
    <>
      <Screen
        header={
          <AppHeader
            title="Ghi chú"
            subtitle={`${template.emoji} ${template.label}`}
            showBack
            onBack={() => void finish()}
            right={
              <>
                <IconButton
                  icon={Trash2}
                  label="Xoá ghi chú"
                  variant="danger"
                  disabled={closing || gone}
                  onClick={() => setConfirmingDelete(true)}
                />
                <IconButton
                  icon={Check}
                  label="Xong, quay lại danh sách"
                  variant="primary"
                  busy={closing}
                  onClick={() => void finish()}
                />
              </>
            }
          />
        }>
        {peerMembers.length > 0 ? (
          <div
            aria-live="polite"
            className="flex items-center gap-2 rounded-2xl bg-muted/60 px-3 py-2">
            <div className="flex">
              {peerMembers.slice(0, 4).map((memberId, index) => (
                <span key={memberId} className={index === 0 ? '' : '-ml-2'}>
                  <Avatar
                    name={nameOf(memberId)}
                    uri={members.find((member) => member.id === memberId)?.avatarUrl}
                    size="sm"
                  />
                </span>
              ))}
            </div>
            <p className="min-w-0 flex-1 truncate text-sm text-foreground">
              {peerMembers.map(nameOf).join(', ')} đang cùng sửa
            </p>
          </div>
        ) : null}

        <p aria-live="polite" className="text-xs text-muted-foreground">
          {saveLabel(snapshot)}
        </p>
        {!ready && !gone ? <LoadingView label="Đang mở bản mới nhất…" /> : null}
        {snapshot?.notice ? <NoticeView message={snapshot.notice} /> : null}
        {snapshot?.saveState === 'error' && snapshot.saveError ? <ErrorView message={snapshot.saveError} /> : null}
        {leaveArmed && !gone ? <NoticeView message="Chưa lưu được. Bấm lần nữa để thoát — app sẽ tự lưu tiếp khi có mạng (để tab mở thêm một lúc)." /> : null}
        {snapshot?.connection === 'solo' && ready && !gone ? (
          <p className="text-xs text-muted-foreground">
            Chưa kết nối được để sửa cùng người khác — vẫn tự lưu bình thường.
          </p>
        ) : null}

        <TextField
          label="Tiêu đề"
          value={title}
          disabled={!editable}
          onChange={(event) => session?.editTitle(event.target.value, event.target.selectionEnd ?? undefined)}
          placeholder={template.label}
        />
        <CollabTextarea
          label="Nội dung"
          value={body}
          disabled={!editable}
          placeholder="Viết gì đó cho cả nhóm…"
          hint={`${body.length}/${NOTE_BODY_MAX}`}
          cursors={snapshot?.cursors ?? []}
          nameOf={nameOf}
          ownSelection={snapshot?.ownSelection ?? null}
          remoteRevision={snapshot?.remoteRevision ?? 0}
          overLimit={body.length > NOTE_BODY_MAX}
          onEdit={(next, caret) => session?.editBody(next, caret)}
          onSelection={(anchor, head) => session?.setBodySelection(anchor, head)}
        />
      </Screen>

      <ConfirmDialog
        open={confirmingDelete}
        title={deleteError ? 'Chưa xoá được' : 'Xoá ghi chú?'}
        message={
          deleteError ??
          `“${title.trim() || template.label}” sẽ bị xoá khỏi chuyến đi với cả nhóm, kể cả người đang cùng sửa.`
        }
        confirmLabel="Xoá"
        destructive
        busy={deleteBusy}
        onConfirm={() => void remove()}
        onCancel={() => setConfirmingDelete(false)}
      />
    </>
  );
}
