import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';

import { AppHeader } from '@/components/ui/app-header';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { ErrorView, LoadingView } from '@/components/ui/state-views';
import { TextField } from '@/components/ui/text-field';
import { completePasswordReset, startPasswordRecovery } from '@/features/auth/auth-actions';
import { describeRedirectError } from '@/features/auth/auth-redirect';
import { useSessionContext } from '@/features/auth/session-context';
import { useAuthRedirect } from '@/features/auth/use-auth-redirect';
import { describeError } from '@/lib/data/use-async';

type Phase = 'checking' | 'ready' | 'invalid';

export default function ResetPasswordScreen() {
  const router = useRouter();
  const redirect = useAuthRedirect();
  const { session, loading: sessionLoading } = useSessionContext();

  const [phase, setPhase] = useState<Phase>('checking');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (sessionLoading) return;
    let cancelled = false;

    if (redirect?.errorCode) {
      setError(describeRedirectError(redirect));
      setPhase('invalid');
      return;
    }

    if (redirect?.accessToken && redirect.refreshToken) {
      startPasswordRecovery(redirect.accessToken, redirect.refreshToken)
        .then(() => {
          if (!cancelled) setPhase('ready');
        })
        .catch((caught: unknown) => {
          if (cancelled) return;
          setError(describeError(caught));
          setPhase('invalid');
        });
    } else if (session !== null) {
      // Đã dựng phiên từ lần render trước (hash đã bị xoá khỏi URL), hoặc người
      // dùng đang đăng nhập sẵn — cả hai đều đổi được mật khẩu.
      setPhase('ready');
    } else {
      // Linking.useURL trả null ở nhịp đầu rồi mới có giá trị. Chờ thêm một chút
      // trước khi kết luận link hỏng, không thì màn hình chớp lỗi oan.
      const timer = setTimeout(() => {
        if (cancelled) return;
        setError('Link đặt lại mật khẩu không hợp lệ hoặc đã hết hạn. Hãy yêu cầu gửi lại email mới.');
        setPhase('invalid');
      }, 1500);
      return () => {
        cancelled = true;
        clearTimeout(timer);
      };
    }

    return () => {
      cancelled = true;
    };
    // session chỉ dùng để quyết định lúc không có token — không cần chạy lại
    // mỗi khi phiên đổi, vì chính startPasswordRecovery làm phiên đổi.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [redirect, sessionLoading]);

  const mismatch = confirm !== '' && confirm !== password;
  const canSubmit = password.length >= 6 && confirm === password;

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await completePasswordReset(password);
      router.replace({ pathname: '/sign-in', params: { reset: '1' } });
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen header={<AppHeader title="Mật khẩu mới" showBack />}>
      {phase === 'checking' ? <LoadingView label="Đang kiểm tra link…" /> : null}

      {phase === 'invalid' ? (
        <>
          {error ? <ErrorView message={error} /> : null}
          <Button
            label="Gửi lại email đặt lại mật khẩu"
            onPress={() => router.replace('/forgot-password')}
          />
        </>
      ) : null}

      {phase === 'ready' ? (
        <>
          <TextField
            label="Mật khẩu mới"
            value={password}
            onChangeText={setPassword}
            placeholder="Ít nhất 6 ký tự"
            secureTextEntry
            autoCapitalize="none"
            autoComplete="new-password"
            error={password !== '' && password.length < 6 ? 'Cần ít nhất 6 ký tự.' : null}
          />
          <TextField
            label="Nhập lại mật khẩu mới"
            value={confirm}
            onChangeText={setConfirm}
            secureTextEntry
            autoCapitalize="none"
            autoComplete="new-password"
            error={mismatch ? 'Hai mật khẩu chưa khớp.' : null}
          />
          {error ? <ErrorView message={error} /> : null}
          <Button
            label="Đổi mật khẩu"
            onPress={() => void submit()}
            disabled={!canSubmit}
            busy={busy}
          />
        </>
      ) : null}
    </Screen>
  );
}
