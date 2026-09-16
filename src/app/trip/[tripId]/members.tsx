import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { FlatList, Text, TextInput, View } from 'react-native';

import { AppHeader } from '@/components/ui/app-header';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { SectionCard } from '@/components/ui/section-card';
import { ErrorView, LoadingView } from '@/components/ui/state-views';
import { TextField } from '@/components/ui/text-field';
import type { TripGroup, TripMember } from '@/lib/data/trips';
import {
  addTripMember,
  createTripGroup,
  listTripGroups,
  listTripMembers,
  renameTripMember,
} from '@/lib/data/manager';
import { describeError, useAsync } from '@/lib/data/use-async';

interface MemberRowProps {
  readonly member: TripMember;
  /** Trả về false nếu lưu thất bại. */
  readonly onRename: (id: string, name: string) => Promise<boolean>;
}

/**
 * Một dòng thành viên: chỉ đổi được tên.
 *
 * KHÔNG có nút xoá, có chủ đích. Người đã gắn với khoản chi mà biến mất thì
 * phần nợ của họ cũng biến mất theo, tổng số dư của chuyến lệch khỏi 0. DB cũng
 * chặn việc này (migration 20260916_1040), nút ở đây chỉ để khỏi mời người dùng
 * vào một lỗi chắc chắn.
 */
function MemberRow({ member, onRename }: MemberRowProps) {
  const [draft, setDraft] = useState(member.displayName);

  return (
    <View className="flex-row items-center py-2">
      <TextInput
        value={draft}
        onChangeText={setDraft}
        // Lưu khi rời ô thay vì lưu từng ký tự: gõ một cái tên sẽ thành cả chục
        // lượt gọi mạng, và mỗi lượt đều có thể lỗi giữa chừng.
        onBlur={() => {
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
        accessibilityLabel={`Tên của ${member.displayName}`}
        className="min-h-11 min-w-0 flex-1 rounded-xl px-2 text-base text-foreground"
      />

      {member.isMe ? (
        <Text className="rounded-lg bg-accent px-2 py-1 text-xs font-semibold text-accent-foreground">
          bạn
        </Text>
      ) : member.claimed ? (
        <Text className="rounded-lg bg-muted px-2 py-1 text-xs text-muted-foreground">
          đã vào app
        </Text>
      ) : null}
    </View>
  );
}

export default function TripMembersScreen() {
  const params = useLocalSearchParams<{ tripId?: string | string[] }>();
  const tripId = Array.isArray(params.tripId) ? params.tripId[0] : params.tripId;

  const [groupName, setGroupName] = useState('');
  const [groupSize, setGroupSize] = useState('4');
  const [memberName, setMemberName] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const { data, error, loading, reload } = useAsync(async () => {
    if (!tripId) throw new Error('Thiếu mã chuyến đi.');
    const [groups, members] = await Promise.all([listTripGroups(tripId), listTripMembers(tripId)]);
    return { groups, members };
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

  const size = Number(groupSize);
  const sizeValid = Number.isInteger(size) && size >= 0 && size <= 100;

  const membersOf = (group: TripGroup | null): TripMember[] =>
    (data?.members ?? []).filter((member) =>
      group === null ? member.groupId === null : member.groupId === group.id,
    );

  const ungrouped = membersOf(null);

  return (
    <>
      <Screen header={<AppHeader title="Thành viên" subtitle="Nhóm và người trong chuyến" showBack />} scroll={false}>
        <FlatList
          className="flex-1 px-4 pt-2 pb-24"
          contentContainerStyle={{ gap: 16 }}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            <>
              {loading && data === null ? <LoadingView /> : null}
              {error ? <ErrorView message={error} onRetry={reload} /> : null}
              {actionError ? <ErrorView message={actionError} /> : null}

              {data ? (
                <>
                  {data.groups.map((group) => (
                    <SectionCard key={group.id} title={group.name}>
                      {membersOf(group).length === 0 ? (
                        <Text className="text-sm text-muted-foreground">Nhóm này chưa có ai.</Text>
                      ) : (
                        membersOf(group).map((member) => (
                          <MemberRow
                            key={member.id}
                            member={member}
                            onRename={(id, name) => run(() => renameTripMember(id, name))}
                          />
                        ))
                      )}
                    </SectionCard>
                  ))}

                  {ungrouped.length > 0 || data.groups.length === 0 ? (
                    <SectionCard title={data.groups.length === 0 ? 'Thành viên' : 'Chưa thuộc nhóm nào'}>
                      {ungrouped.length === 0 ? (
                        <Text className="text-sm text-muted-foreground">Chưa có ai.</Text>
                      ) : (
                        ungrouped.map((member) => (
                          <MemberRow
                            key={member.id}
                            member={member}
                            onRename={(id, name) => run(() => renameTripMember(id, name))}
                          />
                        ))
                      )}
                    </SectionCard>
                  ) : null}

                  <SectionCard
                    title="Thêm một người"
                    hint="Người này chưa cần cài app. Gửi mã mời sau để họ nhận đúng tên của mình. Thành viên đã thêm chỉ đổi được tên, không xoá được — vì họ có thể đang gắn với khoản chi.">
                    <View className="gap-3">
                      <TextField
                        label="Tên"
                        value={memberName}
                        onChangeText={setMemberName}
                        placeholder="Nguyễn Văn A"
                        autoCapitalize="words"
                      />
                      <Button
                        label="Thêm"
                        variant="secondary"
                        disabled={memberName.trim() === '' || busy || !tripId}
                        onPress={() =>
                          void run(async () => {
                            await addTripMember(tripId!, memberName);
                            setMemberName('');
                          })
                        }
                      />
                    </View>
                  </SectionCard>

                  <SectionCard
                    title="Tạo nhóm"
                    hint="Khai sẵn số người là có ngay từng ấy chỗ trống để đặt tên.">
                    <View className="gap-3">
                      <TextField
                        label="Tên nhóm"
                        value={groupName}
                        onChangeText={setGroupName}
                        placeholder="Xe 1"
                        autoCapitalize="sentences"
                      />
                      <TextField
                        label="Số người"
                        value={groupSize}
                        onChangeText={setGroupSize}
                        keyboardType="number-pad"
                        inputMode="numeric"
                        error={sizeValid ? null : 'Nhập số nguyên từ 0 tới 100.'}
                      />
                      <Button
                        label="Tạo nhóm"
                        variant="secondary"
                        disabled={groupName.trim() === '' || !sizeValid || busy || !tripId}
                        onPress={() =>
                          void run(async () => {
                            await createTripGroup(tripId!, groupName, size);
                            setGroupName('');
                          })
                        }
                      />
                    </View>
                  </SectionCard>
                </>
              ) : null}
            </>
          }
          data={[]}
          renderItem={() => null}
        />
      </Screen>
    </>
  );
}
