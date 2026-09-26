import { useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';

import { AppHeader } from '@/components/ui/app-header';
import { Avatar } from '@/components/ui/avatar';
import { Screen } from '@/components/ui/screen';
import { EmptyView, ErrorView, LoadingView } from '@/components/ui/state-views';
import { useSessionContext } from '@/features/auth/session-context';
import type { ExpenseEvent, ExpenseEventAction, ExpenseSnapshot } from '@/lib/data/expenses';
import { diffSnapshots } from '@/lib/expenses/diff-snapshot';
import { listExpenseEvents, listTripMembers } from '@/lib/data/manager';
import { useAsync } from '@/lib/data/use-async';
import { formatDateTime } from '@/lib/datetime';
import { formatMoney } from '@/lib/money';

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

const ACTION_LABEL: Record<ExpenseEventAction, string> = {
  create: 'đã tạo khoản chi',
  update: 'đã sửa',
  void: 'đã xoá khoản chi',
  settle: 'đã đánh dấu xong',
  unsettle: 'đã bỏ đánh dấu xong',
};

function SnapshotSummary({
  snapshot,
  nameOf,
}: {
  readonly snapshot: ExpenseSnapshot;
  readonly nameOf: (memberId: string) => string;
}) {
  return (
    <View className="mt-2 gap-0.5 rounded-2xl bg-muted/60 p-3">
      <Text className="text-sm text-foreground">
        “{snapshot.description}” · {formatMoney(snapshot.total)} · {nameOf(snapshot.paidByMemberId)}{' '}
        trả
      </Text>
      <Text className="text-xs leading-5 text-muted-foreground">
        {snapshot.shares
          .map((share) => `${nameOf(share.participantId)} ${formatMoney(share.amount)}`)
          .join(' · ')}
      </Text>
    </View>
  );
}

/**
 * Nhật ký thay đổi của một khoản chi: ai, lúc nào, đổi gì. Nhật ký do máy chủ
 * ghi bên trong các RPC tạo/sửa/xoá/đánh dấu — client không ghi và không sửa
 * được, nên đây là nguồn tin cậy khi nhóm thắc mắc "ai đã sửa khoản này".
 */
export default function ExpenseHistoryScreen() {
  const params = useLocalSearchParams<{
    tripId?: string | string[];
    expenseId?: string | string[];
  }>();
  const tripId = firstParam(params.tripId);
  const expenseId = firstParam(params.expenseId);

  const { data, error, loading, reload } = useAsync(async () => {
    if (!tripId || !expenseId) throw new Error('Thiếu mã khoản chi.');
    const [events, members] = await Promise.all([
      listExpenseEvents(expenseId),
      listTripMembers(tripId),
    ]);
    return { events, members };
  }, [tripId, expenseId]);

  const { isGuest } = useSessionContext();
  const nameOf = (memberId: string): string =>
    data?.members.find((member) => member.id === memberId)?.displayName ?? 'Người đã rời';

  const actorOf = (event: ExpenseEvent) => {
    const member = event.actorMemberId
      ? data?.members.find((item) => item.id === event.actorMemberId)
      : undefined;
    return member;
  };

  return (
    <Screen header={<AppHeader title="Lịch sử thay đổi" subtitle="Ai sửa gì, lúc nào" showBack />}>
      {loading && data === null ? <LoadingView /> : null}
      {error ? <ErrorView message={error} onRetry={reload} /> : null}

      {data && data.events.length === 0 ? (
        <EmptyView
          title="Chưa có lịch sử"
          hint="Khoản chi tạo trước khi có tính năng này chưa được ghi lại. Mọi lần sửa từ giờ sẽ hiện ở đây."
        />
      ) : null}

      {data?.events.map((event) => {
        const actor = actorOf(event);
        // Khách chỉ có một người dùng thiết bị nên null là "Bạn". Có tài khoản
        // thì null nghĩa là người sửa không còn trong chuyến — KHÔNG được gán cho người đang xem.
        const actorName = actor?.displayName ?? (isGuest ? 'Bạn' : 'Người đã rời chuyến');
        const changes =
          event.before && event.after ? diffSnapshots(event.before, event.after, nameOf) : [];
        return (
          <View key={event.id} className="rounded-3xl border border-border bg-card p-4">
            <View className="flex-row items-center gap-3">
              <Avatar
                name={actorName}
                uri={actor?.avatarUrl}
                size="sm"
                pending={actor ? !actor.claimed : false}
              />
              <View className="min-w-0 flex-1">
                <Text className="text-sm text-foreground">
                  <Text className="font-semibold">{actorName}</Text> {ACTION_LABEL[event.action]}
                </Text>
                <Text className="text-xs text-muted-foreground">
                  {formatDateTime(new Date(event.at))}
                </Text>
              </View>
            </View>

            {event.action === 'update' && changes.length === 0 ? (
              <Text className="mt-2 text-xs text-muted-foreground">Lưu lại, không đổi gì.</Text>
            ) : null}

            {event.action === 'update'
              ? changes.map((change) => (
                  <View key={change.label} className="mt-2">
                    <Text className="text-xs font-semibold text-muted-foreground">
                      {change.label}
                    </Text>
                    <Text className="text-sm text-foreground">
                      <Text className="text-negative line-through">{change.before}</Text>
                      {'  →  '}
                      <Text className="font-semibold text-positive">{change.after}</Text>
                    </Text>
                  </View>
                ))
              : null}

            {event.action === 'create' && event.after ? (
              <SnapshotSummary snapshot={event.after} nameOf={nameOf} />
            ) : null}
            {event.action === 'void' && event.before ? (
              <SnapshotSummary snapshot={event.before} nameOf={nameOf} />
            ) : null}
          </View>
        );
      })}
    </Screen>
  );
}
