import { useState } from 'react';
import { Text, View } from 'react-native';

import { BrandLockup } from '@/components/ui/brand';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { Screen } from '@/components/ui/screen';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { ErrorView } from '@/components/ui/state-views';
import { TextField } from '@/components/ui/text-field';
import { signInWithPassword, signUpWithPassword } from '@/features/auth/auth-actions';
import { useSessionContext } from '@/features/auth/session-context';
import { describeError } from '@/lib/data/use-async';

type Mode = 'signIn' | 'signUp';

export default function SignInScreen() {
  const { setGuestMode } = useSessionContext();
  const [mode, setMode] = useState<Mode>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === 'signIn') {
        await signInWithPassword(email, password);
        // Không cần điều hướng: AuthGate thấy session đổi sẽ tự đưa về trang chủ.
      } else {
        const { needsEmailConfirmation } = await signUpWithPassword(email, password, displayName);
        if (needsEmailConfirmation) {
          setNotice(
            'Đã tạo tài khoản. Hãy bấm link xác nhận trong email rồi quay lại đăng nhập. ' +
              'Đang phát triển thì có thể tắt "Confirm email" trong Supabase → Authentication → Sign In / Providers.',
          );
          setMode('signIn');
        }
      }
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  const canSubmit =
    email.trim() !== '' &&
    password !== '' &&
    (mode === 'signIn' || displayName.trim() !== '');

  return (
    <>
      <Screen>
        {/* Logo thay cho khối chữ: dòng tagline đã nằm sẵn trong file logo,
            viết lại bằng Text sẽ thành hai nguồn chân lý cho cùng một câu. */}
        <View className="flex-row justify-end pt-2">
          <ThemeToggle />
        </View>

        <View className="items-center pb-4">
          <BrandLockup width={240} />
        </View>

        <SegmentedControl
          options={[
            { value: 'signIn' as const, label: 'Đăng nhập' },
            { value: 'signUp' as const, label: 'Tạo tài khoản' },
          ]}
          value={mode}
          onChange={(next) => {
            setMode(next);
            setError(null);
            setNotice(null);
          }}
          accessibilityLabel="Chọn đăng nhập hoặc tạo tài khoản"
        />

        {mode === 'signUp' ? (
          <TextField
            label="Tên hiển thị"
            value={displayName}
            onChangeText={setDisplayName}
            placeholder="Tên bạn muốn người khác thấy"
            autoCapitalize="words"
          />
        ) : null}

        <TextField
          label="Email"
          value={email}
          onChangeText={setEmail}
          placeholder="ban@vidu.com"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          inputMode="email"
        />

        <TextField
          label="Mật khẩu"
          value={password}
          onChangeText={setPassword}
          placeholder="Ít nhất 6 ký tự"
          secureTextEntry
          autoCapitalize="none"
        />

        {notice ? (
          <View className="rounded-2xl border border-border bg-card p-4">
            <Text className="text-sm text-foreground">{notice}</Text>
          </View>
        ) : null}

        {error ? <ErrorView message={error} /> : null}

        <Button
          label={mode === 'signIn' ? 'Đăng nhập' : 'Tạo tài khoản'}
          onPress={() => void submit()}
          disabled={!canSubmit}
          busy={busy}
        />

        <View className="mt-6 items-center">
          <Button
            label="Tiếp tục với tư cách khách"
            variant="ghost"
            onPress={() => void setGuestMode(true)}
          />
        </View>
      </Screen>
    </>
  );
}
