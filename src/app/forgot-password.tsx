import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { AppHeader } from '@/components/ui/app-header';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { ErrorView, NoticeView } from '@/components/ui/state-views';
import { TextField } from '@/components/ui/text-field';
import {
  AuthRateLimitError,
  EMAIL_RESEND_COOLDOWN_SECONDS,
  requestPasswordReset,
} from '@/features/auth/auth-actions';
import { useCooldown } from '@/features/auth/use-cooldown';
import { describeError } from '@/lib/data/use-async';

export default function ForgotPasswordScreen() {
  const params = useLocalSearchParams<{ email?: string }>();
  const initialEmail = Array.isArray(params.email) ? params.email[0] : params.email;

  const [email, setEmail] = useState(initialEmail ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [cooldown, startCooldown] = useCooldown();

  const submit = async (): Promise<void> => {
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
    <Screen
      header={
        <AppHeader title="Quên mật khẩu" subtitle="Nhận link đặt lại qua email" showBack />
      }>
      <TextField
        label="Email đã đăng ký"
        value={email}
        onChangeText={setEmail}
        placeholder="ban@vidu.com"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        keyboardType="email-address"
        inputMode="email"
      />

      {sentTo !== null ? (
        // Không khẳng định email có tồn tại — Supabase cố ý trả thành công cho
        // cả email chưa đăng ký, để không ai dò được danh sách tài khoản.
        <NoticeView
          tone="success"
          message={`Nếu ${sentTo} đã đăng ký, một email đặt lại mật khẩu đang trên đường tới. Bấm link trong email để mở app và đặt mật khẩu mới.`}
        />
      ) : null}

      {error ? <ErrorView message={error} /> : null}

      <Button
        label={cooldown > 0 ? `${label} (${cooldown}s)` : label}
        onPress={() => void submit()}
        disabled={email.trim() === '' || cooldown > 0}
        busy={busy}
      />
    </Screen>
  );
}
