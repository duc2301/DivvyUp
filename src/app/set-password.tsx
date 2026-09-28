import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';

import { AppHeader } from '@/components/ui/app-header';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { ErrorView, NoticeView } from '@/components/ui/state-views';
import { TextField } from '@/components/ui/text-field';
import { setInitialPassword, signOut } from '@/features/auth/auth-actions';
import { useSessionContext } from '@/features/auth/session-context';
import { getMyProfile, updateMyProfile } from '@/lib/data/profile';
import { describeError } from '@/lib/data/use-async';

/**
 * Cổng "Đặt mật khẩu" cho tài khoản vừa tạo qua Google — AuthGate đưa người
 * dùng tới đây và giữ ở đây tới khi máy chủ báo đã có mật khẩu.
 *
 * Supabase tạo tài khoản ngay lúc Google trả về; màn này là bước xác nhận.
 * Huỷ = đăng xuất, tài khoản trống vẫn còn. Lần sau đăng nhập Google: chưa có
 * mật khẩu thì quay lại đây, có rồi thì vào app.
 */
export default function SetPasswordScreen() {
  const router = useRouter();
  const { session, markPasswordSet } = useSessionContext();
  const email = session?.user.email ?? '';

  const [displayName, setDisplayName] = useState('');
  const [paymentNote, setPaymentNote] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nameWarning, setNameWarning] = useState<string | null>(null);
  // Mật khẩu đã đặt nhưng lưu tên lỗi: ở lại để người dùng đọc cảnh báo.
  const [passwordSaved, setPasswordSaved] = useState(false);

  // Tên điền sẵn từ hồ sơ (trigger lấy tên Google). Không đọc được thì để
  // trống — người dùng tự gõ; không chặn việc đặt mật khẩu.
  useEffect(() => {
    let cancelled = false;
    getMyProfile()
      .then((profile) => {
        if (cancelled) return;
        setDisplayName((current) => (current === '' ? profile.displayName : current));
        setPaymentNote(profile.paymentNote ?? '');
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const mismatch = confirm !== '' && confirm !== password;
  const canSubmit = password.length >= 6 && confirm === password && displayName.trim() !== '' && !busy;

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setNameWarning(null);
    try {
      await setInitialPassword(password);
    } catch (caught) {
      setError(describeError(caught));
      setBusy(false);
      return;
    }
    // Mật khẩu đã đặt xong. Lưu tên hỏng thì ở lại báo cho người dùng (vào app
    // ngay thì màn này bị gỡ và cảnh báo không bao giờ hiện) — họ bấm "Vào app"
    // rồi sửa tên ở màn Hồ sơ.
    try {
      await updateMyProfile({ displayName, paymentNote });
    } catch (caught) {
      setNameWarning(
        `Đã đặt mật khẩu, nhưng chưa lưu được tên: ${describeError(caught)}. Bạn sửa lại ở màn Hồ sơ.`,
      );
      setPasswordSaved(true);
      setBusy(false);
      return;
    }
    // AuthGate thấy needsPassword = false sẽ tự đưa vào app.
    setBusy(false);
    markPasswordSet();
  };

  const cancel = async (): Promise<void> => {
    setCancelling(true);
    try {
      await signOut();
    } catch {
      // signOut đã tự xoá phiên trên máy khi máy chủ lỗi; không còn gì để làm.
    } finally {
      setCancelling(false);
      router.replace({ pathname: '/sign-in', params: { google: 'cancelled' } });
    }
  };

  return (
    <Screen header={<AppHeader title="Tạo tài khoản" subtitle="Bước cuối — đặt mật khẩu" />}>
      <NoticeView
        tone="info"
        message={`Chưa có tài khoản DivvyUp nào dùng ${email || 'email Google này'}. Đặt mật khẩu để tạo tài khoản — sau đó bạn đăng nhập được bằng Google hoặc bằng email và mật khẩu.`}
      />

      <TextField label="Email" value={email} editable={false} />

      <TextField
        label="Tên hiển thị"
        value={displayName}
        onChangeText={setDisplayName}
        placeholder="Tên bạn muốn người khác thấy"
        autoCapitalize="words"
      />
      <TextField
        label="Mật khẩu"
        value={password}
        onChangeText={setPassword}
        placeholder="Ít nhất 6 ký tự"
        secureTextEntry
        autoCapitalize="none"
        autoComplete="new-password"
      />
      <TextField
        label="Nhập lại mật khẩu"
        value={confirm}
        onChangeText={setConfirm}
        secureTextEntry
        autoCapitalize="none"
        autoComplete="new-password"
        error={mismatch ? 'Mật khẩu nhập lại không khớp.' : null}
        onSubmitEditing={() => {
          if (canSubmit) void submit();
        }}
      />

      {error ? <ErrorView message={error} /> : null}
      {nameWarning ? <NoticeView tone="info" message={nameWarning} /> : null}

      {passwordSaved ? (
        <Button label="Vào app" onPress={markPasswordSet} />
      ) : (
        <>
          <Button
            label="Tạo mật khẩu và vào app"
            onPress={() => void submit()}
            disabled={!canSubmit || cancelling}
            busy={busy}
          />
          <Button
            label="Huỷ"
            variant="ghost"
            onPress={() => void cancel()}
            disabled={busy}
            busy={cancelling}
          />
        </>
      )}
    </Screen>
  );
}
