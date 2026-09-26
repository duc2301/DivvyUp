import type { TripMember } from '../api';

/** Người trong một giao dịch: tên + ảnh, chỗ chưa ai nhận thì avatar viền đứt. */
export interface MemberPerson {
  readonly name: string;
  readonly avatarUrl: string | null;
  readonly pending: boolean;
}

export interface MemberLookup {
  readonly byId: (memberId: string) => TripMember | undefined;
  readonly nameOf: (memberId: string) => string;
  readonly personOf: (memberId: string) => MemberPerson;
  readonly me: TripMember | undefined;
}

/** Tra cứu thành viên theo id, với tên mặc định giống mobile ("Không rõ"). */
export function memberLookup(
  members: readonly TripMember[],
  unknownName = 'Không rõ',
): MemberLookup {
  const map = new Map(members.map((member) => [member.id, member]));
  const byId = (memberId: string) => map.get(memberId);
  return {
    byId,
    nameOf: (memberId) => byId(memberId)?.displayName ?? unknownName,
    personOf: (memberId) => {
      const member = byId(memberId);
      return {
        name: member?.displayName ?? unknownName,
        avatarUrl: member?.avatarUrl ?? null,
        pending: !member?.claimed,
      };
    },
    me: members.find((member) => member.isMe),
  };
}
