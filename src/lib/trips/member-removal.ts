/**
 * Xoá chỗ thành viên chưa có người nhận — phần thuần, dùng chung mobile/web và
 * nhánh khách. Không import React Native hay Supabase.
 *
 * Luật (khớp trigger guard_trip_member_changes ở DB — DB là chốt chặn cuối,
 * phần này chỉ để giao diện ẩn nút và báo lý do TRƯỚC khi gọi):
 * - chỉ chủ chuyến xoá được;
 * - chỉ chỗ CHƯA có người nhận (claimed = false) — gỡ một tài khoản không thu
 *   hồi được quyền vì họ vẫn biết mã mời;
 * - không xoá chủ chuyến;
 * - còn dính khoản chi (trả tiền hoặc có phần chia, kể cả khoản đã đánh dấu
 *   xong) hay tất toán còn hiệu lực thì không xoá: người biến mất khỏi khoản chi
 *   cũ làm tổng số dư cả chuyến lệch khỏi 0.
 */

interface RemovableMember {
  readonly role: string;
  readonly claimed: boolean;
}

/** Có hiện nút xoá cho chỗ này không. */
export function canOfferMemberRemoval(member: RemovableMember, viewerIsOwner: boolean): boolean {
  return viewerIsOwner && !member.claimed && member.role !== 'owner';
}

interface ExpenseParticipants {
  readonly id: string;
  readonly paidByMemberId: string;
  readonly shares: readonly { readonly participantId: string }[];
}

/** Số khoản chi (không trùng) mà người này trả tiền hoặc có phần chia. */
export function countMemberExpenses(
  memberId: string,
  expenses: readonly ExpenseParticipants[],
): number {
  return expenses.filter(
    (expense) =>
      expense.paidByMemberId === memberId ||
      expense.shares.some((share) => share.participantId === memberId),
  ).length;
}

export interface MemberUsage {
  readonly expenses: number;
  readonly settlements: number;
}

/** Lý do không cho xoá, hoặc null nếu xoá được. */
export function memberRemovalBlock(name: string, usage: MemberUsage): string | null {
  const parts: string[] = [];
  if (usage.expenses > 0) parts.push(`${usage.expenses} khoản chi`);
  if (usage.settlements > 0) parts.push(`${usage.settlements} lần tất toán`);
  if (parts.length === 0) return null;
  return (
    `Không xoá được "${name}": đang có trong ${parts.join(' và ')}. ` +
    'Bỏ người này khỏi các khoản đó (hoặc xoá khoản chi) rồi xoá lại.'
  );
}

interface GuestMember {
  readonly id: string;
  readonly displayName: string;
  readonly role: string;
  readonly isMe: boolean;
}

/**
 * Chế độ khách: không có DB kiểm lại, nên đây là chốt DUY NHẤT. Giữ chỗ "Bạn"
 * (isMe — người dùng máy này, mặc định người trả) và chỗ chủ chuyến; còn dính
 * khoản chi thì chặn (khách không có tất toán).
 */
export function guestRemovalBlock(member: GuestMember, expenses: readonly ExpenseParticipants[]): string | null {
  if (member.isMe || member.role === 'owner') return 'Không xoá được chỗ của chính bạn.';
  return memberRemovalBlock(member.displayName, {
    expenses: countMemberExpenses(member.id, expenses),
    settlements: 0,
  });
}
