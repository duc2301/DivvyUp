/**
 * Tầng truy cập dữ liệu — chuyến đi, nhóm, thành viên.
 *
 * Mọi truy vấn Supabase nằm ở tầng này, không rải rác trong component: khi cần
 * thêm cache hay xử lý offline chỉ phải sửa một chỗ, và có chỗ kiểm bất biến
 * trước khi dữ liệu vào UI.
 *
 * Khái niệm quan trọng nhất: `TripMember` KHÔNG phải tài khoản. Nó là một cái
 * tên trong chuyến đi. `userId` là null cho tới khi người đó nhận lời mời.
 */

import type { CurrencyCode } from '@/lib/money';
import { isCurrencyCode } from '@/lib/money';
import { supabase } from '@/lib/supabase/client';
import type { TripRole } from '@/lib/supabase/database.types';
import { DataError, unwrap, unwrapVoid } from '@/lib/supabase/errors';

export interface TripSummary {
  readonly id: string;
  readonly name: string;
  readonly currency: CurrencyCode;
  readonly startDate: string | null;
  readonly endDate: string | null;
  readonly joinCode: string;
}

export interface TripGroup {
  readonly id: string;
  readonly name: string;
  readonly sortOrder: number;
}

export interface TripMember {
  readonly id: string;
  readonly displayName: string;
  readonly groupId: string | null;
  readonly role: TripRole;
  readonly sortOrder: number;
  /** true nếu đã có tài khoản gắn vào chỗ này. */
  readonly claimed: boolean;
  /** true nếu chỗ này là của chính người đang đăng nhập. */
  readonly isMe: boolean;
}

export function parseCurrency(value: string): CurrencyCode {
  if (!isCurrencyCode(value)) {
    throw new DataError(
      `Chuyến đi dùng đơn vị tiền tệ "${value}" mà app chưa hỗ trợ. ` +
        'Bổ sung nó vào src/lib/money/currency.ts trước.',
    );
  }
  return value;
}

async function requireUserId(): Promise<string> {
  const { data } = await supabase.auth.getUser();
  const userId = data.user?.id;
  if (!userId) {
    throw new DataError('Bạn cần đăng nhập để thực hiện thao tác này.');
  }
  return userId;
}

const TRIP_COLUMNS = 'id, name, currency, start_date, end_date, join_code';

function toTripSummary(row: {
  id: string;
  name: string;
  currency: string;
  start_date: string | null;
  end_date: string | null;
  join_code: string;
}): TripSummary {
  return {
    id: row.id,
    name: row.name,
    currency: parseCurrency(row.currency),
    startDate: row.start_date,
    endDate: row.end_date,
    joinCode: row.join_code,
  };
}

/** Các chuyến đi mà người đang đăng nhập có mặt. RLS lo phần lọc. */
export async function listTrips(): Promise<TripSummary[]> {
  const rows = unwrap(
    await supabase
      .from('trips')
      .select(TRIP_COLUMNS)
      .is('deleted_at', null)
      .order('start_date', { ascending: false, nullsFirst: false })
      .order('updated_at', { ascending: false }),
  );
  return rows.map(toTripSummary);
}

export async function getTrip(tripId: string): Promise<TripSummary> {
  const rows = unwrap(
    await supabase.from('trips').select(TRIP_COLUMNS).eq('id', tripId).is('deleted_at', null),
  );
  const found = rows[0];
  if (!found) {
    throw new DataError('Không tìm thấy chuyến đi, hoặc bạn không có quyền xem.');
  }
  return toTripSummary(found);
}

export interface CreateTripInput {
  readonly name: string;
  readonly currency: CurrencyCode;
  readonly startDate?: string | null;
  readonly endDate?: string | null;
}

export async function createTrip(input: CreateTripInput): Promise<string> {
  const name = input.name.trim();
  if (name === '') {
    throw new DataError('Tên chuyến đi không được để trống.');
  }
  if (input.startDate && input.endDate && input.startDate > input.endDate) {
    throw new DataError('Ngày kết thúc phải sau ngày bắt đầu.');
  }

  const createdBy = await requireUserId();

  // Trigger trips_add_creator_as_member tự thêm người tạo làm thành viên đầu
  // tiên với vai trò owner, nên không cần insert trip_members ở đây.
  const rows = unwrap(
    await supabase
      .from('trips')
      .insert({
        name,
        currency: input.currency,
        start_date: input.startDate ?? null,
        end_date: input.endDate ?? null,
        created_by: createdBy,
      })
      .select('id'),
  );

  const created = rows[0];
  if (!created) {
    throw new DataError('Tạo chuyến đi không thành công.');
  }
  return created.id;
}

export async function listTripGroups(tripId: string): Promise<TripGroup[]> {
  const rows = unwrap(
    await supabase
      .from('trip_groups')
      .select('id, name, sort_order')
      .eq('trip_id', tripId)
      .is('deleted_at', null)
      .order('sort_order'),
  );
  return rows.map((row) => ({ id: row.id, name: row.name, sortOrder: row.sort_order }));
}

/**
 * Tạo nhóm kèm sẵn `memberCount` chỗ trống đã đặt tên tạm.
 * Đây là phần "mỗi nhóm thiết đặt sẵn số lượng người" — khai số là có ngay
 * từng ấy dòng để sửa tên, không phải bấm thêm từng người.
 */
export async function createTripGroup(
  tripId: string,
  name: string,
  memberCount: number,
): Promise<string> {
  const trimmed = name.trim();
  if (trimmed === '') {
    throw new DataError('Tên nhóm không được để trống.');
  }
  if (!Number.isInteger(memberCount) || memberCount < 0 || memberCount > 100) {
    throw new DataError('Số người trong nhóm phải là số nguyên từ 0 tới 100.');
  }

  return unwrap(
    await supabase.rpc('create_trip_group', {
      p_trip_id: tripId,
      p_name: trimmed,
      p_member_count: memberCount,
    }),
  );
}

export async function listTripMembers(tripId: string): Promise<TripMember[]> {
  const myUserId = (await supabase.auth.getUser()).data.user?.id ?? null;

  const rows = unwrap(
    await supabase
      .from('trip_members')
      .select('id, display_name, group_id, user_id, role, sort_order')
      .eq('trip_id', tripId)
      .is('removed_at', null)
      .order('sort_order'),
  );

  return rows.map((row) => ({
    id: row.id,
    displayName: row.display_name,
    groupId: row.group_id,
    role: row.role,
    sortOrder: row.sort_order,
    claimed: row.user_id !== null,
    isMe: myUserId !== null && row.user_id === myUserId,
  }));
}

export async function addTripMember(
  tripId: string,
  displayName: string,
  groupId: string | null = null,
): Promise<string> {
  const name = displayName.trim();
  if (name === '') {
    throw new DataError('Tên thành viên không được để trống.');
  }

  const rows = unwrap(
    await supabase
      .from('trip_members')
      .insert({ trip_id: tripId, display_name: name, group_id: groupId })
      .select('id'),
  );

  const created = rows[0];
  if (!created) {
    throw new DataError('Thêm thành viên không thành công.');
  }
  return created.id;
}

export async function renameTripMember(memberId: string, displayName: string): Promise<void> {
  const name = displayName.trim();
  if (name === '') {
    throw new DataError('Tên thành viên không được để trống.');
  }
  unwrapVoid(
    await supabase.from('trip_members').update({ display_name: name }).eq('id', memberId),
  );
}

export async function moveMemberToGroup(
  memberId: string,
  groupId: string | null,
): Promise<void> {
  unwrapVoid(await supabase.from('trip_members').update({ group_id: groupId }).eq('id', memberId));
}

/** Xoá mềm: lịch sử công nợ của người này vẫn giữ nguyên. */
export async function removeTripMember(memberId: string): Promise<void> {
  unwrapVoid(
    await supabase
      .from('trip_members')
      .update({ removed_at: new Date().toISOString() })
      .eq('id', memberId),
  );
}

// ---------------------------------------------------------------------------
// Mời sau — người được mời chưa phải thành viên nên RLS chặn họ đọc mọi thứ.
// Hai hàm dưới đi qua RPC SECURITY DEFINER, chỉ mở khi có mã mời đúng.
// ---------------------------------------------------------------------------

export interface TripPreviewSlot {
  readonly memberId: string;
  readonly memberName: string;
  readonly claimed: boolean;
}

export interface TripPreview {
  readonly tripId: string;
  readonly tripName: string;
  readonly slots: readonly TripPreviewSlot[];
}

export async function previewTripByCode(joinCode: string): Promise<TripPreview> {
  const code = joinCode.trim().toUpperCase();
  if (code === '') {
    throw new DataError('Hãy nhập mã tham gia.');
  }

  const rows = unwrap(await supabase.rpc('preview_trip_by_code', { p_join_code: code }));
  const first = rows[0];
  if (!first) {
    throw new DataError('Mã tham gia không đúng, hoặc chuyến đi đã bị xoá.');
  }

  return {
    tripId: first.trip_id,
    tripName: first.trip_name,
    slots: rows.map((row) => ({
      memberId: row.member_id,
      memberName: row.member_name,
      claimed: row.claimed,
    })),
  };
}

/** Nhận một chỗ trong chuyến đi. Trả về id chuyến đi vừa tham gia. */
export async function joinTripByCode(joinCode: string, memberId: string): Promise<string> {
  return unwrap(
    await supabase.rpc('join_trip_by_code', {
      p_join_code: joinCode.trim().toUpperCase(),
      p_member_id: memberId,
    }),
  );
}
