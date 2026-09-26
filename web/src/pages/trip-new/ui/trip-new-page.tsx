import { useNavigate } from 'react-router';

import { CreateTripForm } from '@/features/create-trip';
import { routes } from '@/shared/config';
import { AppHeader, Screen } from '@/shared/ui';

export function TripNewPage() {
  const navigate = useNavigate();
  return (
    <Screen header={<AppHeader title="Chuyến đi mới" showBack />}>
      {/* replace: quay lui từ màn chuyến đi thì về danh sách, không về form đã dùng xong. */}
      <CreateTripForm onCreated={(tripId) => void navigate(routes.trip(tripId), { replace: true })} />
    </Screen>
  );
}
