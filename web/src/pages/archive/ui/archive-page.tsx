import { ArchiveRestore, Square, SquareCheck } from 'lucide-react';
import { useMemo, useState } from 'react';

import {
  endedTrips,
  listArchivedTrips,
  listTrips,
  setTripArchived,
  splitByArchive,
  TripCard,
  tripListDateLabel,
} from '@/entities/trip';
import { describeError, useAsync } from '@/shared/lib/async';
import { toIsoDate } from '@/shared/lib/datetime';
import { routes } from '@/shared/config';
import {
  AppHeader,
  Button,
  EmptyView,
  ErrorView,
  LoadingView,
  Screen,
  SectionCard,
} from '@/shared/ui';

/**
 * Mục Lưu trữ — CỦA RIÊNG người đăng nhập (bản web của src/app/archive.tsx):
 * gợi ý chuyến đã kết thúc để lưu trữ hàng loạt, và danh sách đã lưu trữ.
 */
export function ArchivePage() {
  const { data, error, loading, reload } = useAsync(async () => {
    const [trips, archived] = await Promise.all([listTrips(), listArchivedTrips()]);
    return { trips, archived };
  }, []);

  const today = toIsoDate(new Date());
  const shelves = useMemo(() => {
    if (!data) return null;
    const { active, archived } = splitByArchive(data.trips, data.archived);
    return { ended: endedTrips(active, today), archived };
  }, [data, today]);

  // Bỏ chọn thay vì chọn: mặc định lưu trữ hết các chuyến đã kết thúc.
  const [unchecked, setUnchecked] = useState<ReadonlySet<string>>(new Set());
  const selected = shelves?.ended.filter((trip) => !unchecked.has(trip.id)) ?? [];
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const run = async (key: string, work: () => Promise<unknown>): Promise<void> => {
    setBusy(key);
    setActionError(null);
    try {
      await work();
    } catch (caught) {
      setActionError(describeError(caught));
    } finally {
      setBusy(null);
      // Tải lại cả khi lỗi giữa chừng: lưu trữ hàng loạt có thể đã xong một phần.
      reload();
    }
  };

  const toggle = (tripId: string): void =>
    setUnchecked((current) => {
      const next = new Set(current);
      if (next.has(tripId)) next.delete(tripId);
      else next.add(tripId);
      return next;
    });

  return (
    <Screen
      header={
        <AppHeader
          title="Lưu trữ"
          subtitle="Chỉ ẩn khỏi danh sách của bạn"
          showBack
          backFallback={routes.home()}
        />
      }>
      {loading && data === null ? <LoadingView /> : null}
      {error ? <ErrorView message={error} onRetry={reload} /> : null}
      {actionError ? <ErrorView message={actionError} /> : null}

      {shelves && shelves.ended.length > 0 ? (
        <SectionCard
          title="Đã kết thúc"
          hint="Chọn chuyến muốn lưu trữ. Người khác trong chuyến vẫn thấy bình thường.">
          <ul className="flex flex-col gap-1">
            {shelves.ended.map((trip) => {
              const checked = !unchecked.has(trip.id);
              return (
                <li key={trip.id}>
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={checked}
                    // Khoá khi đang lưu trữ: vòng lặp đã chụp danh sách lúc bấm.
                    disabled={busy !== null}
                    onClick={() => toggle(trip.id)}
                    className="flex min-h-14 w-full items-center gap-3 rounded-2xl px-2 py-2 text-left hover:bg-muted active:bg-muted disabled:opacity-60">
                    {checked ? (
                      <SquareCheck size={22} className="shrink-0 text-primary" aria-hidden />
                    ) : (
                      <Square size={22} className="shrink-0 text-muted-foreground" aria-hidden />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-base text-foreground">{trip.name}</span>
                      <span className="block text-xs text-muted-foreground">
                        {tripListDateLabel(trip.startDate, trip.endDate)}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <Button
            className="mt-4"
            label={
              selected.length > 0 ? `Lưu trữ ${selected.length} chuyến` : 'Chưa chọn chuyến nào'
            }
            disabled={selected.length === 0 || busy !== null}
            busy={busy === 'bulk'}
            onClick={() =>
              void run('bulk', async () => {
                // Tuần tự cho giống mobile (nhánh khách ở mobile không chịu được
                // ghi song song); ở đây vài chuyến nên không đáng tối ưu.
                for (const trip of selected) await setTripArchived(trip.id, true);
              })
            }
          />
        </SectionCard>
      ) : null}

      {shelves && shelves.archived.length === 0 && shelves.ended.length === 0 ? (
        <EmptyView
          title="Chưa lưu trữ chuyến nào"
          hint="Mở một chuyến rồi bấm Lưu trữ. Chuyến đã kết thúc sẽ được gợi ý ở đây."
        />
      ) : null}

      {shelves?.archived.map((trip) => (
        <div key={trip.id} className="flex flex-col gap-2">
          <TripCard trip={trip} to={routes.trip(trip.id)} />
          <button
            type="button"
            aria-label={`Bỏ lưu trữ ${trip.name}`}
            disabled={busy !== null}
            onClick={() =>
              void run(trip.id, async () => {
                await setTripArchived(trip.id, false);
                // Vừa cố ý đưa ra thì đừng để nó nằm sẵn trong ô "đã chọn" của
                // lưu trữ hàng loạt — bấm lưu trữ là bị cất lại ngay.
                setUnchecked((current) => new Set(current).add(trip.id));
              })
            }
            className="flex min-h-11 items-center gap-2 self-end rounded-full px-4 text-sm font-semibold text-muted-foreground hover:bg-muted active:bg-muted disabled:opacity-40">
            <ArchiveRestore size={16} aria-hidden />
            {busy === trip.id ? 'Đang bỏ lưu trữ…' : 'Bỏ lưu trữ'}
          </button>
        </div>
      ))}
    </Screen>
  );
}
