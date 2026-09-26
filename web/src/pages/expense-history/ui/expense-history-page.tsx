import { useParams } from 'react-router';

import type { ExpenseSnapshot } from '@/entities/expense';
import { ACTION_LABEL, diffSnapshots, listExpenseEvents, UNKNOWN_ACTOR_NAME } from '@/entities/expense';
import { listTripMembers, memberLookup } from '@/entities/member';
import { useAsync } from '@/shared/lib/async';
import { routes } from '@/shared/config';
import { formatDateTime } from '@/shared/lib/datetime';
import { formatMoney } from '@/shared/lib/money';
import { AppHeader, Avatar, EmptyView, ErrorView, LoadingView, Screen } from '@/shared/ui';

function SnapshotSummary({
  snapshot,
  nameOf,
}: {
  readonly snapshot: ExpenseSnapshot;
  readonly nameOf: (memberId: string) => string;
}) {
  return (
    <div className="mt-2 flex flex-col gap-0.5 rounded-2xl bg-muted/60 p-3">
      <p className="text-sm text-foreground">
        “{snapshot.description}” · {formatMoney(snapshot.total)} · {nameOf(snapshot.paidByMemberId)} trả
      </p>
      <p className="text-xs leading-5 text-muted-foreground">
        {snapshot.shares.map((share) => `${nameOf(share.participantId)} ${formatMoney(share.amount)}`).join(' · ')}
      </p>
    </div>
  );
}

/** Nhật ký một khoản chi: ai, lúc nào, đổi gì (bám expense-history.tsx). */
export function ExpenseHistoryPage() {
  const { tripId = '', expenseId = '' } = useParams();
  const { data, error, loading, reload } = useAsync(async () => {
    const [events, members] = await Promise.all([listExpenseEvents(expenseId), listTripMembers(tripId)]);
    return { events, members };
  }, [tripId, expenseId]);

  const lookup = memberLookup(data?.members ?? [], 'Người đã rời');

  return (
    <Screen
      header={
        <AppHeader
          title="Lịch sử thay đổi"
          subtitle="Ai sửa gì, lúc nào"
          showBack
          backFallback={routes.expenseEdit(tripId, expenseId)}
        />
      }>
      {loading && data === null ? <LoadingView /> : null}
      {error ? <ErrorView message={error} onRetry={reload} /> : null}
      {data && data.events.length === 0 ? (
        <EmptyView
          title="Chưa có lịch sử"
          hint="Khoản chi tạo trước khi có tính năng này chưa được ghi lại. Mọi lần sửa từ giờ sẽ hiện ở đây."
        />
      ) : null}

      {data?.events.map((event) => {
        const actor = event.actorMemberId ? lookup.byId(event.actorMemberId) : undefined;
        // Web luôn đăng nhập: không tra được người thao tác = người đó đã rời chuyến.
        const actorName = actor?.displayName ?? UNKNOWN_ACTOR_NAME;
        const changes = event.before && event.after ? diffSnapshots(event.before, event.after, lookup.nameOf) : [];
        return (
          <article key={event.id} className="rounded-3xl border border-border bg-card p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <Avatar name={actorName} uri={actor?.avatarUrl} size="sm" pending={actor ? !actor.claimed : false} />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-foreground">
                  <span className="font-semibold">{actorName}</span> {ACTION_LABEL[event.action]}
                </p>
                <p className="text-xs text-muted-foreground">{formatDateTime(new Date(event.at))}</p>
              </div>
            </div>
            {event.action === 'update' && changes.length === 0 ? (
              <p className="mt-2 text-xs text-muted-foreground">Lưu lại, không đổi gì.</p>
            ) : null}
            {event.action === 'update'
              ? changes.map((change) => (
                  <div key={change.label} className="mt-2">
                    <p className="text-xs font-semibold text-muted-foreground">{change.label}</p>
                    <p className="text-sm text-foreground">
                      <span className="text-negative line-through">{change.before}</span>
                      {'  →  '}
                      <span className="font-semibold text-positive">{change.after}</span>
                    </p>
                  </div>
                ))
              : null}
            {event.action === 'create' && event.after ? <SnapshotSummary snapshot={event.after} nameOf={lookup.nameOf} /> : null}
            {event.action === 'void' && event.before ? <SnapshotSummary snapshot={event.before} nameOf={lookup.nameOf} /> : null}
          </article>
        );
      })}
    </Screen>
  );
}
