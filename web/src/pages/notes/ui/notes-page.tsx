import { useState } from 'react';
import { useParams } from 'react-router';

import { listTripMembers, memberLookup } from '@/entities/member';
import { listTripNotes, NOTE_PRESETS, NoteCard } from '@/entities/note';
import type { NoteDraftSource } from '@/features/note-editor';
import { NoteEditor } from '@/features/note-editor';
import { useAsync } from '@/shared/lib/async';
import { routes } from '@/shared/config';
import { AppHeader, EmptyView, ErrorView, LoadingView, Screen, SectionCard } from '@/shared/ui';

/** Ghi chú chuyến đi: chọn mẫu để tạo, chạm để sửa (bám notes.tsx). */
export function NotesPage() {
  const { tripId = '' } = useParams();
  const [draft, setDraft] = useState<NoteDraftSource | null>(null);

  const { data, error, loading, reload } = useAsync(async () => {
    const [notes, members] = await Promise.all([listTripNotes(tripId), listTripMembers(tripId)]);
    return { notes, members };
  }, [tripId]);

  if (draft) {
    return (
      <NoteEditor
        tripId={tripId}
        source={draft}
        onClose={(changed) => {
          setDraft(null);
          if (changed) reload();
        }}
      />
    );
  }

  const lookup = memberLookup(data?.members ?? []);

  return (
    <Screen
      header={<AppHeader title="Ghi chú" subtitle="Cả nhóm cùng xem và sửa" showBack backFallback={routes.trip(tripId)} />}>
      {loading && data === null ? <LoadingView /> : null}
      {error ? <ErrorView message={error} onRetry={reload} /> : null}

      <SectionCard title="Thêm ghi chú" hint="Chọn một mẫu gợi ý, hoặc bắt đầu từ trang trống.">
        <div className="flex flex-wrap gap-2">
          {NOTE_PRESETS.map((template) => (
            <button
              key={template.label}
              type="button"
              aria-label={`Tạo ghi chú: ${template.label}`}
              onClick={() => setDraft({ kind: 'new', template })}
              className="flex min-h-11 items-center gap-2 rounded-full border border-border bg-card px-4 text-sm font-medium text-foreground hover:bg-muted/60 active:bg-muted">
              <span aria-hidden className="text-base">
                {template.emoji}
              </span>
              {template.label}
            </button>
          ))}
        </div>
      </SectionCard>

      {data && data.notes.length === 0 ? (
        <EmptyView
          title="Chưa có ghi chú nào"
          hint="Ghi kế hoạch từng ngày, đồ cần mang, giờ tập trung… để cả nhóm cùng xem."
        />
      ) : null}

      {data?.notes.map((note) => (
        <NoteCard
          key={note.id}
          note={note}
          editorName={note.updatedByMemberId ? (lookup.byId(note.updatedByMemberId)?.displayName ?? null) : null}
          onOpen={() => setDraft({ kind: 'existing', note })}
        />
      ))}
    </Screen>
  );
}
