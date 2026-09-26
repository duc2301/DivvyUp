import { useSearchParams } from 'react-router';

import { ForgotPasswordForm } from '@/features/auth';
import { routes } from '@/shared/config';
import { AppHeader, Screen } from '@/shared/ui';

export function ForgotPasswordPage() {
  const [params] = useSearchParams();
  return (
    <Screen header={<AppHeader title="Quên mật khẩu" subtitle="Nhận link đặt lại qua email" showBack backFallback={routes.signIn()} />}>
      <ForgotPasswordForm initialEmail={params.get('email') ?? ''} />
    </Screen>
  );
}
