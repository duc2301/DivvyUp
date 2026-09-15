/**
 * Tầng truy cập dữ liệu — nhóm và thành viên.
 *
 * Mọi truy vấn Supabase phải nằm ở tầng này, không rải rác trong component.
 * Lý do: khi cần đổi cách lấy dữ liệu, thêm cache, hay xử lý offline, chỉ phải
 * sửa một chỗ — và còn có chỗ để kiểm bất biến trước khi dữ liệu vào UI.
 */

import type { CurrencyCode } from '@/lib/money';
import { isCurrencyCode } from '@/lib/money';
import { supabase } from '@/lib/supabase/client';
import type { GroupRole } from '@/lib/supabase/database.types';
import { DataError, unwrap, unwrapVoid } from '@/lib/supabase/errors';

export interface GroupSummary {
  readonly id: string;
  readonly name: string;
  readonly currency: CurrencyCode;
}

export interface GroupMember {
  readonly userId: string;
  readonly displayName: string;
  readonly role: GroupRole;
}

export function parseCurrency(value: string): CurrencyCode {
  if (!isCurrencyCode(value)) {
    throw new DataError(
      `Nhóm dùng đơn vị tiền tệ "${value}" mà app chưa hỗ trợ. ` +
        'Bổ sung nó vào src/lib/money/currency.ts trước.',
    );
  }
  return value;
}

/** Các nhóm mà người đang đăng nhập là thành viên. RLS lo phần lọc. */
export async function listGroups(): Promise<GroupSummary[]> {
  const rows = unwrap(
    await supabase
      .from('groups')
      .select('id, name, currency')
      .is('deleted_at', null)
      .order('updated_at', { ascending: false }),
  );

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    currency: parseCurrency(row.currency),
  }));
}

export async function createGroup(name: string, currency: CurrencyCode): Promise<string> {
  const trimmed = name.trim();
  if (trimmed === '') {
    throw new DataError('Tên nhóm không được để trống.');
  }

  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) {
    throw new DataError('Bạn cần đăng nhập để tạo nhóm.');
  }

  // Trigger groups_add_creator_as_owner tự thêm người tạo làm chủ nhóm,
  // nên không cần insert group_members ở đây.
  const rows = unwrap(
    await supabase
      .from('groups')
      .insert({ name: trimmed, currency, created_by: userId })
      .select('id'),
  );

  const created = rows[0];
  if (!created) {
    throw new DataError('Tạo nhóm không thành công.');
  }
  return created.id;
}

/**
 * Thành viên còn hoạt động của một nhóm.
 *
 * Cố ý dùng hai truy vấn thay vì một câu lồng `profiles(display_name)`:
 * kiểu dữ liệu viết tay ở database.types.ts không khai Relationships, nên
 * PostgREST embed sẽ mất kiểu. Khi nào sinh type bằng `supabase gen types`
 * thì gộp lại thành một truy vấn.
 */
export async function listGroupMembers(groupId: string): Promise<GroupMember[]> {
  const members = unwrap(
    await supabase
      .from('group_members')
      .select('user_id, role')
      .eq('group_id', groupId)
      .is('left_at', null),
  );

  if (members.length === 0) return [];

  const profiles = unwrap(
    await supabase
      .from('profiles')
      .select('id, display_name')
      .in(
        'id',
        members.map((member) => member.user_id),
      ),
  );

  const nameById = new Map(profiles.map((profile) => [profile.id, profile.display_name]));

  return members
    .map((member) => ({
      userId: member.user_id,
      // Hồ sơ có thể chưa kịp tạo hoặc bị RLS ẩn — không để UI hiện "undefined".
      displayName: nameById.get(member.user_id) ?? 'Thành viên',
      role: member.role,
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName, 'vi'));
}

/** Rời nhóm: xoá mềm để giữ nguyên lịch sử công nợ. */
export async function leaveGroup(groupId: string, userId: string): Promise<void> {
  unwrapVoid(
    await supabase
      .from('group_members')
      .update({ left_at: new Date().toISOString() })
      .eq('group_id', groupId)
      .eq('user_id', userId),
  );
}
