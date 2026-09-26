import { CircleUserRound, LogOut, UserRound } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';

import { getMyProfile } from '@/entities/profile';
import { useSession } from '@/entities/session';
import { signOut } from '@/features/auth';
import { ThemeMenuItem } from '@/features/theme-toggle';
import { useAsync } from '@/shared/lib/async';
import { routes } from '@/shared/config';
import { Avatar, Spinner } from '@/shared/ui';

/** Nút tài khoản ở góc phải: Hồ sơ, sáng/tối, Đăng xuất (bám user-menu.tsx). */
export function UserMenu() {
  const navigate = useNavigate();
  const { session, userId } = useSession();
  const profile = useAsync(async () => (userId ? getMyProfile() : null), [userId]);
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent): void => {
      if (!signingOut && !container.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !signingOut) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, signingOut]);

  const metadataName: unknown = session?.user.user_metadata?.display_name;
  const displayName =
    profile.data?.displayName ??
    (typeof metadataName === 'string' && metadataName.trim() !== '' ? metadataName : 'Tài khoản');
  const avatarUrl = profile.data?.avatarUrl ?? null;

  const handleSignOut = async (): Promise<void> => {
    setSigningOut(true);
    try {
      await signOut();
    } catch {
      // Cả đăng xuất cục bộ cũng lỗi: không còn gì để làm; guard giữ nguyên nếu phiên còn.
    } finally {
      setSigningOut(false);
      setOpen(false);
    }
  };

  return (
    <div ref={container} className="relative">
      <button
        type="button"
        aria-label="Tài khoản"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          if (!open) profile.reload();
          setOpen((value) => !value);
        }}
        className="flex h-11 w-11 items-center justify-center rounded-full text-foreground hover:bg-muted active:opacity-60">
        {avatarUrl ? <Avatar name={displayName} uri={avatarUrl} size="sm" /> : <CircleUserRound size={22} aria-hidden />}
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-12 z-30 flex w-72 max-w-[calc(100vw-2rem)] flex-col gap-1 rounded-2xl border border-border bg-card p-2 shadow-lg">
          <div className="flex items-center gap-3 px-3 pb-2 pt-2">
            <Avatar name={displayName} uri={avatarUrl} size="md" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-base font-semibold text-foreground">{displayName}</p>
              {session?.user.email ? (
                <p className="truncate text-xs text-muted-foreground">{session.user.email}</p>
              ) : null}
            </div>
          </div>
          <div className="mx-3 mb-1 h-px bg-border" />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              void navigate(routes.profile());
            }}
            className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-base text-foreground hover:bg-muted active:bg-muted">
            <UserRound size={20} aria-hidden />
            Hồ sơ
          </button>
          <ThemeMenuItem />
          <div className="mx-3 my-1 h-px bg-border" />
          <button
            type="button"
            role="menuitem"
            disabled={signingOut}
            onClick={() => void handleSignOut()}
            className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-base text-negative hover:bg-muted active:bg-muted disabled:opacity-50">
            {signingOut ? <Spinner /> : <LogOut size={20} aria-hidden />}
            Đăng xuất
          </button>
        </div>
      ) : null}
    </div>
  );
}
