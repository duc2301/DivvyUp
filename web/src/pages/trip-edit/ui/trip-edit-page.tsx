import { useParams } from 'react-router';

import { getTrip } from '@/entities/trip';
import { TripEditForm } from '@/features/trip-edit';
import { useAsync } from '@/shared/lib/async';
import { routes } from '@/shared/config';
import { useGoBack } from '@/shared/lib/router';
import { AppHeader, ErrorView, LoadingView, Screen } from '@/shared/ui';

export function TripEditPage() {
  const { tripId = '' } = useParams();
  const leave = useGoBack(routes.trip(tripId));
  const trip = useAsync(() => getTrip(tripId), [tripId]);

  return (
    <Screen header={<AppHeader title="Sửa chuyến đi" subtitle="Tên và ngày đi" showBack backFallback={routes.trip(tripId)} />}>
      {trip.loading && trip.data === null ? <LoadingView /> : null}
      {trip.error ? <ErrorView message={trip.error} onRetry={trip.reload} /> : null}
      {/* key: đổ dữ liệu vào form đúng một lần khi chuyến đi về. */}
      {trip.data ? <TripEditForm key={trip.data.id} trip={trip.data} onSaved={leave} /> : null}
    </Screen>
  );
}
