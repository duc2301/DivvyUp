import { ArrowRightLeft, Copy, Share2 } from 'lucide-react';
import { useState } from 'react';

import type { TripGroup, TripMember } from '@/entities/member';
import { moveMemberToGroup } from '@/entities/member';
import type { TripSummary } from '@/entities/trip';
import { AddMemberRow, CreateGroupForm } from '@/features/add-member';
import { MemberNameInput } from '@/features/rename-member';
import { describeError } from '@/shared/lib/async';
import { absoluteUrl, routes } from '@/shared/config';
import { copyText, shareOrCopy } from '@/shared/lib/share';
import { Avatar, ErrorView, IconButton, NoticeView, PickerSheet } from '@/shared/ui';

interface MembersManagerProps {
  readonly trip: TripSummary;
  readonly groups: readonly TripGroup[];
  readonly members: readonly TripMember[];
  readonly onChanged: () => void;
}

function StatusLine({ member }: { readonly member: TripMember }) {
  if (member.isMe) return <p className="px-2 text-xs font-semibold text-accent-strong">Bạn</p>;
  if (member.claimed) return <p className="px-2 text-xs text-muted-foreground">Đã vào app</p>;
  return <p className="px-2 text-xs text-muted-foreground">Chưa nhận chỗ · gửi mã mời</p>;
}

function MemberRow({
  member,
  isLast,
  canMove,
  onMove,
  onSaved,
  onError,
}: {
  readonly member: TripMember;
  readonly isLast: boolean;
  readonly canMove: boolean;
  readonly onMove: (member: TripMember) => void;
  readonly onSaved: () => void;
  readonly onError: (message: string | null) => void;
}) {
  const [draft, setDraft] = useState(member.displayName);
  return (
    <li className={`flex items-center gap-3 py-2.5 ${isLast ? '' : 'border-b border-border'}`}>
      <Avatar name={draft || member.displayName} uri={member.avatarUrl} pending={!member.claimed} />
      <div className="min-w-0 flex-1">
        <MemberNameInput member={member} onDraftChange={setDraft} onSaved={onSaved} onError={onError} />
        <StatusLine member={member} />
      </div>
      {canMove ? (
        <IconButton icon={ArrowRightLeft} label={`Chuyển ${member.displayName} sang nhóm khác`} onClick={() => onMove(member)} />
      ) : null}
    </li>
  );
}

/** Trang Thành viên: mã mời + chia sẻ/copy, thẻ theo nhóm, đổi tên tại chỗ, chuyển nhóm. */
export function MembersManager({ trip, groups, members, onChanged }: MembersManagerProps) {
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [moving, setMoving] = useState<TripMember | null>(null);

  const membersOf = (group: TripGroup | null): TripMember[] =>
    members.filter((member) => (group === null ? member.groupId === null : member.groupId === group.id));
  const ungrouped = membersOf(null);
  const hasGroups = groups.length > 0;
  const inviteUrl = absoluteUrl(routes.join(trip.joinCode));

  const share = async (): Promise<void> => {
    setNotice(null);
    const outcome = await shareOrCopy({
      title: `Tham gia chuyến "${trip.name}"`,
      text: `Tham gia chuyến "${trip.name}" trên DivvyUp: mở link rồi chọn tên của bạn, hoặc nhập mã ${trip.joinCode}.`,
      url: inviteUrl,
    });
    if (outcome === 'copied') setNotice('Đã chép lời mời kèm link vào bộ nhớ tạm.');
    if (outcome === 'failed') setActionError('Không chia sẻ được. Hãy chép mã thủ công.');
  };

  const copyCode = async (): Promise<void> => {
    setNotice(null);
    if (await copyText(trip.joinCode)) setNotice(`Đã chép mã ${trip.joinCode}.`);
    else setActionError('Trình duyệt không cho chép. Hãy chọn và chép mã thủ công.');
  };

  const renderGroup = (key: string, title: string, list: TripMember[], groupId: string | null, canMove: boolean) => (
    <section key={key} className="rounded-3xl border border-border bg-card px-4 pb-4 pt-3 shadow-sm">
      <div className="flex items-center justify-between py-1">
        <h2 className="min-w-0 flex-1 truncate text-base font-semibold text-foreground">{title}</h2>
        <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground">{list.length} người</span>
      </div>
      {list.length === 0 ? (
        <p className="py-3 text-sm text-muted-foreground">Chưa có ai trong nhóm này.</p>
      ) : (
        <ul className="mt-1">
          {list.map((member, index) => (
            <MemberRow
              // key gồm cả tên: đổi tên xong tải lại thì ô nhận tên mới từ máy chủ.
              key={`${member.id}:${member.displayName}`}
              member={member}
              isLast={index === list.length - 1}
              canMove={canMove}
              onMove={setMoving}
              onSaved={onChanged}
              onError={setActionError}
            />
          ))}
        </ul>
      )}
      <AddMemberRow
        tripId={trip.id}
        groupId={groupId}
        placeholder="Thêm người vào nhóm này"
        onAdded={onChanged}
        onError={setActionError}
      />
    </section>
  );

  return (
    <>
      {actionError ? <ErrorView message={actionError} /> : null}
      {notice ? <NoticeView tone="success" message={notice} /> : null}

      <div className="flex items-center gap-3 rounded-3xl bg-primary px-5 py-4 text-primary-foreground">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-widest text-primary-foreground/80">Mã mời</p>
          <p className="select-all font-display text-2xl font-semibold tracking-widest">{trip.joinCode}</p>
        </div>
        <button
          type="button"
          aria-label="Chép mã mời"
          onClick={() => void copyCode()}
          className="flex h-12 w-12 items-center justify-center rounded-full bg-primary-foreground/20 active:opacity-70">
          <Copy size={20} aria-hidden />
        </button>
        <button
          type="button"
          aria-label="Gửi mã mời"
          onClick={() => void share()}
          className="flex h-12 w-12 items-center justify-center rounded-full bg-primary-foreground/20 active:opacity-70">
          <Share2 size={22} aria-hidden />
        </button>
      </div>

      {groups.map((group) => renderGroup(group.id, group.name, membersOf(group), group.id, true))}
      {ungrouped.length > 0 || !hasGroups
        ? renderGroup('__none__', hasGroups ? 'Chưa vào nhóm' : 'Mọi người', ungrouped, null, hasGroups)
        : null}

      <CreateGroupForm tripId={trip.id} onCreated={onChanged} onError={setActionError} />

      <PickerSheet
        open={moving !== null}
        title={moving ? `Chuyển ${moving.displayName} sang` : ''}
        items={[
          ...groups.map((group) => ({
            value: group.id,
            label: group.name,
            detail: moving?.groupId === group.id ? 'đang ở đây' : undefined,
            disabled: moving?.groupId === group.id,
          })),
          {
            value: '__none__',
            label: 'Không thuộc nhóm nào',
            detail: moving?.groupId === null ? 'đang ở đây' : undefined,
            disabled: moving?.groupId === null,
          },
        ]}
        onSelect={(value) => {
          const member = moving;
          setMoving(null);
          if (!member) return;
          setActionError(null);
          moveMemberToGroup(member.id, value === '__none__' ? null : value)
            .then(onChanged)
            .catch((caught: unknown) => setActionError(describeError(caught)));
        }}
        onClose={() => setMoving(null)}
      />
    </>
  );
}
