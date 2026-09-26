import type { TripMember } from '../api';

/** Chip trạng thái: Bạn / Đã vào app / Chưa nhận. */
export function MemberStatusChip({ member }: { readonly member: TripMember }) {
  if (member.isMe) {
    return (
      <span className="rounded-full bg-accent px-2.5 py-1 text-xs font-semibold text-accent-foreground">
        Bạn
      </span>
    );
  }
  if (member.claimed) {
    return (
      <span className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
        Đã vào app
      </span>
    );
  }
  return (
    <span className="rounded-full border border-dashed border-border px-2.5 py-1 text-xs text-muted-foreground">
      Chưa nhận
    </span>
  );
}
