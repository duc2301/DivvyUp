import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, Share, Text, TextInput, View } from 'react-native';

import { AppHeader } from '@/components/ui/app-header';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { ArrowRightLeft, Minus, Plus, Share2, Users } from '@/components/ui/icons';
import { PickerModal } from '@/components/ui/picker-modal';
import { Screen } from '@/components/ui/screen';
import { ErrorView, LoadingView } from '@/components/ui/state-views';
import { TextField } from '@/components/ui/text-field';
import {
  addTripMember,
  createTripGroup,
  getTrip,
  listTripGroups,
  listTripMembers,
  moveMemberToGroup,
  renameTripMember,
} from '@/lib/data/manager';
import type { TripGroup, TripMember } from '@/lib/data/trips';
import { describeError, useAsync } from '@/lib/data/use-async';

const MAX_GROUP_SIZE = 100;

// ---------------------------------------------------------------------------
// Một dòng thành viên
// ---------------------------------------------------------------------------

interface MemberRowProps {
  readonly member: TripMember;
  readonly isLast: boolean;
  readonly canMove: boolean;
  readonly canInvite: boolean;
  /** Trả về false nếu lưu thất bại. */
  readonly onRename: (id: string, name: string) => Promise<boolean>;
  readonly onMove: (member: TripMember) => void;
}

/** Trạng thái ghi thành dòng phụ dưới tên — không chiếm chỗ ngang của ô tên. */
function StatusLine({
  member,
  canInvite,
}: {
  readonly member: TripMember;
  readonly canInvite: boolean;
}) {
  if (member.isMe) {
    return <Text className="px-2 text-xs font-semibold text-accent-strong">Bạn</Text>;
  }
  if (member.claimed) {
    return <Text className="px-2 text-xs text-muted-foreground">Đã vào app</Text>;
  }
  return <Text className="px-2 text-xs text-muted-foreground">{canInvite ? 'Chưa nhận chỗ · gửi mã mời' : 'Chưa có tài khoản'}</Text>;
}

/**
 * Tên sửa trực tiếp tại chỗ, lưu khi rời ô.
 *
 * KHÔNG có nút xoá, có chủ đích: người đã gắn với khoản chi mà biến mất thì tổng
 * số dư của chuyến lệch khỏi 0. DB cũng chặn việc này.
 */
function MemberRow({ member, isLast, canMove, canInvite, onRename, onMove }: MemberRowProps) {
  const [draft, setDraft] = useState(member.displayName);
  const [focused, setFocused] = useState(false);

  return (
    <View
      className={`flex-row items-center gap-3 py-2.5 ${isLast ? '' : 'border-b border-border'}`}>
      <Avatar name={draft || member.displayName} uri={member.avatarUrl} pending={!member.claimed} />

      {/* Tên chiếm trọn phần giữa, trạng thái nằm bên dưới. Để chip trạng thái
          cùng hàng thì trên màn 360dp ô tên chỉ còn ~90dp, tên tiếng Việt bình
          thường đã bị cắt. */}
      <View className="min-w-0 flex-1">
        <TextInput
          value={draft}
          onChangeText={setDraft}
          onFocus={() => setFocused(true)}
          // Lưu khi rời ô thay vì từng ký tự: gõ một cái tên sẽ thành cả chục lượt
          // gọi mạng, và mỗi lượt đều có thể lỗi giữa chừng.
          onBlur={() => {
            setFocused(false);
            const trimmed = draft.trim();
            if (trimmed !== '' && trimmed !== member.displayName) {
              // Lỗi thì trả ô về tên cũ — không thì ô hiện tên mới như đã lưu.
              void onRename(member.id, trimmed).then((saved) => {
                if (!saved) setDraft(member.displayName);
              });
            } else {
              setDraft(member.displayName);
            }
          }}
          maxLength={80}
          accessibilityLabel={`Tên của ${member.displayName}, chạm để sửa`}
          className={`min-h-10 min-w-0 rounded-xl px-2 text-base text-foreground ${
            focused ? 'border border-input bg-muted' : 'border border-transparent'
          }`}
        />
        <StatusLine member={member} canInvite={canInvite} />
      </View>

      {canMove ? (
        <IconButton
          icon={ArrowRightLeft}
          label={`Chuyển ${member.displayName} sang nhóm khác`}
          onPress={() => onMove(member)}
        />
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Ô thêm người, nằm cuối mỗi thẻ nhóm
// ---------------------------------------------------------------------------

function AddMemberRow({
  placeholder,
  busy,
  onAdd,
}: {
  readonly placeholder: string;
  readonly busy: boolean;
  /** Trả về true nếu thêm thành công — khi đó ô được xoá trắng. */
  readonly onAdd: (name: string) => Promise<boolean>;
}) {
  const [name, setName] = useState('');
  const canAdd = name.trim() !== '' && !busy;

  const submit = async (): Promise<void> => {
    if (!canAdd) return;
    if (await onAdd(name)) setName('');
  };

  return (
    <View className="mt-3 flex-row items-center gap-2">
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder={placeholder}
        autoCapitalize="words"
        maxLength={80}
        returnKeyType="done"
        onSubmitEditing={() => void submit()}
        accessibilityLabel={placeholder}
        className="min-h-11 min-w-0 flex-1 rounded-xl border border-input bg-muted px-3 text-base text-foreground"
      />
      <IconButton
        icon={Plus}
        label="Thêm người"
        variant="primary"
        disabled={!canAdd}
        onPress={() => void submit()}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Thẻ nhóm
// ---------------------------------------------------------------------------

function GroupCard({
  title,
  members,
  canMove,
  canInvite,
  busy,
  onRename,
  onMove,
  onAdd,
}: {
  readonly title: string;
  readonly members: readonly TripMember[];
  readonly canMove: boolean;
  readonly canInvite: boolean;
  readonly busy: boolean;
  readonly onRename: (id: string, name: string) => Promise<boolean>;
  readonly onMove: (member: TripMember) => void;
  readonly onAdd: (name: string) => Promise<boolean>;
}) {
  return (
    <View className="rounded-3xl border border-border bg-card px-4 pb-4 pt-3">
      <View className="flex-row items-center justify-between py-1">
        <Text numberOfLines={1} className="min-w-0 flex-1 text-base font-semibold text-foreground">
          {title}
        </Text>
        <Text className="rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground">
          {members.length} người
        </Text>
      </View>

      {members.length === 0 ? (
        <Text className="py-3 text-sm text-muted-foreground">Chưa có ai trong nhóm này.</Text>
      ) : (
        <View className="mt-1">
          {members.map((member, index) => (
            <MemberRow
              // key gồm cả tên: đổi tên thành công rồi reload thì ô nhận tên mới
              // từ server thay vì giữ bản nháp cũ.
              key={`${member.id}:${member.displayName}`}
              member={member}
              isLast={index === members.length - 1}
              canMove={canMove}
              canInvite={canInvite}
              onRename={onRename}
              onMove={onMove}
            />
          ))}
        </View>
      )}

      <AddMemberRow placeholder="Thêm người vào nhóm này" busy={busy} onAdd={onAdd} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Màn hình
// ---------------------------------------------------------------------------

export default function TripMembersScreen() {
  const params = useLocalSearchParams<{ tripId?: string | string[] }>();
  const tripId = Array.isArray(params.tripId) ? params.tripId[0] : params.tripId;

  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [groupSize, setGroupSize] = useState(4);
  const [moving, setMoving] = useState<TripMember | null>(null);

  const { data, error, loading, reload } = useAsync(async () => {
    if (!tripId) throw new Error('Thiếu mã chuyến đi.');
    const [trip, groups, members] = await Promise.all([
      getTrip(tripId),
      listTripGroups(tripId),
      listTripMembers(tripId),
    ]);
    return { trip, groups, members };
  }, [tripId]);

  const run = async (task: () => Promise<unknown>): Promise<boolean> => {
    setBusy(true);
    setActionError(null);
    try {
      await task();
      reload();
      return true;
    } catch (caught) {
      setActionError(describeError(caught));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const rename = (id: string, name: string): Promise<boolean> =>
    run(() => renameTripMember(id, name));

  const addTo =
    (groupId: string | null) =>
    (name: string): Promise<boolean> =>
      tripId ? run(() => addTripMember(tripId, name, groupId)) : Promise.resolve(false);

  const membersOf = (group: TripGroup | null): TripMember[] =>
    (data?.members ?? []).filter((member) =>
      group === null ? member.groupId === null : member.groupId === group.id,
    );

  const submitGroup = async (): Promise<void> => {
    if (!tripId || groupName.trim() === '') return;
    const ok = await run(() => createTripGroup(tripId, groupName, groupSize));
    if (ok) {
      setGroupName('');
      setGroupSize(4);
      setCreatingGroup(false);
    }
  };

  const shareInvite = (): void => {
    if (!data || data.trip.joinCode === '') return;
    void Share.share({
      message: `Tham gia chuyến "${data.trip.name}" trên DivvyUp: mở app → Tham gia bằng mã mời → nhập mã ${data.trip.joinCode}`,
    }).catch(() => undefined);
  };

  const ungrouped = membersOf(null);
  const hasGroups = (data?.groups.length ?? 0) > 0;
  const canInvite = (data?.trip.joinCode ?? '') !== '';
  const memberCount = data?.members.length ?? 0;

  return (
    <>
      <Screen
        header={
          <AppHeader
            title="Thành viên"
            subtitle={data ? `${memberCount} người · ${data.groups.length} nhóm` : undefined}
            showBack
          />
        }>
        {loading && data === null ? <LoadingView /> : null}
        {error ? <ErrorView message={error} onRetry={reload} /> : null}
        {actionError ? <ErrorView message={actionError} /> : null}

        {data ? (
          <>
            {data.trip.joinCode !== '' ? (
              <View className="flex-row items-center gap-3 rounded-3xl bg-primary px-5 py-4">
                <View className="min-w-0 flex-1">
                  <Text className="text-xs font-semibold uppercase tracking-widest text-primary-foreground/80">
                    Mã mời
                  </Text>
                  <Text
                    selectable
                    className="font-display text-2xl tracking-widest text-primary-foreground">
                    {data.trip.joinCode}
                  </Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Gửi mã mời"
                  onPress={shareInvite}
                  className="h-12 w-12 items-center justify-center rounded-full bg-primary-foreground/20 active:opacity-70">
                  <Share2 size={22} className="text-primary-foreground" />
                </Pressable>
              </View>
            ) : (
              <View className="rounded-3xl border border-dashed border-border px-5 py-4">
                <Text className="text-sm text-muted-foreground">
                  Chuyến này lưu trên máy (chế độ khách) nên chưa mời người khác được. Tên, nhóm và
                  khoản chi vẫn quản lý đầy đủ.
                </Text>
              </View>
            )}

            {data.groups.map((group) => (
              <GroupCard
                key={group.id}
                title={group.name}
                members={membersOf(group)}
                canMove
                canInvite={canInvite}
                busy={busy}
                onRename={rename}
                onMove={setMoving}
                onAdd={addTo(group.id)}
              />
            ))}

            {ungrouped.length > 0 || !hasGroups ? (
              <GroupCard
                title={hasGroups ? 'Chưa vào nhóm' : 'Mọi người'}
                members={ungrouped}
                canMove={hasGroups}
                canInvite={canInvite}
                busy={busy}
                onRename={rename}
                onMove={setMoving}
                onAdd={addTo(null)}
              />
            ) : null}

            {creatingGroup ? (
              <View className="gap-4 rounded-3xl border border-border bg-card p-5">
                <Text className="text-base font-semibold text-foreground">Nhóm mới</Text>
                <TextField
                  label="Tên nhóm"
                  value={groupName}
                  onChangeText={setGroupName}
                  placeholder="Xe 1, Phòng A…"
                  autoCapitalize="sentences"
                  autoFocus
                  maxLength={60}
                />
                <View>
                  <Text className="mb-1 text-sm font-medium text-foreground">Số thành viên</Text>
                  <View className="flex-row items-center gap-3">
                    <IconButton
                      icon={Minus}
                      label="Bớt một chỗ"
                      variant="ghost"
                      disabled={groupSize <= 0}
                      onPress={() => setGroupSize((value) => Math.max(0, value - 1))}
                    />
                    <Text
                      accessibilityLiveRegion="polite"
                      className="min-w-12 text-center text-2xl font-semibold text-foreground">
                      {groupSize}
                    </Text>
                    <IconButton
                      icon={Plus}
                      label="Thêm một chỗ"
                      variant="ghost"
                      disabled={groupSize >= MAX_GROUP_SIZE}
                      onPress={() => setGroupSize((value) => Math.min(MAX_GROUP_SIZE, value + 1))}
                    />
                  </View>
                </View>
                <View className="flex-row gap-3">
                  <View className="min-w-0 flex-1">
                    <Button
                      label="Huỷ"
                      variant="secondary"
                      disabled={busy}
                      onPress={() => setCreatingGroup(false)}
                    />
                  </View>
                  <View className="min-w-0 flex-1">
                    <Button
                      label="Tạo nhóm"
                      busy={busy}
                      disabled={groupName.trim() === ''}
                      onPress={() => void submitGroup()}
                    />
                  </View>
                </View>
              </View>
            ) : (
              <Pressable
                accessibilityRole="button"
                onPress={() => setCreatingGroup(true)}
                className="min-h-14 flex-row items-center justify-center gap-2 rounded-3xl border border-dashed border-border active:bg-muted">
                <Users size={20} className="text-primary" />
                <Text className="text-base font-semibold text-primary">Tạo nhóm mới</Text>
              </Pressable>
            )}
          </>
        ) : null}
      </Screen>

      <PickerModal
        visible={moving !== null}
        title={moving ? `Chuyển ${moving.displayName} sang` : ''}
        items={[
          ...(data?.groups ?? []).map((group) => ({
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
          void run(() => moveMemberToGroup(member.id, value === '__none__' ? null : value));
        }}
        onClose={() => setMoving(null)}
      />
    </>
  );
}
