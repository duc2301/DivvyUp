import { useRef, useState } from 'react';

import type { TripMember } from '@/entities/member';
import { renameTripMember } from '@/entities/member';
import { describeError } from '@/shared/lib/async';

interface MemberNameInputProps {
  readonly member: TripMember;
  /** Tên nháp đổi — để avatar bên cạnh cập nhật chữ cái ngay. */
  readonly onDraftChange?: (draft: string) => void;
  readonly onSaved: () => void;
  readonly onError: (message: string | null) => void;
}

/**
 * Tên sửa tại chỗ, lưu khi rời ô (không gọi mạng theo từng ký tự). Lỗi thì trả
 * ô về tên cũ. KHÔNG có nút xoá thành viên — DB cũng chặn (số dư lệch khỏi 0).
 */
export function MemberNameInput({ member, onDraftChange, onSaved, onError }: MemberNameInputProps) {
  const [draft, setDraft] = useState(member.displayName);
  // Esc đặt cờ này TRƯỚC khi blur: onBlur chạy ngay trong cùng sự kiện, lúc
  // state `draft` chưa kịp đổi — không có cờ thì Esc lại lưu tên đang gõ dở.
  const cancelled = useRef(false);

  const commit = async (): Promise<void> => {
    const trimmed = draft.trim();
    if (cancelled.current || trimmed === '' || trimmed === member.displayName) {
      cancelled.current = false;
      setDraft(member.displayName);
      onDraftChange?.(member.displayName);
      return;
    }
    onError(null);
    try {
      await renameTripMember(member.id, trimmed);
      onSaved();
    } catch (caught) {
      setDraft(member.displayName);
      onDraftChange?.(member.displayName);
      onError(describeError(caught));
    }
  };

  return (
    <input
      value={draft}
      onChange={(event) => {
        setDraft(event.target.value);
        onDraftChange?.(event.target.value);
      }}
      onBlur={() => void commit()}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
        if (event.key === 'Escape') {
          cancelled.current = true;
          event.currentTarget.blur();
        }
      }}
      maxLength={80}
      aria-label={`Tên của ${member.displayName}, chạm để sửa`}
      className="min-h-10 w-full min-w-0 rounded-xl border border-transparent bg-transparent px-2 text-base text-foreground focus:border-input focus:bg-muted"
    />
  );
}
