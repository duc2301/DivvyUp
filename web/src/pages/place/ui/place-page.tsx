import { useParams } from 'react-router';

import { getTrip } from '@/entities/trip';
import { PlacePicker } from '@/features/place-picker';
import { useAsync } from '@/shared/lib/async';
import { routes } from '@/shared/config';
import { useGoBack } from '@/shared/lib/router';
import { AppHeader, ErrorView, LoadingView, Screen } from '@/shared/ui';

export function PlacePage() {
  const { tripId = '' } = useParams();
  const leave = useGoBack(routes.trip(tripId));
  const trip = useAsync(() => getTrip(tripId), [tripId]);

  return (
    <Screen
      header={<AppHeader title="Địa điểm" subtitle="Chọn nơi chuyến đi diễn ra" showBack backFallback={routes.trip(tripId)} />}>
      {trip.loading && trip.data === null ? <LoadingView /> : null}
      {trip.error ? <ErrorView message={trip.error} onRetry={trip.reload} /> : null}
      {trip.data ? <PlacePicker trip={trip.data} onDone={leave} /> : null}
    </Screen>
  );
}
