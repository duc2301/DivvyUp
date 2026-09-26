import { useLocalSearchParams, useNavigation } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { AppHeader } from '@/components/ui/app-header';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { IconButton } from '@/components/ui/icon-button';
import { Check, Trash2 } from '@/components/ui/icons';
import { Screen } from '@/components/ui/screen';
import { SectionCard } from '@/components/ui/section-card';
import { EmptyView, ErrorView, LoadingView } from '@/components/ui/state-views';
import { TextField } from '@/components/ui/text-field';
import {
  createTripNote,
  deleteTripNote,
  listTripMembers,
  listTripNotes,
  updateTripNote,
} from '@/lib/data/manager';
import type { TripNote } from '@/lib/data/notes';
import { NOTE_BODY_MAX, NOTE_STALE_MESSAGE, NOTE_TITLE_MAX } from '@/lib/data/notes';
import { DataError } from '@/lib/supabase/errors';
import { describeError, useAsync } from '@/lib/data/use-async';
import { formatRelativeDateTime } from '@/lib/datetime';
import type { NotePreset } from '@/lib/notes/templates';
import { NOTE_PRESETS, presetOf } from '@/lib/notes/templates';

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Đang soạn: ghi chú mới (id null) từ một mẫu, hoặc ghi chú có sẵn. */
interface Draft {
  readonly id: string | null;
  /** updated_at lúc mở — lưu đè chỉ khi chưa ai sửa ghi chú trong lúc mình soạn. */
  readonly loadedAt: string | null;
  readonly template: NotePreset;
  readonly title: string;
  readonly body: string;
}

/**
 * Ghi chú chuyến đi: kế hoạch, lưu ý, miêu tả… Ai trong chuyến cũng thêm và sửa
 * được. Tạo mới thì chọn một mẫu (hoặc trống), mẫu chỉ là nội dung gợi ý ban
 * đầu — sửa thoải mái.
 */
export default function TripNotesScreen() {
  const params = useLocalSearchParams<{ tripId?: string | string[] }>();
  const tripId = firstParam(params.tripId);

  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // Đang soạn mà NGƯỜI DÙNG lùi (Back cứng Android, vuốt lùi iOS): quay về
  // danh sách ghi chú thay vì rời màn và mất sạch nội dung vừa gõ. Chuyển màn
  // do app chủ động (ví dụ phiên hết hạn → màn đăng nhập) thì cho đi tiếp,
  // không được giữ người dùng kẹt lại ở đây.
  const navigation = useNavigation();
  usePreventRemove(draft !== null, ({ data: event }) => {
    setDraft(null);
    if (event.action.type !== 'GO_BACK' && event.action.type !== 'POP') {
      navigation.dispatch(event.action);
    }
  });

  const { data, error, loading, reload } = useAsync(async () => {
    if (!tripId) throw new Error('Thiếu mã chuyến đi.');
    const [notes, members] = await Promise.all([listTripNotes(tripId), listTripMembers(tripId)]);
    return { notes, members };
  }, [tripId]);

  const nameOf = (memberId: string | null): string | null =>
    memberId ? (data?.members.find((member) => member.id === memberId)?.displayName ?? null) : null;

  const startNew = (template: NotePreset): void => {
    setActionError(null);
    setDraft({ id: null, loadedAt: null, template, title: template.title, body: template.body });
  };

  const openNote = (note: TripNote): void => {
    setActionError(null);
    setDraft({
      id: note.id,
      loadedAt: note.updatedAt,
      template: presetOf(note.template),
      title: note.title,
      body: note.body,
    });
  };

  const save = async (): Promise<void> => {
    if (!draft || !tripId) return;
    const title = draft.title.trim() || draft.template.label;
    setBusy(true);
    setActionError(null);
    try {
      if (draft.id === null) {
        await createTripNote(tripId, { title, body: draft.body, template: draft.template.key });
      } else {
        await updateTripNote(draft.id, { title, body: draft.body }, draft.loadedAt ?? '');
      }
      setDraft(null);
      reload();
    } catch (caught) {
      if (caught instanceof DataError && caught.message === NOTE_STALE_MESSAGE && draft.id) {
        // Người khác vừa sửa. GIỮ nguyên bản nháp (không bắt người dùng Huỷ rồi
        // gõ lại), và nhận mốc sửa mới nhất để lần Lưu kế tiếp là quyết định có ý thức.
        const fresh = (await listTripNotes(tripId).catch(() => [])).find(
          (note) => note.id === draft.id,
        );
        if (fresh) {
          setDraft({ ...draft, loadedAt: fresh.updatedAt });
          setActionError(
            'Người khác vừa sửa ghi chú này. Nội dung bạn đang gõ vẫn còn nguyên — bấm ✓ lần nữa để lưu đè bản của họ, hoặc Huỷ để xem bản mới.',
          );
          return;
        }
      }
      setActionError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (): Promise<void> => {
    if (!draft?.id) return;
    setBusy(true);
    setActionError(null);
    try {
      await deleteTripNote(draft.id);
      setConfirmingDelete(false);
      setDraft(null);
      reload();
    } catch (caught) {
      setConfirmingDelete(false);
      setActionError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  if (draft) {
    return (
      <>
        <Screen
          header={
            <AppHeader
              title={draft.id === null ? 'Ghi chú mới' : 'Sửa ghi chú'}
              subtitle={`${draft.template.emoji} ${draft.template.label}`}
              showBack={false}
              right={
                <View className="flex-row items-center gap-1">
                  {draft.id !== null ? (
                    <IconButton
                      icon={Trash2}
                      label="Xoá ghi chú"
                      variant="danger"
                      disabled={busy}
                      onPress={() => setConfirmingDelete(true)}
                    />
                  ) : null}
                  <IconButton
                    icon={Check}
                    label="Lưu ghi chú"
                    variant="primary"
                    busy={busy && !confirmingDelete}
                    onPress={() => void save()}
                  />
                </View>
              }
            />
          }>
          {actionError ? <ErrorView message={actionError} /> : null}
          <TextField
            label="Tiêu đề"
            value={draft.title}
            maxLength={NOTE_TITLE_MAX}
            onChangeText={(title) => setDraft({ ...draft, title })}
            placeholder={draft.template.label}
            autoCapitalize="sentences"
          />
          <View>
            <Text className="mb-1 text-sm font-medium text-foreground">Nội dung</Text>
            <TextInput
              value={draft.body}
              maxLength={NOTE_BODY_MAX}
              onChangeText={(body) => setDraft({ ...draft, body })}
              multiline
              textAlignVertical="top"
              placeholder="Viết gì đó cho cả nhóm…"
              accessibilityLabel="Nội dung ghi chú"
              className="min-h-64 min-w-0 rounded-xl border border-input bg-muted p-3 text-base leading-6 text-foreground"
            />
            <Text className="mt-1 text-right text-xs text-muted-foreground">
              {draft.body.length}/{NOTE_BODY_MAX}
            </Text>
          </View>
          <Button label="Huỷ, quay lại danh sách" variant="ghost" onPress={() => setDraft(null)} />
        </Screen>

        <ConfirmDialog
          visible={confirmingDelete}
          title="Xoá ghi chú?"
          message={`“${draft.title.trim() || draft.template.label}” sẽ bị xoá khỏi chuyến đi với cả nhóm.`}
          confirmLabel="Xoá"
          destructive
          busy={busy}
          onConfirm={() => void remove()}
          onCancel={() => setConfirmingDelete(false)}
        />
      </>
    );
  }

  return (
    <Screen header={<AppHeader title="Ghi chú" subtitle="Cả nhóm cùng xem và sửa" showBack />}>
      {loading && data === null ? <LoadingView /> : null}
      {error ? <ErrorView message={error} onRetry={reload} /> : null}
      {actionError ? <ErrorView message={actionError} /> : null}

      <SectionCard title="Thêm ghi chú" hint="Chọn một mẫu gợi ý, hoặc bắt đầu từ trang trống.">
        <View className="flex-row flex-wrap gap-2">
          {NOTE_PRESETS.map((template) => (
            <Pressable
              key={template.label}
              accessibilityRole="button"
              accessibilityLabel={`Tạo ghi chú: ${template.label}`}
              onPress={() => startNew(template)}
              className="min-h-11 flex-row items-center gap-2 rounded-full border border-border bg-card px-4 active:bg-muted">
              <Text className="text-base">{template.emoji}</Text>
              <Text className="text-sm font-medium text-foreground">{template.label}</Text>
            </Pressable>
          ))}
        </View>
      </SectionCard>

      {data && data.notes.length === 0 ? (
        <EmptyView
          title="Chưa có ghi chú nào"
          hint="Ghi kế hoạch từng ngày, đồ cần mang, giờ tập trung… để cả nhóm cùng xem."
        />
      ) : null}

      {data?.notes.map((note) => {
        const template = presetOf(note.template);
        const editor = nameOf(note.updatedByMemberId);
        return (
          <Pressable
            key={note.id}
            accessibilityRole="button"
            accessibilityLabel={`Mở ghi chú ${note.title}`}
            onPress={() => openNote(note)}
            className="rounded-3xl border border-border bg-card p-5 active:bg-muted">
            <View className="flex-row items-center gap-2">
              <Text className="text-lg">{template.emoji}</Text>
              <Text
                numberOfLines={1}
                className="min-w-0 flex-1 text-base font-semibold text-foreground">
                {note.title}
              </Text>
            </View>
            {note.body.trim() !== '' ? (
              <Text numberOfLines={4} className="mt-2 text-sm leading-5 text-muted-foreground">
                {note.body}
              </Text>
            ) : null}
            <Text className="mt-2 text-xs text-muted-foreground">
              Sửa {formatRelativeDateTime(new Date(note.updatedAt))}
              {editor ? ` · ${editor}` : ''}
            </Text>
          </Pressable>
        );
      })}
    </Screen>
  );
}
