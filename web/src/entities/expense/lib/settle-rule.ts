/** Hình dạng tối thiểu cần để xét quyền — không phụ thuộc slice member. */
interface MemberLike {
  readonly isMe: boolean;
  readonly claimed: boolean;
  readonly role: string;
}

/**
 * Cùng quy tắc với RPC set_expense_settled (và overview.tsx của mobile): đánh
 * dấu xong = xoá nợ, nên chỉ người đã trả, chủ chuyến, hoặc người ghi khoản
 * chi khi người trả chưa vào app. Bỏ đánh dấu thì ai cũng được. DB vẫn kiểm lại.
 */
export function canMarkSettled(input: {
  readonly me: MemberLike | undefined;
  readonly payer: MemberLike | undefined;
  readonly createdBy: string;
  readonly myUserId: string | null;
}): boolean {
  if (input.me?.role === 'owner') return true;
  if (input.payer?.isMe) return true;
  return input.payer !== undefined && !input.payer.claimed && input.createdBy === input.myUserId;
}
