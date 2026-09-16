import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';

import { AppHeader } from '@/components/ui/app-header';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { ErrorView, LoadingView } from '@/components/ui/state-views';
import { TextField } from '@/components/ui/text-field';
import { completePasswordReset, startPasswordRecovery } from '@/features/auth/auth-actions';
import { describeRedirectError } from '@/features/auth/auth-redirect';
import { useAuthRedirect } from '@/features/auth/use-auth-redirect';
import { describeError } from '@/lib/data/use-async';

type Phase = 'checking' | 'ready' | 'invalid';

export default function ResetPasswordScreen() {
  const router = useRouter();
  const redirect = useAuthRedirect();

  const [phase, setPhase] = useState<Phase>('checking');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Mã PKCE chỉ dùng được MỘT lần: đổi lần hai thì thất bại và ghi đè trạng
  // thái "sẵn sàng" của lần một bằng lỗi. Ref chốt lại mã đã đổi.
  const exchangedCode = useRef<string | null>(null);

  useEffect(() => {
    if (redirect?.errorCode) {
      setError(describeRedirectError(redirect));
      setPhase('invalid');
      return;
    }

    const code = redirect?.code ?? null;
    if (code === null) {
      // Không có mã thì không có gì để xác minh. KHÔNG mở ô đổi mật khẩu chỉ vì
      // máy đang đăng nhập sẵn: link hỏng mà vẫn hiện ô nhập, người dùng sẽ đổi
      // nhầm mật khẩu của tài khoản đang đăng nhập thay vì tài khoản trong email.
      setError('Link đặt lại mật khẩu không hợp lệ hoặc đã hết hạn. Hãy yêu cầu gửi lại email mới.');
      setPhase('invalid');
      return;
    }
    if (exchangedCode.current === code) return;
    exchangedCode.current = code;

    // Không dùng cờ huỷ: ref đã chặn lượt chạy lại, nên nếu lượt đầu bị huỷ thì
    // không ai còn đặt phase và màn hình kẹt ở "Đang kiểm tra link…".
    startPasswordRecovery(code, redirect?.flowId ?? null)
      .then(() => setPhase('ready'))
      .catch((caught: unknown) => {
        setError(describeError(caught));
        setPhase('invalid');
      });
  }, [redirect]);

  const mismatch = confirm !== '' && confirm !== password;
  const canSubmit = password.length >= 6 && confirm === password;

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const { otherDevicesSignedOut } = await completePasswordReset(password);
      router.replace({
        pathname: '/sign-in',
        params: { reset: otherDevicesSignedOut ? '1' : 'local' },
      });
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
