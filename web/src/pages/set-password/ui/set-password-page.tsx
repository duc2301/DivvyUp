import { useNavigate } from 'react-router';

import { SetPasswordForm } from '@/features/auth';
import { routes } from '@/shared/config';
import { AppHeader, Screen } from '@/shared/ui';

/** Trang cổng "Đặt mật khẩu" — guard RequirePasswordSetup giữ người dùng ở đây tới khi đặt xong. */
export function SetPasswordPage() {
  const navigate = useNavigate();
  return (
    <Screen header={<AppHeader title="Tạo tài khoản" subtitle="Bước cuối — đặt mật khẩu" />}>
      <SetPasswordForm
        onCancelled={() => void navigate(`${routes.signIn()}?google=cancelled`, { replace: true })}
      />
    </Screen>
  );
}
