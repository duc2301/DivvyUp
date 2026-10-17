import { useState } from 'react';

import type { TripMember } from '@/entities/member';
import { removeUnclaimedMember } from '@/entities/member';
import { describeError } from '@/shared/lib/async';
import { ConfirmDialog } from '@/shared/ui';

interface RemoveMemberDialogProps {
  readonly tripId: string;
  /** Chỗ đang hỏi xoá; null = đóng. */
  readonly member: TripMember | null;
  readonly onClose: () => void;
  readonly onRemoved: () => void;
}

/**
 * Hỏi rồi xoá chỗ thành viên chưa nhận. Còn trong khoản chi/tất toán thì báo số
 * khoản ngay trong hộp thoại và không xoá — DB (trigger guard_trip_member_changes)
 * chặn lại lần nữa, kể cả luật "chỉ chủ chuyến".
 */
export function RemoveMemberDialog({ tripId, member, onClose, onRemoved }: RemoveMemberDialogProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Giữ tên lúc hộp thoại đang đóng dần (member đã về null).
  const [shown, setShown] = useState<TripMember | null>(null);
  if (member && member !== shown) {
    setShown(member);
    setError(null);
  }

  const close = (): void => {
    setError(null);
    onClose();
  };

  const confirm = async (): Promise<void> => {
    if (!member) return;
    setBusy(true);
    setError(null);
    try {
      await removeUnclaimedMember(member.id, tripId, member.displayName);
      onRemoved();
      onClose();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ConfirmDialog
      open={member !== null}
      title={error ? 'Chưa xoá được' : 'Xoá thành viên?'}
      message={
        error ??
        `"${shown?.displayName ?? ''}" chưa có ai nhận chỗ. Xoá khỏi chuyến thì tên này không còn trong danh sách, chia đều hay link mời nữa.`
      }
      // Bị chặn thì bấm lại cũng vô ích — nút chỉ để đóng.
      confirmLabel={error ? 'Đã hiểu' : 'Xoá'}
      destructive={error === null}
      busy={busy}
      onConfirm={() => (error ? close() : void confirm())}
      onCancel={close}
    />
  );
}
