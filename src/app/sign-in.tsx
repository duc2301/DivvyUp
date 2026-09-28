import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';

import { BrandLockup } from '@/components/ui/brand';
import { Button } from '@/components/ui/button';
import { Square, SquareCheck } from '@/components/ui/icons';
import { Screen } from '@/components/ui/screen';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { ErrorView, NoticeView } from '@/components/ui/state-views';
import { TextField } from '@/components/ui/text-field';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import {
  AuthRateLimitError,
  EMAIL_RESEND_COOLDOWN_SECONDS,
  exchangeOAuthCode,
  resendSignUpConfirmation,
  signInWithGoogle,
  signInWithPassword,
  signUpWithPassword,
} from '@/features/auth/auth-actions';
import {
  describeOAuthError,
  describeRedirectError,
  isOAuthCancellation,
} from '@/features/auth/auth-redirect';
import { useSessionContext } from '@/features/auth/session-context';
import { useAuthRedirect } from '@/features/auth/use-auth-redirect';
import { useCooldown } from '@/features/auth/use-cooldown';
import { getRememberSession } from '@/lib/supabase/client';
import { DataError } from '@/lib/supabase/errors';
import { describeError } from '@/lib/data/use-async';

type Mode = 'signIn' | 'signUp';

type Banner =
  | { readonly tone: 'success' | 'info'; readonly message: string }
  | null;

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default function SignInScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    confirmed?: string;
    reset?: string;
    oauth?: string;
    google?: string;
  }>();
  const redirect = useAuthRedirect();
  const { setGuestMode } = useSessionContext();

  const [mode, setMode] = useState<Mode>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<Banner>(null);
  // Email vừa đăng ký nhưng chưa xác nhận — có giá trị thì hiện nút gửi lại.
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  const [cooldown, startCooldown] = useCooldown();

  // Khôi phục lựa chọn "ghi nhớ" của lần trước.
  useEffect(() => {
    let cancelled = false;
    void getRememberSession().then((value) => {
      if (!cancelled) setRemember(value);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Thông báo khi quay về từ link trong email.
  const confirmed = firstParam(params.confirmed) === '1';
  const resetParam = firstParam(params.reset);
  const resetDone = resetParam === '1' || resetParam === 'local';
  useEffect(() => {
    // Chỉ tin lỗi trong URL khi màn này được mở ĐÚNG từ link email (có tham số
    // confirmed/reset). redirect là URL gần nhất đã mở app — không kiểm thì
    // một link hỏng hôm qua hiện lại lỗi mỗi lần đăng xuất về màn này.
    if ((confirmed || resetDone) && redirect?.errorCode) {
      setError(describeRedirectError(redirect));
      return;
    }
    if (confirmed) {
      setMode('signIn');
      setBanner({
        tone: 'success',
        message: 'Đăng ký thành công! Email đã được xác nhận — đăng nhập để bắt đầu.',
      });
    } else if (resetDone) {
      setMode('signIn');
      setBanner(
        resetParam === 'local'
          ? {
              tone: 'info',
              message:
                'Đã đổi mật khẩu, nhưng mất mạng nên chưa đăng xuất được các thiết bị khác. Nếu nghi bị lộ, đăng nhập rồi đổi mật khẩu thêm lần nữa khi có mạng.',
            }
          : { tone: 'success', message: 'Đã đổi mật khẩu. Đăng nhập bằng mật khẩu mới.' },
      );
    }
  }, [confirmed, resetDone, resetParam, redirect]);

  // Quay về từ Google qua deep link mà openAuthSessionAsync không trả 'success'
  // (Android có máy đóng tab trả 'dismiss', hoặc hệ điều hành giết app giữa
  // chừng): màn này tự đổi mã. exchangeOAuthCode bỏ qua mã đã đổi.
  const fromOAuth = firstParam(params.oauth) === '1';
  const cancelledGoogle = firstParam(params.google) === 'cancelled';
  useEffect(() => {
    if (cancelledGoogle) {
      setBanner({
        tone: 'info',
        message:
          'Đã huỷ tạo tài khoản. Lần sau đăng nhập bằng Google, bạn sẽ được mời đặt mật khẩu lại.',
      });
    }
  }, [cancelledGoogle]);
  useEffect(() => {
    if (!fromOAuth || !redirect) return;
    if (redirect.errorCode) {
      // Bấm Huỷ ở màn đồng ý của Google → không phải lỗi.
      if (!isOAuthCancellation(redirect)) setError(describeOAuthError(redirect));
      return;
    }
    if (!redirect.code) return;
    // Hiện trạng thái bận trong lúc đổi mã: Android trả 'dismiss' làm nút Google
    // hết quay trong khi mã vẫn đang được đổi — người dùng dễ bấm lần nữa.
    setGoogleBusy(true);
    exchangeOAuthCode(redirect.code, redirect.flowId)
      .catch((caught: unknown) => {
        setError(describeError(caught));
      })
      .finally(() => setGoogleBusy(false));
  }, [fromOAuth, redirect]);

  const google = async (): Promise<void> => {
    setGoogleBusy(true);
    setError(null);
    setBanner(null);
    try {
      await signInWithGoogle(remember);
      // 'signed-in': AuthGate tự đưa vào app hoặc tới màn đặt mật khẩu.
      // 'cancelled': người dùng tự đóng — không báo gì.
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setGoogleBusy(false);
    }
  };

  const handleFailure = (caught: unknown): void => {
    if (caught instanceof AuthRateLimitError) startCooldown(caught.retryAfterSeconds);
    if (caught instanceof DataError && caught.code === 'email_not_confirmed') {
      setPendingEmail(email.trim());
    }
    setError(describeError(caught));
  };

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setBanner(null);
    try {
      if (mode === 'signIn') {
        await signInWithPassword(email, password, remember);
        // Không cần điều hướng: AuthGate thấy session đổi sẽ tự đưa về trang chủ.
      } else {
        const { needsEmailConfirmation, alreadyRegistered } = await signUpWithPassword(
          email,
          password,
          displayName,
        );
        if (alreadyRegistered) {
          setMode('signIn');
          setPassword('');
          setBanner({
            tone: 'info',
            message:
              'Email này đã có tài khoản. Hãy đăng nhập — bằng Google nếu bạn từng dùng Google, hoặc bấm "Quên mật khẩu?".',
          });
        } else if (needsEmailConfirmation) {
          const sentTo = email.trim();
          setPendingEmail(sentTo);
          startCooldown(EMAIL_RESEND_COOLDOWN_SECONDS);
          setMode('signIn');
          setPassword('');
          setBanner({
            tone: 'info',
            message: `Đã gửi email xác nhận tới ${sentTo}. Bấm link trong email — app sẽ mở lại màn này để bạn đăng nhập.`,
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

  const canSubmit =
    email.trim() !== '' &&
    password !== '' &&
    (mode === 'signIn' || displayName.trim() !== '') &&
    // Đăng ký cũng gửi email, nên cũng phải chờ hết thời gian khoá.
    (mode === 'signIn' || cooldown === 0);

  return (
    <Screen>
      <View className="flex-row justify-end pt-2">
        <ThemeToggle />
      </View>

      {/* Logo thay cho khối chữ: dòng tagline đã nằm sẵn trong file logo,
          viết lại bằng Text sẽ thành hai nguồn chân lý cho cùng một câu. */}
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
          setBanner(null);
        }}
        accessibilityLabel="Chọn đăng nhập hoặc tạo tài khoản"
      />

      {banner ? <NoticeView tone={banner.tone} message={banner.message} /> : null}

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
        autoComplete="email"
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
        autoComplete={mode === 'signIn' ? 'current-password' : 'new-password'}
        onSubmitEditing={() => {
          if (canSubmit && !busy && !googleBusy) void submit();
        }}
      />

      {mode === 'signIn' ? (
        <View className="flex-row items-center justify-between">
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: remember }}
            accessibilityLabel="Ghi nhớ đăng nhập"
            onPress={() => setRemember((value) => !value)}
            className="min-h-11 flex-row items-center gap-2 pr-2 active:opacity-60">
            {remember ? (
              <SquareCheck size={22} className="text-primary" />
            ) : (
              <Square size={22} className="text-muted-foreground" />
            )}
            <Text className="text-sm text-foreground">Ghi nhớ đăng nhập</Text>
          </Pressable>

          <Pressable
            accessibilityRole="link"
            onPress={() =>
              router.push({ pathname: '/forgot-password', params: { email: email.trim() } })
            }
            className="min-h-11 justify-center pl-2 active:opacity-60">
            <Text className="text-sm font-semibold text-primary">Quên mật khẩu?</Text>
          </Pressable>
        </View>
      ) : null}

      {error ? <ErrorView message={error} /> : null}

      <Button
        label={
          mode === 'signIn'
            ? 'Đăng nhập'
            : cooldown > 0
              ? `Tạo tài khoản (${cooldown}s)`
              : 'Tạo tài khoản'
        }
        onPress={() => void submit()}
        disabled={!canSubmit || googleBusy}
        busy={busy}
      />

      {/* Bản web thật là web/ — Expo web của mobile không có luồng Google. */}
      {Platform.OS === 'web' ? null : (
        <>
          <View className="flex-row items-center gap-3">
            <View className="h-px flex-1 bg-border" />
            <Text className="text-xs text-muted-foreground">hoặc</Text>
            <View className="h-px flex-1 bg-border" />
          </View>
          <Button
            label="Tiếp tục với Google"
            variant="secondary"
            onPress={() => void google()}
            disabled={busy}
            busy={googleBusy}
          />
        </>
      )}

      {pendingEmail !== null && mode === 'signIn' ? (
        <Button
          label={
            cooldown > 0 ? `Gửi lại email xác nhận (${cooldown}s)` : 'Gửi lại email xác nhận'
          }
          variant="secondary"
          onPress={() => void resend()}
          disabled={cooldown > 0}
          busy={resending}
        />
      ) : null}

      <View className="mt-6 items-center">
        <Button
          label="Tiếp tục với tư cách khách"
          variant="ghost"
          onPress={() => void setGuestMode(true)}
        />
      </View>
    </Screen>
  );
}
