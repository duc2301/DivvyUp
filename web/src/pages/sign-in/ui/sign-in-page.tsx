import { useSearchParams } from 'react-router';

import { SignInForm } from '@/features/auth';
import { ThemeToggle } from '@/features/theme-toggle';
import { safeInternalPath } from '@/shared/lib/router';
import { BrandLockup, Screen } from '@/shared/ui';

export function SignInPage() {
  const [params] = useSearchParams();
  return (
    <Screen>
      <div className="flex justify-end pt-2">
        <ThemeToggle />
      </div>
      <div className="flex justify-center pb-4">
        <BrandLockup width={240} />
      </div>
      <SignInForm
        confirmed={params.get('confirmed') === '1'}
        reset={params.get('reset')}
        oauth={params.get('oauth') === '1'}
        googleCancelled={params.get('google') === 'cancelled'}
        next={params.get('next') ? safeInternalPath(params.get('next')) : null}
      />
      <p className="mt-6 text-center text-xs leading-5 text-muted-foreground">
        Bản web dùng chung dữ liệu với app DivvyUp — đăng nhập cùng tài khoản để thấy mọi chuyến đi.
      </p>
    </Screen>
  );
}
