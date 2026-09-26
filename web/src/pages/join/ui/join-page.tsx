import { useNavigate, useSearchParams } from 'react-router';

import { JoinTripForm } from '@/features/join-trip';
import { routes } from '@/shared/config';
import { AppHeader, Screen } from '@/shared/ui';

export function JoinPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  return (
    <Screen header={<AppHeader title="Tham gia" subtitle="Nhập mã người tổ chức gửi" showBack />}>
      <JoinTripForm
        initialCode={params.get('code') ?? ''}
        onJoined={(tripId) => void navigate(routes.trip(tripId), { replace: true })}
      />
    </Screen>
  );
}
