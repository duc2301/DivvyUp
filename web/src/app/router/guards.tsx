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

function nextQuery(pathname: string, search: string): string {
  const next = `${pathname}${search}`;
  return next === '/' ? '' : `?next=${encodeURIComponent(next)}`;
}

/**
 * Bắt buộc đăng nhập (web không có chế độ khách) VÀ đã có mật khẩu: tài khoản
 * mới qua Google bị giữ ở /set-password trước mọi trang, kể cả link mời. Giữ
 * đích để quay lại sau.
 */
export function RequireAuth() {
  const { loading, session, needsPassword } = useSession();
  const location = useLocation();
  if (loading) return <FullScreenLoading />;
  if (!session) {
    return <Navigate to={`${routes.signIn()}${nextQuery(location.pathname, location.search)}`} replace />;
  }
  // Đang hỏi máy chủ — chưa vẽ trang, kẻo lộ nội dung trước khi cổng kịp chặn.
  if (needsPassword === null) return <FullScreenLoading />;
  if (needsPassword) {
    return <Navigate to={`${routes.setPassword()}${nextQuery(location.pathname, location.search)}`} replace />;
  }
  return <Outlet />;
}

/** Trang /set-password: cần phiên; đã có mật khẩu thì vào app (về ?next). */
export function RequirePasswordSetup() {
  const { loading, session, needsPassword } = useSession();
  const [params] = useSearchParams();
  if (loading) return <FullScreenLoading />;
  if (!session) return <Navigate to={routes.signIn()} replace />;
  if (needsPassword === null) return <FullScreenLoading />;
  if (!needsPassword) return <Navigate to={safeInternalPath(params.get('next'))} replace />;
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
