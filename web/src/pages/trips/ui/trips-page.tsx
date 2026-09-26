import { useNavigate } from 'react-router';

import { listTrips, TripCard } from '@/entities/trip';
import { useAsync } from '@/shared/lib/async';
import { routes } from '@/shared/config';
import { EmptyView, ErrorView, LoadingView, Screen } from '@/shared/ui';
import { HomeHeader } from '@/widgets/app-header';

export function TripsPage() {
  const navigate = useNavigate();
  const { data: trips, error, loading, reload } = useAsync(() => listTrips(), []);

  return (
    <Screen header={<HomeHeader />}>
      {loading && trips === null ? <LoadingView /> : null}
      {error ? <ErrorView message={error} onRetry={reload} /> : null}
      {trips !== null && trips.length === 0 && !error ? (
        <EmptyView
          title="Chưa có chuyến đi nào"
          hint="Bấm ＋ để tạo chuyến đầu tiên, hoặc 🔑 để tham gia chuyến của bạn bè bằng mã mời."
          actionLabel="Tạo chuyến đi"
          onAction={() => void navigate(routes.tripNew())}
        />
      ) : null}
      {trips?.map((trip) => <TripCard key={trip.id} trip={trip} to={routes.trip(trip.id)} />)}
    </Screen>
  );
}
