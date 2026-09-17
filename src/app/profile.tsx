import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { AppHeader } from '@/components/ui/app-header';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Camera, ImagePlus } from '@/components/ui/icons';
import { Screen } from '@/components/ui/screen';
import { SectionCard } from '@/components/ui/section-card';
import { EmptyView, ErrorView, LoadingView, NoticeView } from '@/components/ui/state-views';
import { TextField } from '@/components/ui/text-field';
import { useSessionContext } from '@/features/auth/session-context';
import { pickAndCompressImage } from '@/features/profile/pick-image';
import {
  getMyProfile,
  removePaymentQr,
  signedPaymentQrUrl,
  updateMyProfile,
  uploadAvatar,
  uploadPaymentQr,
} from '@/lib/data/profile';
import { describeError, useAsync } from '@/lib/data/use-async';

type Busy = 'avatar' | 'qr' | 'save' | 'removeQr' | null;

export default function ProfileScreen() {
  const { session, isGuest, setGuestMode } = useSessionContext();
  const signedIn = session !== null;

  const [displayName, setDisplayName] = useState('');
  const [paymentNote, setPaymentNote] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [qrPath, setQrPath] = useState<string | null>(null);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [seeded, setSeeded] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmRemoveQr, setConfirmRemoveQr] = useState(false);

  const { data, error, loading, reload } = useAsync(async () => {
    if (!signedIn) return null;
    return getMyProfile();
  }, [signedIn]);

  // Đổ dữ liệu vào form đúng một lần — reload sau khi lưu không được ghi đè
  // chữ người dùng đang gõ dở.
  useEffect(() => {
    if (!data || seeded) return;
    setDisplayName(data.displayName);
    setPaymentNote(data.paymentNote ?? '');
    setAvatarUrl(data.avatarUrl);
    setQrPath(data.paymentQrPath);
    setSeeded(true);
  }, [data, seeded]);

  // Mã QR nằm trong bucket riêng tư: phải xin signed URL mỗi khi đường dẫn đổi.
  useEffect(() => {
    let cancelled = false;
    if (qrPath === null) {
      setQrUrl(null);
      return;
    }
    signedPaymentQrUrl(qrPath)
      .then((url) => {
        if (!cancelled) setQrUrl(url);
      })
      .catch(() => {
        if (!cancelled) setQrUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [qrPath]);

  const run = async (kind: Exclude<Busy, null>, task: () => Promise<void>): Promise<void> => {
    if (busy !== null) return;
    setBusy(kind);
    setActionError(null);
    setNotice(null);
    try {
      await task();
    } catch (caught) {
      setActionError(describeError(caught));
    } finally {
      setBusy(null);
    }
  };

  const changeAvatar = (): Promise<void> =>
    run('avatar', async () => {
      const image = await pickAndCompressImage({ square: true, maxWidth: 512 });
      if (!image) return;
      setAvatarUrl(await uploadAvatar(image));
      setNotice('Đã cập nhật ảnh đại diện.');
    });

  const changeQr = (): Promise<void> =>
    run('qr', async () => {
      const image = await pickAndCompressImage({ square: false, maxWidth: 1080 });
      if (!image) return;
      setQrPath(await uploadPaymentQr(image));
      setNotice('Đã lưu mã QR. Người đi chung chuyến sẽ thấy mã này khi cần chuyển tiền cho bạn.');
    });

  const deleteQr = (): Promise<void> =>
    run('removeQr', async () => {
      await removePaymentQr();
      setQrPath(null);
      setConfirmRemoveQr(false);
    });

  const save = (): Promise<void> =>
    run('save', async () => {
      await updateMyProfile({ displayName, paymentNote });
      setNotice('Đã lưu hồ sơ.');
    });

  if (!signedIn) {
    return (
      <Screen header={<AppHeader title="Hồ sơ" showBack />}>
        <EmptyView
          title="Hồ sơ cần tài khoản"
          hint={
            isGuest
              ? 'Chế độ khách không có hồ sơ. Đăng nhập để có ảnh đại diện và mã QR nhận tiền cho bạn bè quét.'
              : 'Đăng nhập để xem hồ sơ.'
          }
          actionLabel="Đăng nhập"
          onAction={() => void setGuestMode(false)}
        />
      </Screen>
    );
  }

  const nameInvalid = displayName.trim() === '';

  return (
    <>
      <Screen header={<AppHeader title="Hồ sơ" showBack />}>
        {loading && data === null ? <LoadingView /> : null}
        {error ? <ErrorView message={error} onRetry={reload} /> : null}
        {actionError ? <ErrorView message={actionError} /> : null}
        {notice ? <NoticeView tone="success" message={notice} /> : null}

        {data ? (
          <>
            <View className="items-center gap-3 pt-2">
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Đổi ảnh đại diện"
                disabled={busy !== null}
                onPress={() => void changeAvatar()}
                className="active:opacity-70">
                <Avatar name={displayName || data.displayName} uri={avatarUrl} size="lg" />
                <View className="absolute bottom-0 right-0 h-9 w-9 items-center justify-center rounded-full border-2 border-background bg-primary">
                  <Camera size={18} className="text-primary-foreground" />
                </View>
              </Pressable>
              {busy === 'avatar' ? (
                <Text className="text-xs text-muted-foreground">Đang tải ảnh lên…</Text>
              ) : data.email ? (
                <Text className="text-sm text-muted-foreground">{data.email}</Text>
              ) : null}
            </View>

            <SectionCard title="Thông tin">
              <TextField
                label="Tên hiển thị"
                value={displayName}
                onChangeText={setDisplayName}
                maxLength={80}
                autoCapitalize="words"
                error={nameInvalid ? 'Tên không được để trống.' : null}
                hint="Tên trong từng chuyến đi do người tổ chức đặt, không đổi theo tên này."
              />
            </SectionCard>

            <SectionCard
              title="Nhận tiền"
              hint="Chỉ những người đang đi chung chuyến với bạn mới xem được mã QR và ghi chú này.">
              <View className="gap-4">
                {qrPath ? (
                  <View className="items-center gap-3 rounded-2xl border border-border bg-background p-4">
                    {qrUrl ? (
                      <Image
                        source={{ uri: qrUrl }}
                        style={{ width: 220, height: 220 }}
                        contentFit="contain"
                        accessibilityLabel="Mã QR nhận tiền của bạn"
                      />
                    ) : (
                      <LoadingView label="Đang tải mã QR…" />
                    )}
                    <View className="w-full flex-row gap-3">
                      <View className="min-w-0 flex-1">
                        <Button
                          label="Đổi ảnh"
                          variant="secondary"
                          busy={busy === 'qr'}
                          disabled={busy !== null}
                          onPress={() => void changeQr()}
                        />
                      </View>
                      <View className="min-w-0 flex-1">
                        <Button
                          label="Gỡ mã"
                          variant="ghost"
                          disabled={busy !== null}
                          onPress={() => setConfirmRemoveQr(true)}
                        />
                      </View>
                    </View>
                  </View>
                ) : (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Tải ảnh mã QR nhận tiền"
                    disabled={busy !== null}
                    onPress={() => void changeQr()}
                    className="items-center gap-2 rounded-2xl border border-dashed border-border bg-background px-4 py-8 active:opacity-70">
                    <ImagePlus size={28} className="text-primary" />
                    <Text className="text-base font-semibold text-foreground">
                      {busy === 'qr' ? 'Đang tải ảnh lên…' : 'Tải ảnh mã QR'}
                    </Text>
                    <Text className="text-center text-xs text-muted-foreground">
                      Chụp màn hình mã QR nhận tiền trong app ngân hàng hoặc ví, rồi chọn ở đây.
                    </Text>
                  </Pressable>
                )}

                <TextField
                  label="Ghi chú (tuỳ chọn)"
                  value={paymentNote}
                  onChangeText={setPaymentNote}
                  maxLength={120}
                  placeholder="VD: Vietcombank · 0123456789 · PHAM VAN A"
                  autoCapitalize="characters"
                />
              </View>
            </SectionCard>

            <Button
              label="Lưu hồ sơ"
              onPress={() => void save()}
              busy={busy === 'save'}
              disabled={nameInvalid || busy !== null}
            />
          </>
        ) : null}
      </Screen>

      <ConfirmDialog
        visible={confirmRemoveQr}
        title="Gỡ mã QR?"
        message="Người đi chung chuyến sẽ không còn thấy mã QR nhận tiền của bạn."
        confirmLabel="Gỡ"
        destructive
        busy={busy === 'removeQr'}
        onConfirm={() => void deleteQr()}
        onCancel={() => setConfirmRemoveQr(false)}
      />
    </>
  );
}
