import type { FormEvent } from 'react';
import { useState } from 'react';

import { describeError } from '@/shared/lib/async';
import { Button, ErrorView, NoticeView, TextField } from '@/shared/ui';

import {
  AuthRateLimitError,
  EMAIL_RESEND_COOLDOWN_SECONDS,
  requestPasswordReset,
} from '../api/auth-actions';
import { useCooldown } from '../lib/use-cooldown';

export function ForgotPasswordForm({ initialEmail }: { readonly initialEmail: string }) {
  const [email, setEmail] = useState(initialEmail);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [cooldown, startCooldown] = useCooldown();

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (email.trim() === '' || cooldown > 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      await requestPasswordReset(email);
      setSentTo(email.trim());
      startCooldown(EMAIL_RESEND_COOLDOWN_SECONDS);
    } catch (caught) {
      if (caught instanceof AuthRateLimitError) startCooldown(caught.retryAfterSeconds);
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  const label = sentTo === null ? 'Gửi link đặt lại' : 'Gửi lại email';

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4" noValidate>
      <TextField
        label="Email đã đăng ký"
        type="email"
        inputMode="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        placeholder="ban@vidu.com"
        autoCapitalize="none"
        autoCorrect="off"
        autoComplete="email"
      />
      {sentTo !== null ? (
        <NoticeView
          tone="success"
          message={`Nếu ${sentTo} đã đăng ký, một email đặt lại mật khẩu đang trên đường tới. Bấm link trong email để mở trang đặt mật khẩu mới — mở trên đúng trình duyệt này.`}
        />
      ) : null}
      {error ? <ErrorView message={error} /> : null}
      <Button
        type="submit"
        label={cooldown > 0 ? `${label} (${cooldown}s)` : label}
        disabled={email.trim() === '' || cooldown > 0}
        busy={busy}
      />
    </form>
  );
}
