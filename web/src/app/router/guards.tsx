import { Navigate, Outlet, useLocation, useSearchParams } from 'react-router';

import { useSession } from '@/entities/session';
import { routes } from '@/shared/config';
import { safeInternalPath } from '@/shared/lib/router';
import { LoadingView } from '@/shared/ui';

function FullScreenLoading() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-md items-center justify-center">
      <LoadingView />
    </div>
  );
}

/** Bắt buộc đăng nhập (web không có chế độ khách). Giữ đích để quay lại sau khi đăng nhập. */
export function RequireAuth() {
  const { loading, session } = useSession();
  const location = useLocation();
  if (loading) return <FullScreenLoading />;
  if (!session) {
    const next = `${location.pathname}${location.search}`;
    const query = next === '/' ? '' : `?next=${encodeURIComponent(next)}`;
    return <Navigate to={`${routes.signIn()}${query}`} replace />;
  }
  return <Outlet />;
}

/** Màn đăng nhập/quên mật khẩu: đã đăng nhập thì vào thẳng app (hoặc về ?next). */
export function GuestOnly() {
  const { loading, session } = useSession();
  const [params] = useSearchParams();
  if (loading) return <FullScreenLoading />;
  if (session) return <Navigate to={safeInternalPath(params.get('next'))} replace />;
  return <Outlet />;
}
