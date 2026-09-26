import { useNavigate } from 'react-router';

import { routes } from '@/shared/config';
import { AppHeader, EmptyView, Screen } from '@/shared/ui';

export function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <Screen header={<AppHeader title="Không tìm thấy" showBack />}>
      <EmptyView
        title="Trang này không tồn tại"
        hint="Link có thể đã sai hoặc đã cũ."
        actionLabel="Về danh sách chuyến đi"
        onAction={() => void navigate(routes.home(), { replace: true })}
      />
    </Screen>
  );
}
