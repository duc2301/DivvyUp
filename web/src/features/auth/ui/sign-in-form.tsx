import { Square, SquareCheck } from 'lucide-react';
import type { FormEvent } from 'react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';

import { DataError, describeError } from '@/shared/lib/async';
import { routes } from '@/shared/config';
import { Button, ErrorView, NoticeView, SegmentedControl, TextField } from '@/shared/ui';

import {
  AuthRateLimitError,
  EMAIL_RESEND_COOLDOWN_SECONDS,
  rememberedChoice,
  resendSignUpConfirmation,
  signInWithPassword,
  signUpWithPassword,
} from '../api/auth-actions';
import { initialRedirectError } from '../api/recovery';
import { useCooldown } from '../lib/use-cooldown';

type Mode = 'signIn' | 'signUp';
type Banner = { readonly tone: 'success' | 'info'; readonly message: string } | null;

interface SignInFormProps {
  /** ?confirmed=1 — quay về từ link xác nhận đăng ký. */
  readonly confirmed: boolean;
  /** ?reset=1 | local — vừa đổi mật khẩu. */
  readonly reset: string | null;
}

/** Đăng nhập / tạo tài khoản — bám src/app/sign-in.tsx, bỏ chế độ khách. */
export function SignInForm({ confirmed, reset }: SignInFormProps) {
  const [mode, setMode] = useState<Mode>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [remember, setRemember] = useState(rememberedChoice);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<Banner>(null);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  const [cooldown, startCooldown] = useCooldown();

  const resetDone = reset === '1' || reset === 'local';

  useEffect(() => {
    const urlError = initialRedirectError();
    if ((confirmed || resetDone) && urlError) {
      setError(urlError);
      return;
    }
    if (confirmed) {
      setBanner({
        tone: 'success',
        message: 'Đăng ký thành công! Email đã được xác nhận — đăng nhập để bắt đầu.',
      });
    } else if (resetDone) {
      setBanner(
        reset === 'local'
          ? {
              tone: 'info',
              message:
                'Đã đổi mật khẩu, nhưng mất mạng nên chưa đăng xuất được các thiết bị khác. Nếu nghi bị lộ, đăng nhập rồi đổi mật khẩu thêm lần nữa khi có mạng.',
            }
          : { tone: 'success', message: 'Đã đổi mật khẩu. Đăng nhập bằng mật khẩu mới.' },
      );
    }
  }, [confirmed, resetDone, reset]);

  const handleFailure = (caught: unknown): void => {
    if (caught instanceof AuthRateLimitError) startCooldown(caught.retryAfterSeconds);
    if (caught instanceof DataError && caught.code === 'email_not_confirmed') {
      setPendingEmail(email.trim());
    }
    setError(describeError(caught));
  };

  const canSubmit =
    email.trim() !== '' &&
    password !== '' &&
    (mode === 'signIn' || displayName.trim() !== '') &&
    (mode === 'signIn' || cooldown === 0);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!canSubmit || busy) return;
    setBusy(true);
    setError(null);
    setBanner(null);
    try {
      if (mode === 'signIn') {
        await signInWithPassword(email, password, remember);
        // Không điều hướng: guard thấy phiên mới sẽ tự đưa vào app.
      } else {
        const { needsEmailConfirmation } = await signUpWithPassword(email, password, displayName);
        if (needsEmailConfirmation) {
          const sentTo = email.trim();
          setPendingEmail(sentTo);
          startCooldown(EMAIL_RESEND_COOLDOWN_SECONDS);
          setMode('signIn');
          setPassword('');
          setBanner({
            tone: 'info',
            message: `Đã gửi email xác nhận tới ${sentTo}. Bấm link trong email — trang sẽ mở lại để bạn đăng nhập.`,
          });
        }
      }
    } catch (caught) {
      handleFailure(caught);
    } finally {
      setBusy(false);
    }
  };

  const resend = async (): Promise<void> => {
    if (pendingEmail === null) return;
    setResending(true);
    setError(null);
    try {
      await resendSignUpConfirmation(pendingEmail);
      startCooldown(EMAIL_RESEND_COOLDOWN_SECONDS);
      setBanner({ tone: 'info', message: `Đã gửi lại email xác nhận tới ${pendingEmail}.` });
    } catch (caught) {
      handleFailure(caught);
    } finally {
      setResending(false);
    }
  };

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4" noValidate>
      <SegmentedControl
        options={[
          { value: 'signIn' as const, label: 'Đăng nhập' },
          { value: 'signUp' as const, label: 'Tạo tài khoản' },
        ]}
        value={mode}
        onChange={(next) => {
          setMode(next);
          setError(null);
          setBanner(null);
        }}
        ariaLabel="Chọn đăng nhập hoặc tạo tài khoản"
      />

      {banner ? <NoticeView tone={banner.tone} message={banner.message} /> : null}

      {mode === 'signUp' ? (
        <TextField
          label="Tên hiển thị"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          placeholder="Tên bạn muốn người khác thấy"
          autoCapitalize="words"
          autoComplete="nickname"
        />
      ) : null}

      <TextField
        label="Email"
        type="email"
        inputMode="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        placeholder="ban@vidu.com"
        autoCapitalize="none"
        autoCorrect="off"
        autoComplete="email"
      />

      <TextField
        label="Mật khẩu"
        type="password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        placeholder="Ít nhất 6 ký tự"
        autoComplete={mode === 'signIn' ? 'current-password' : 'new-password'}
      />

      {mode === 'signIn' ? (
        <div className="flex items-center justify-between">
          <button
            type="button"
            role="checkbox"
            aria-checked={remember}
            onClick={() => setRemember((value) => !value)}
            className="flex min-h-11 items-center gap-2 pr-2 text-sm text-foreground active:opacity-60">
            {remember ? (
              <SquareCheck size={22} className="text-primary" aria-hidden />
            ) : (
              <Square size={22} className="text-muted-foreground" aria-hidden />
            )}
            Ghi nhớ đăng nhập
          </button>
          <Link
            to={`${routes.forgotPassword()}${email.trim() ? `?email=${encodeURIComponent(email.trim())}` : ''}`}
            className="flex min-h-11 items-center pl-2 text-sm font-semibold text-primary">
            Quên mật khẩu?
          </Link>
        </div>
      ) : null}

      {error ? <ErrorView message={error} /> : null}

      <Button
        type="submit"
        label={
          mode === 'signIn'
            ? 'Đăng nhập'
            : cooldown > 0
              ? `Tạo tài khoản (${cooldown}s)`
              : 'Tạo tài khoản'
        }
        disabled={!canSubmit}
        busy={busy}
      />

      {pendingEmail !== null && mode === 'signIn' ? (
        <Button
          label={cooldown > 0 ? `Gửi lại email xác nhận (${cooldown}s)` : 'Gửi lại email xác nhận'}
          variant="secondary"
          onClick={() => void resend()}
          disabled={cooldown > 0}
          busy={resending}
        />
      ) : null}
    </form>
  );
}
