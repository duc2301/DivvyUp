import type { FormEvent } from 'react';
import { useEffect, useState } from 'react';

import { getMyProfile, updateMyProfile } from '@/entities/profile';
import { useSession } from '@/entities/session';
import { describeError } from '@/shared/lib/async';
import { Button, ErrorView, NoticeView, TextField } from '@/shared/ui';

import { setInitialPassword, signOut } from '../api/auth-actions';

interface SetPasswordFormProps {
  /** Người dùng bấm Huỷ — đã đăng xuất, trang đưa về đăng nhập. */
  readonly onCancelled: () => void;
}

/**
 * Cổng "Đặt mật khẩu" cho tài khoản vừa tạo qua Google — bản web của
 * src/app/set-password.tsx. Supabase tạo tài khoản ngay lúc Google trả về; đây là
 * bước xác nhận. Huỷ = đăng xuất, tài khoản trống còn đó; lần sau đăng nhập
 * Google chưa có mật khẩu thì quay lại đây, có rồi thì vào app.
 */
export function SetPasswordForm({ onCancelled }: SetPasswordFormProps) {
  const { session, markPasswordSet } = useSession();
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

  // Tên điền sẵn (trigger lấy tên Google). Đọc hỏng thì để trống — không chặn.
  useEffect(() => {
    let active = true;
    getMyProfile()
      .then((profile) => {
        if (!active) return;
        setDisplayName((current) => (current === '' ? profile.displayName : current));
        setPaymentNote(profile.paymentNote ?? '');
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const mismatch = confirm !== '' && confirm !== password;
  const canSubmit = password.length >= 6 && confirm === password && displayName.trim() !== '' && !busy;

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!canSubmit || cancelling) return;
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
    // Mật khẩu đã đặt. Lưu tên hỏng thì ở lại báo (vào app ngay thì trang này bị
    // gỡ và cảnh báo không bao giờ hiện) — người dùng bấm "Vào app".
    try {
      await updateMyProfile({ displayName, paymentNote });
    } catch (caught) {
      setNameWarning(
        `Đã đặt mật khẩu, nhưng chưa lưu được tên: ${describeError(caught)}. Bạn sửa lại ở trang Hồ sơ.`,
      );
      setPasswordSaved(true);
      setBusy(false);
      return;
    }
    // Guard thấy needsPassword = false sẽ tự đưa vào app (về ?next nếu có).
    setBusy(false);
    markPasswordSet();
  };

  const cancel = async (): Promise<void> => {
    setCancelling(true);
    try {
      await signOut();
    } catch {
      // signOut đã tự xoá phiên trên máy khi máy chủ lỗi.
    } finally {
      setCancelling(false);
      onCancelled();
    }
  };

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4" noValidate>
      <NoticeView
        tone="info"
        message={`Chưa có tài khoản DivvyUp nào dùng ${email || 'email Google này'}. Đặt mật khẩu để tạo tài khoản — sau đó bạn đăng nhập được bằng Google hoặc bằng email và mật khẩu.`}
      />
      <TextField label="Email" type="email" value={email} readOnly autoComplete="username" />
      <TextField
        label="Tên hiển thị"
        value={displayName}
        onChange={(event) => setDisplayName(event.target.value)}
        placeholder="Tên bạn muốn người khác thấy"
        autoComplete="nickname"
      />
      <TextField
        label="Mật khẩu"
        type="password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        placeholder="Ít nhất 6 ký tự"
        autoComplete="new-password"
      />
      <TextField
        label="Nhập lại mật khẩu"
        type="password"
        value={confirm}
        onChange={(event) => setConfirm(event.target.value)}
        autoComplete="new-password"
        error={mismatch ? 'Mật khẩu nhập lại không khớp.' : null}
      />
      {error ? <ErrorView message={error} /> : null}
      {nameWarning ? <NoticeView tone="info" message={nameWarning} /> : null}
      {passwordSaved ? (
        <Button label="Vào app" onClick={markPasswordSet} />
      ) : (
        <>
          <Button type="submit" label="Tạo mật khẩu và vào app" disabled={!canSubmit || cancelling} busy={busy} />
          <Button label="Huỷ" variant="ghost" onClick={() => void cancel()} disabled={busy} busy={cancelling} />
        </>
      )}
    </form>
  );
}
