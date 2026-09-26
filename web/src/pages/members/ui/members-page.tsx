import { useParams } from 'react-router';

import { listTripGroups, listTripMembers } from '@/entities/member';
import { getTrip } from '@/entities/trip';
import { useAsync } from '@/shared/lib/async';
import { routes } from '@/shared/config';
import { AppHeader, ErrorView, LoadingView, Screen } from '@/shared/ui';
import { MembersManager } from '@/widgets/members-panel';

export function MembersPage() {
  const { tripId = '' } = useParams();
  const { data, error, loading, reload } = useAsync(async () => {
    const [trip, groups, members] = await Promise.all([getTrip(tripId), listTripGroups(tripId), listTripMembers(tripId)]);
    return { trip, groups, members };
  }, [tripId]);

  return (
    <Screen
      header={
        <AppHeader
          title="Thành viên"
          subtitle={data ? `${data.members.length} người · ${data.groups.length} nhóm` : undefined}
          showBack
          backFallback={`${routes.trip(tripId)}?tab=members`}
        />
      }>
      {loading && data === null ? <LoadingView /> : null}
      {error ? <ErrorView message={error} onRetry={reload} /> : null}
      {data ? <MembersManager trip={data.trip} groups={data.groups} members={data.members} onChanged={reload} /> : null}
    </Screen>
  );
}
