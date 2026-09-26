import { useNavigate } from 'react-router';

import { ResetPasswordForm } from '@/features/auth';
import { routes } from '@/shared/config';
import { AppHeader, Screen } from '@/shared/ui';

export function ResetPasswordPage() {
  const navigate = useNavigate();
  return (
    <Screen header={<AppHeader title="Mật khẩu mới" showBack backFallback={routes.signIn()} />}>
      <ResetPasswordForm
        onDone={(otherDevicesSignedOut) =>
          void navigate(`${routes.signIn()}?reset=${otherDevicesSignedOut ? '1' : 'local'}`, { replace: true })
        }
        onRequestNewLink={() => void navigate(routes.forgotPassword(), { replace: true })}
      />
    </Screen>
  );
}
