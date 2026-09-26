import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router';

import type { TripMember } from '@/entities/member';
import { MemberStatusChip } from '@/entities/member';
import { Avatar } from '@/shared/ui';

interface MembersPanelProps {
  readonly members: readonly TripMember[];
  readonly manageHref: string;
}

/** Tab Thành viên trên màn chuyến đi: danh sách gọn + lối vào trang quản lý. */
export function MembersPanel({ members, manageHref }: MembersPanelProps) {
  return (
    <div className="flex flex-col gap-3">
      <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        {members.length === 0 ? (
          <p className="text-sm text-muted-foreground">Chưa có ai.</p>
        ) : (
          <ul>
            {members.map((member) => (
              <li key={member.id} className="flex items-center gap-3 py-2">
                <Avatar name={member.displayName} uri={member.avatarUrl} pending={!member.claimed} />
                <span className="min-w-0 flex-1 truncate text-base text-foreground">{member.displayName}</span>
                <MemberStatusChip member={member} />
              </li>
            ))}
          </ul>
        )}
      </section>
      <Link
        to={manageHref}
        className="flex min-h-12 items-center justify-between rounded-2xl border border-border bg-card px-4 py-3.5 text-base font-medium text-foreground shadow-sm hover:bg-muted/40 active:bg-muted">
        Quản lý thành viên & nhóm
        <ChevronRight size={20} className="text-muted-foreground" aria-hidden />
      </Link>
    </div>
  );
}
