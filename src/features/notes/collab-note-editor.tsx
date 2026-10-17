import { useNavigation } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AppState, Text, TextInput, View } from 'react-native';

import { AppHeader } from '@/components/ui/app-header';
import { Avatar } from '@/components/ui/avatar';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { IconButton } from '@/components/ui/icon-button';
import { Check, Trash2 } from '@/components/ui/icons';
import { Screen } from '@/components/ui/screen';
import { ErrorView, LoadingView, NoticeView } from '@/components/ui/state-views';
import { deleteTripNote } from '@/lib/data/manager';
import type { TripMember } from '@/lib/data/trips';
import type { TripNote } from '@/lib/data/notes';
import { describeError } from '@/lib/data/use-async';
import type { SessionSnapshot } from '@/lib/notes/collab-session';
import { NOTE_BODY_MAX } from '@/lib/notes/note-rules';
import type { NotePreset } from '@/lib/notes/templates';
import { useNoteCollab } from '@/lib/notes/use-note-collab';

import { RemoteCursors } from './remote-cursors';

/** Lớp chữ của ô nội dung — lớp phủ con trỏ PHẢI dùng đúng lớp này để đo trùng. */
const BODY_TEXT = 'text-base leading-6';
/** p-3 (12) + viền 1. */
const BODY_INSET = 13;

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
 * Soạn ghi chú CÙNG LÚC với người khác (kiểu Google Docs): chữ đồng bộ theo từng
 * phím, thấy con trỏ + tên người khác, tự lưu. Không có "Huỷ thay đổi" — chữ đã
 * gõ người khác đã thấy, không thu hồi được. Chỉ dùng khi đã đăng nhập.
 *
 * Ô nhập KHÔNG đặt maxLength: phiên cho phép vượt tạm (hai người cùng gõ gần
 * giới hạn) và báo "rút ngắn để lưu"; maxLength trên Android cắt chữ hiển thị,
 * lần sửa kế tiếp sẽ phát lệnh xoá phần bị cắt cho cả phòng.
 */
export function CollabNoteEditor({ tripId, note, template, members, myMemberId, onClose }: CollabNoteEditorProps) {
  const { snapshot, session } = useNoteCollab({
    tripId,
    noteId: note.id,
    memberId: myMemberId,
    initial: { title: note.title, body: note.body, updatedAt: note.updatedAt },
  });
  const bodyInput = useRef<TextInput>(null);
  const [bodyWidth, setBodyWidth] = useState(0);
  const [closing, setClosing] = useState(false);
  // Đã thử thoát một lần mà chưa lưu được: lần bấm sau cho thoát luôn (phiên
  // chạy ngầm lưu tiếp) — không giữ người dùng kẹt ở màn soạn khi mất mạng.
  const [leaveArmed, setLeaveArmed] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Chữ đổi do người khác → đặt lại con trỏ của mình (đã được dời theo phần họ
  // chèn phía trước). Theo remoteRevision chứ không theo vị trí: họ gõ PHÍA SAU
  // thì vị trí đúng không đổi, nhưng iOS vẫn tự dời con trỏ khi chữ bị thay.
  const remoteRevision = snapshot?.remoteRevision ?? 0;
  const ownAnchor = snapshot?.ownSelection?.anchor ?? null;
  const ownHead = snapshot?.ownSelection?.head ?? null;
  useLayoutEffect(() => {
    if (remoteRevision === 0 || ownAnchor === null || ownHead === null) return;
    const input = bodyInput.current;
    if (!input?.isFocused()) return;
    input.setSelection(Math.min(ownAnchor, ownHead), Math.max(ownAnchor, ownHead));
  }, [remoteRevision, ownAnchor, ownHead]);

  // App xuống nền: lưu ngay — hệ điều hành có thể dừng app trước nhịp tự lưu.
  useEffect(() => {
    if (!session) return;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') void session.flush();
    });
    return () => subscription.remove();
  }, [session]);

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
    // Còn chưa lưu được (mất mạng…): lần đầu ở lại để người dùng thấy lỗi; lần
    // sau cho thoát — hook thả phiên (release), phiên thử lưu tiếp ở nền. Ghi
    // chú đã bị xoá thì đóng luôn — không còn gì để lưu vào.
    if (!clean && !session.getSnapshot().gone && !leaveArmed) {
      setLeaveArmed(true);
      return;
    }
    onClose(true);
  };

  // Back cứng Android / vuốt lùi iOS: lưu xong rồi mới về danh sách — danh sách
  // tải lại SAU khi lưu, không hiện bản cũ. Điều hướng do app chủ động (phiên hết
  // hạn → đăng nhập) thì cho đi tiếp; phiên chạy ngầm lưu nốt (release).
  const navigation = useNavigation();
  usePreventRemove(true, ({ data: event }) => {
    if (event.action.type !== 'GO_BACK' && event.action.type !== 'POP') {
      onClose(true);
      navigation.dispatch(event.action);
      return;
    }
    void finish();
  });

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
  const gone = snapshot?.gone ?? false;
  const editable = ready && !gone;
  const title = snapshot?.title ?? note.title;
  const body = snapshot?.body ?? note.body;
  // Mỗi người một dòng dù mở hai máy.
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
            showBack={false}
            right={
              <View className="flex-row items-center gap-1">
                <IconButton
                  icon={Trash2}
                  label="Xoá ghi chú"
                  variant="danger"
                  disabled={closing || gone}
                  onPress={() => setConfirmingDelete(true)}
                />
                <IconButton
                  icon={Check}
                  label="Xong, quay lại danh sách"
                  variant="primary"
                  busy={closing}
                  onPress={() => void finish()}
                />
              </View>
            }
          />
        }>
        {/* Trạng thái lưu có live region riêng: người dùng trình đọc màn hình
            nghe được "Chưa lưu được" thay vì không hay biết. */}
        <Text accessibilityLiveRegion="polite" className="text-xs text-muted-foreground">
          {saveLabel(snapshot)}
        </Text>

        {peerMembers.length > 0 ? (
          <View
            accessible
            accessibilityLiveRegion="polite"
            accessibilityLabel={`Đang cùng sửa: ${peerMembers.map(nameOf).join(', ')}`}
            className="flex-row items-center gap-2 rounded-2xl bg-muted/60 px-3 py-2">
            <View className="flex-row">
              {peerMembers.slice(0, 4).map((memberId, index) => {
                const member = members.find((item) => item.id === memberId);
                return (
                  <View key={memberId} className={index === 0 ? '' : '-ml-2'}>
                    <Avatar name={nameOf(memberId)} uri={member?.avatarUrl} size="sm" />
                  </View>
                );
              })}
            </View>
            <Text numberOfLines={1} className="min-w-0 flex-1 text-sm text-foreground">
              {peerMembers.map(nameOf).join(', ')} đang cùng sửa
            </Text>
          </View>
        ) : null}

        {!ready && !gone ? <LoadingView label="Đang mở bản mới nhất…" /> : null}
        {snapshot?.notice ? <NoticeView tone="info" message={snapshot.notice} /> : null}
        {snapshot?.saveState === 'error' && snapshot.saveError ? (
          <ErrorView message={snapshot.saveError} />
        ) : null}
        {leaveArmed && !(snapshot?.gone ?? false) ? (
          <NoticeView tone="info" message="Chưa lưu được. Bấm lần nữa để thoát — app sẽ tự lưu tiếp khi có mạng (giữ app mở thêm một lúc)." />
        ) : null}
        {snapshot?.connection === 'solo' && ready && !gone ? (
          <Text className="text-xs text-muted-foreground">
            Chưa kết nối được để sửa cùng người khác — vẫn tự lưu bình thường.
          </Text>
        ) : null}

        <View>
          <Text className="mb-1 text-sm font-medium text-foreground">Tiêu đề</Text>
          <TextInput
            value={title}
            editable={editable}
            onChangeText={(next) => session?.editTitle(next)}
            placeholder={template.label}
            autoCapitalize="sentences"
            accessibilityLabel="Tiêu đề ghi chú"
            className="min-h-12 min-w-0 rounded-xl border border-input bg-muted px-3 text-base text-foreground"
          />
        </View>

        <View>
          <Text className="mb-1 text-sm font-medium text-foreground">Nội dung</Text>
          <View
            onLayout={(event) => setBodyWidth(event.nativeEvent.layout.width - BODY_INSET * 2)}
            className="relative">
            <TextInput
              ref={bodyInput}
              value={body}
              editable={editable}
              multiline
              // Ô tự cao theo chữ, không cuộn bên trong: toạ độ con trỏ người khác
              // đo theo chữ mới khớp; cả màn cuộn bằng ScrollView của Screen.
              scrollEnabled={false}
              textAlignVertical="top"
              onChangeText={(next) => session?.editBody(next)}
              onSelectionChange={(event) => {
                const { start, end } = event.nativeEvent.selection;
                session?.setBodySelection(start, end);
              }}
              onBlur={() => session?.setBodySelection(null)}
              placeholder="Viết gì đó cho cả nhóm…"
              accessibilityLabel="Nội dung ghi chú"
              className={`min-h-64 min-w-0 rounded-xl border border-input bg-muted p-3 text-foreground ${BODY_TEXT}`}
            />
            <RemoteCursors
              body={body}
              cursors={snapshot?.cursors ?? []}
              nameOf={nameOf}
              textWidth={bodyWidth}
              textClassName={BODY_TEXT}
              inset={BODY_INSET}
            />
          </View>
          <Text
            className={`mt-1 text-right text-xs ${
              body.length > NOTE_BODY_MAX ? 'text-negative' : 'text-muted-foreground'
            }`}>
            {body.length}/{NOTE_BODY_MAX}
          </Text>
        </View>
      </Screen>

      <ConfirmDialog
        visible={confirmingDelete}
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
