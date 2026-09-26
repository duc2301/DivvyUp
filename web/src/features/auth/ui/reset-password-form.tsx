import type { FormEvent } from 'react';
import { useEffect, useState } from 'react';

import { describeError } from '@/shared/lib/async';
import { Button, ErrorView, LoadingView, TextField } from '@/shared/ui';

import { completePasswordReset } from '../api/auth-actions';
import { verifyPasswordRecovery } from '../api/recovery';

type Phase = 'checking' | 'ready' | 'invalid';

interface ResetPasswordFormProps {
  /** Đổi xong — `otherDevicesSignedOut` false nếu chỉ đăng xuất được máy này. */
  readonly onDone: (otherDevicesSignedOut: boolean) => void;
  readonly onRequestNewLink: () => void;
}

export function ResetPasswordForm({ onDone, onRequestNewLink }: ResetPasswordFormProps) {
  const [phase, setPhase] = useState<Phase>('checking');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    verifyPasswordRecovery()
      .then(() => {
        if (active) setPhase('ready');
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setError(describeError(caught));
        setPhase('invalid');
      });
    return () => {
      active = false;
    };
  }, []);

  const mismatch = confirm !== '' && confirm !== password;
  const canSubmit = password.length >= 6 && confirm === password;

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!canSubmit || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { otherDevicesSignedOut } = await completePasswordReset(password);
      onDone(otherDevicesSignedOut);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  if (phase === 'checking') return <LoadingView label="Đang kiểm tra link…" />;

  if (phase === 'invalid') {
    return (
      <div className="flex flex-col gap-4">
        {error ? <ErrorView message={error} /> : null}
        <Button label="Gửi lại email đặt lại mật khẩu" onClick={onRequestNewLink} />
      </div>
    );
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4" noValidate>
      <TextField
        label="Mật khẩu mới"
        type="password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        placeholder="Ít nhất 6 ký tự"
        autoComplete="new-password"
        error={password !== '' && password.length < 6 ? 'Cần ít nhất 6 ký tự.' : null}
      />
      <TextField
        label="Nhập lại mật khẩu mới"
        type="password"
        value={confirm}
        onChange={(event) => setConfirm(event.target.value)}
        autoComplete="new-password"
        error={mismatch ? 'Hai mật khẩu chưa khớp.' : null}
      />
      {error ? <ErrorView message={error} /> : null}
      <Button type="submit" label="Đổi mật khẩu" disabled={!canSubmit} busy={busy} />
    </form>
  );
}
