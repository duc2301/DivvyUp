import { Camera, ImagePlus } from 'lucide-react';
import type { ChangeEvent } from 'react';
import { useEffect, useRef, useState } from 'react';

import type { MyProfile } from '@/entities/profile';
import {
  removePaymentQr,
  signedPaymentQrUrl,
  updateMyProfile,
  uploadAvatar,
  uploadPaymentQr,
} from '@/entities/profile';
import { describeError } from '@/shared/lib/async';
import { compressImageFile } from '@/shared/lib/image';
import {
  Avatar,
  Button,
  ConfirmDialog,
  ErrorView,
  LoadingView,
  NoticeView,
  SectionCard,
  TextField,
} from '@/shared/ui';

type Busy = 'avatar' | 'qr' | 'save' | 'removeQr' | null;

/** Hồ sơ: tên hiển thị, ảnh đại diện, mã QR nhận tiền, ghi chú số tài khoản (bám profile.tsx). */
export function ProfileEditor({ profile }: { readonly profile: MyProfile }) {
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [paymentNote, setPaymentNote] = useState(profile.paymentNote ?? '');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(profile.avatarUrl);
  const [qrPath, setQrPath] = useState<string | null>(profile.paymentQrPath);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmRemoveQr, setConfirmRemoveQr] = useState(false);
  const avatarInput = useRef<HTMLInputElement>(null);
  const qrInput = useRef<HTMLInputElement>(null);

  // Mã QR nằm ở bucket riêng tư: xin signed URL mỗi khi đường dẫn đổi.
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
      .catch((caught: unknown) => {
        if (!cancelled) {
          setQrUrl(null);
          setActionError(describeError(caught));
        }
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

  /** Lấy tệp vừa chọn rồi xoá giá trị ô để chọn lại đúng tệp đó vẫn kích hoạt onChange. */
  const takeFile = (event: ChangeEvent<HTMLInputElement>): File | null => {
    const file = event.target.files?.[0] ?? null;
    event.target.value = '';
    return file;
  };

  const changeAvatar = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = takeFile(event);
    if (!file) return;
    void run('avatar', async () => {
      const image = await compressImageFile(file, { square: true, maxWidth: 512 });
      setAvatarUrl(await uploadAvatar(image));
      setNotice('Đã cập nhật ảnh đại diện.');
    });
  };

  const changeQr = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = takeFile(event);
    if (!file) return;
    void run('qr', async () => {
      const image = await compressImageFile(file, { square: false, maxWidth: 1080, quality: 0.9 });
      setQrPath(await uploadPaymentQr(image));
      setNotice('Đã lưu mã QR. Người đi chung chuyến sẽ thấy mã này khi cần chuyển tiền cho bạn.');
    });
  };

  const nameInvalid = displayName.trim() === '';

  return (
    <>
      {actionError ? <ErrorView message={actionError} /> : null}
      {notice ? <NoticeView tone="success" message={notice} /> : null}

      <div className="flex flex-col items-center gap-3 pt-2">
        <button
          type="button"
          aria-label="Đổi ảnh đại diện"
          disabled={busy !== null}
          onClick={() => avatarInput.current?.click()}
          className="relative rounded-full active:opacity-70">
          <Avatar name={displayName || profile.displayName} uri={avatarUrl} size="lg" />
          <span className="absolute bottom-0 right-0 flex h-9 w-9 items-center justify-center rounded-full border-2 border-background bg-primary text-primary-foreground">
            <Camera size={18} aria-hidden />
          </span>
        </button>
        <input ref={avatarInput} type="file" accept="image/*" hidden onChange={changeAvatar} />
        {busy === 'avatar' ? (
          <p className="text-xs text-muted-foreground">Đang tải ảnh lên…</p>
        ) : profile.email ? (
          <p className="text-sm text-muted-foreground">{profile.email}</p>
        ) : null}
      </div>

      <SectionCard title="Thông tin">
        <TextField
          label="Tên hiển thị"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          maxLength={80}
          autoComplete="nickname"
          error={nameInvalid ? 'Tên không được để trống.' : null}
          hint="Tên trong từng chuyến đi do người tổ chức đặt, không đổi theo tên này."
        />
      </SectionCard>

      <SectionCard title="Nhận tiền" hint="Chỉ những người đang đi chung chuyến với bạn mới xem được mã QR và ghi chú này.">
        <div className="flex flex-col gap-4">
          <input ref={qrInput} type="file" accept="image/*" hidden onChange={changeQr} />
          {qrPath ? (
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-background p-4">
              {qrUrl ? (
                <img src={qrUrl} alt="Mã QR nhận tiền của bạn" width={220} height={220} className="h-[220px] w-[220px] object-contain" />
              ) : (
                <LoadingView label="Đang tải mã QR…" />
              )}
              <div className="flex w-full gap-3">
                <Button label="Đổi ảnh" variant="secondary" busy={busy === 'qr'} disabled={busy !== null} onClick={() => qrInput.current?.click()} />
                <Button label="Gỡ mã" variant="ghost" disabled={busy !== null} onClick={() => setConfirmRemoveQr(true)} />
              </div>
            </div>
          ) : (
            <button
              type="button"
              aria-label="Tải ảnh mã QR nhận tiền"
              disabled={busy !== null}
              onClick={() => qrInput.current?.click()}
              className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border bg-background px-4 py-8 text-center active:opacity-70">
              <ImagePlus size={28} className="text-primary" aria-hidden />
              <span className="text-base font-semibold text-foreground">
                {busy === 'qr' ? 'Đang tải ảnh lên…' : 'Tải ảnh mã QR'}
              </span>
              <span className="text-xs text-muted-foreground">
                Chụp màn hình mã QR nhận tiền trong app ngân hàng hoặc ví, rồi chọn ở đây.
              </span>
            </button>
          )}
          <TextField
            label="Ghi chú (tuỳ chọn)"
            value={paymentNote}
            onChange={(event) => setPaymentNote(event.target.value)}
            maxLength={120}
            placeholder="VD: Vietcombank · 0123456789 · PHAM VAN A"
            autoCapitalize="characters"
          />
        </div>
      </SectionCard>

      <Button
        label="Lưu hồ sơ"
        busy={busy === 'save'}
        disabled={nameInvalid || busy !== null}
        onClick={() =>
          void run('save', async () => {
            await updateMyProfile({ displayName, paymentNote });
            setNotice('Đã lưu hồ sơ.');
          })
        }
      />

      <ConfirmDialog
        open={confirmRemoveQr}
        title="Gỡ mã QR?"
        message="Người đi chung chuyến sẽ không còn thấy mã QR nhận tiền của bạn."
        confirmLabel="Gỡ"
        destructive
        busy={busy === 'removeQr'}
        onConfirm={() =>
          void run('removeQr', async () => {
            await removePaymentQr();
            setQrPath(null);
            setConfirmRemoveQr(false);
          })
        }
        onCancel={() => setConfirmRemoveQr(false)}
      />
    </>
  );
}
