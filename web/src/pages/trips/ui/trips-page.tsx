import { Archive, ChevronRight } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';

import {
  dismissReminder,
  endedTrips,
  isTripEnded,
  listArchivedTrips,
  listTrips,
  shouldRemindArchive,
  splitByArchive,
  TripCard,
} from '@/entities/trip';
import { useSession } from '@/entities/session';
import {
  ArchiveReminder,
  loadDismissedReminders,
  saveDismissedReminders,
} from '@/features/archive-trip';
import { describeError, useAsync } from '@/shared/lib/async';
import { toIsoDate } from '@/shared/lib/datetime';
import { routes } from '@/shared/config';
import { EmptyView, ErrorView, LoadingView, Screen } from '@/shared/ui';
import { HomeHeader } from '@/widgets/app-header';

export function TripsPage() {
  const navigate = useNavigate();
  const { data, error, loading, reload } = useAsync(async () => {
    const [trips, archive] = await Promise.all([
      listTrips(),
      // Không tải được danh sách lưu trữ thì vẫn hiện đủ chuyến đi — kèm dòng
      // báo lỗi, không nuốt im.
      listArchivedTrips().then(
        (archived) => ({ archived, error: null }),
        (caught: unknown) => ({
          archived: new Map<string, string>(),
          error: describeError(caught),
        }),
      ),
    ]);
    return { trips, archived: archive.archived, archiveError: archive.error };
  }, []);

  // Trang nằm sau RequireAuth nên luôn có userId; '' chỉ để kiểu dữ liệu đủ.
  const { userId } = useSession();
  const reminderScope = userId ?? '';
  const [dismissed, setDismissed] = useState(() => loadDismissedReminders(reminderScope));
  const today = toIsoDate(new Date());
  const view = useMemo(() => {
    if (!data) return null;
    const { active, archived } = splitByArchive(data.trips, data.archived);
    const ended = endedTrips(active, today);
    return {
      active,
      archivedCount: archived.length,
      ended,
      remind: shouldRemindArchive(ended, dismissed),
    };
  }, [data, today, dismissed]);

  const dismiss = (): void => {
    if (!data || !view) return;
    const next = dismissReminder(dismissed, view.ended, new Set(data.trips.map((trip) => trip.id)));
    // Không lưu được (trình duyệt chặn lưu trữ) thì banner chỉ hiện lại lần sau.
    saveDismissedReminders(reminderScope, next);
    setDismissed(new Set(next));
  };

  const trips = data?.trips ?? null;

  return (
    <Screen header={<HomeHeader />}>
      {loading && data === null ? <LoadingView /> : null}
      {error ? <ErrorView message={error} onRetry={reload} /> : null}
      {trips !== null && trips.length === 0 && !error ? (
        <EmptyView
          title="Chưa có chuyến đi nào"
          hint="Bấm ＋ để tạo chuyến đầu tiên, hoặc 🔑 để tham gia chuyến của bạn bè bằng mã mời."
          actionLabel="Tạo chuyến đi"
          onAction={() => void navigate(routes.tripNew())}
        />
      ) : null}
      {view && trips && trips.length > 0 && view.active.length === 0 ? (
        <EmptyView
          title="Mọi chuyến đi đã lưu trữ"
          hint="Mở mục Lưu trữ bên dưới để xem lại, hoặc bấm ＋ để tạo chuyến mới."
        />
      ) : null}
      {view?.remind ? (
        <ArchiveReminder
          count={view.ended.length}
          archiveHref={routes.archive()}
          onDismiss={dismiss}
        />
      ) : null}
      {view?.active.map((trip) => (
        <TripCard
          key={trip.id}
          trip={trip}
          to={routes.trip(trip.id)}
          ended={isTripEnded(trip, today)}
        />
      ))}
      {data?.archiveError ? (
        <p className="text-center text-xs text-negative">
          Không tải được mục Lưu trữ: {data.archiveError}
        </p>
      ) : null}
      {view && (view.archivedCount > 0 || view.ended.length > 0) ? (
        <Link
          to={routes.archive()}
          aria-label={`Mở mục Lưu trữ, ${view.archivedCount} chuyến đã lưu trữ${
            view.ended.length > 0 ? `, ${view.ended.length} chuyến đã kết thúc gợi ý lưu trữ` : ''
          }`}
          className="flex min-h-14 items-center gap-3 rounded-3xl border border-border bg-card px-5 py-4 hover:bg-muted active:bg-muted">
          <Archive size={20} className="text-muted-foreground" aria-hidden />
          <span className="min-w-0 flex-1 text-base text-foreground">Lưu trữ</span>
          <span className="text-sm text-muted-foreground">{view.archivedCount}</span>
          <ChevronRight size={18} className="text-muted-foreground" aria-hidden />
        </Link>
      ) : null}
    </Screen>
  );
}
