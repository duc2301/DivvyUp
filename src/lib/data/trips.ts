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
import type { Database, TripRole } from '@/lib/supabase/database.types';
import { DataError, unwrap, unwrapVoid } from '@/lib/supabase/errors';

import { avatarUrlFromPath } from './profile';

/** Điểm đến của chuyến đi, chọn từ Mapbox. */
export interface TripPlace {
  readonly name: string;
  readonly address: string | null;
  readonly country: string | null;
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly provider: string | null;
  readonly externalId: string | null;
}

/** Ảnh bìa. credit và link là BẮT BUỘC hiển thị khi nguồn là Unsplash. */
export interface TripCoverImage {
  readonly url: string;
  readonly thumbUrl: string;
  readonly credit: string | null;
  readonly link: string | null;
  readonly provider: string | null;
}

/** Bộ ảnh bìa kèm ảnh đang được chọn. */
export interface TripCoverGallery {
  readonly images: readonly TripCoverImage[];
  /** Vị trí ảnh đang hiển thị. Luôn hợp lệ nếu images không rỗng. */
  readonly index: number;
}

export interface TripSummary {
  readonly id: string;
  readonly name: string;
  readonly currency: CurrencyCode;
  readonly startDate: string | null;
  readonly endDate: string | null;
  readonly joinCode: string;
  /** Gom các cột phẳng ở DB thành object: màn hình chỉ cần hỏi "có hay không". */
  readonly place: TripPlace | null;
  readonly cover: TripCoverGallery;
}

/** Ảnh đang hiển thị, hoặc null nếu chuyến đi chưa có ảnh nào. */
export function currentCover(cover: TripCoverGallery): TripCoverImage | null {
  return cover.images[cover.index] ?? cover.images[0] ?? null;
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
  /** Tài khoản đã nhận chỗ này, null nếu chưa ai nhận (hoặc chế độ khách). */
  readonly userId: string | null;
  /** Ảnh đại diện của tài khoản đã nhận chỗ; chỗ chưa ai nhận thì luôn null. */
  readonly avatarUrl: string | null;
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

// PHẢI là một chuỗi literal duy nhất, KHÔNG nối bằng dấu +.
// supabase-js đọc chuỗi select như một kiểu literal để suy ra hình dạng dòng
// trả về; nối chuỗi lúc chạy thì nó mất kiểu và mọi thứ thành GenericStringError.
// prettier-ignore
const TRIP_COLUMNS = 'id, name, currency, start_date, end_date, join_code, place_name, place_address, place_country, latitude, longitude, place_provider, place_external_id, cover_images, cover_image_index';

type TripRow = Database['public']['Tables']['trips']['Row'];

function toTripSummary(row: Pick<
  TripRow,
  | 'id'
  | 'name'
  | 'currency'
  | 'start_date'
  | 'end_date'
  | 'join_code'
  | 'place_name'
  | 'place_address'
  | 'place_country'
  | 'latitude'
  | 'longitude'
  | 'place_provider'
  | 'place_external_id'
  | 'cover_images'
  | 'cover_image_index'
>): TripSummary {
  return {
    id: row.id,
    name: row.name,
    currency: parseCurrency(row.currency),
    startDate: row.start_date,
    endDate: row.end_date,
    joinCode: row.join_code,
    // place_name là cột quyết định: không có tên thì coi như chưa chọn điểm đến,
    // dù các cột khác có sót giá trị cũ.
    place: row.place_name
      ? {
          name: row.place_name,
          address: row.place_address,
          country: row.place_country,
          latitude: row.latitude,
          longitude: row.longitude,
          provider: row.place_provider,
          externalId: row.place_external_id,
        }
      : null,
    cover: {
      // Lọc phần tử thiếu url: một bản ghi hỏng không được làm sập cả màn hình.
      images: (row.cover_images ?? [])
        .filter((image) => typeof image?.url === 'string' && image.url.length > 0)
        .map((image) => ({
          url: image.url,
          thumbUrl: image.thumbUrl || image.url,
          credit: image.credit ?? null,
          link: image.link ?? null,
          provider: image.provider ?? null,
        })),
      index: row.cover_image_index ?? 0,
    },
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
  /** Điểm đến chọn từ màn tìm địa điểm. Để trống thì chọn sau cũng được. */
  readonly place?: TripPlace | null;
  readonly cover?: TripCoverGallery | null;
}

/** Trải object địa điểm và bộ ảnh thành các cột phẳng mà DB dùng. */
function placeColumns(place?: TripPlace | null, cover?: TripCoverGallery | null) {
  const images = cover?.images ?? [];
  // Kẹp chỉ số vào trong mảng: DB có ràng buộc, nhưng chặn ở đây thì lỗi hiện
  // ra dưới dạng ảnh sai chứ không phải cả lệnh ghi bị từ chối.
  const index = images.length === 0 ? 0 : Math.min(Math.max(cover?.index ?? 0, 0), images.length - 1);
  return {
    place_name: place?.name ?? null,
    place_address: place?.address ?? null,
    place_country: place?.country ?? null,
    latitude: place?.latitude ?? null,
    longitude: place?.longitude ?? null,
    place_provider: place?.provider ?? null,
    place_external_id: place?.externalId ?? null,
    cover_images: images.map((image) => ({
      url: image.url,
      thumbUrl: image.thumbUrl,
      credit: image.credit,
      link: image.link,
      provider: image.provider,
    })),
    cover_image_index: index,
  };
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
        ...placeColumns(input.place, input.cover),
      })
      .select('id'),
  );

  const created = rows[0];
  if (!created) {
    throw new DataError('Tạo chuyến đi không thành công.');
  }
  return created.id;
}

/**
 * Đổi điểm đến và ảnh bìa của chuyến đi đã tạo.
 *
 * Truyền null cho cả hai để gỡ bỏ. Ghi cả 11 cột mỗi lần thay vì chỉ ghi cột
 * đổi: bỏ sót một cột sẽ để lại mảnh dữ liệu của địa điểm cũ lẫn vào địa điểm
 * mới — kiểu lỗi rất khó nhìn ra vì màn hình vẫn hiện bình thường.
 */
export async function updateTripPlace(
  tripId: string,
  place: TripPlace | null,
  cover: TripCoverGallery | null,
): Promise<void> {
  const rows = unwrap(
    await supabase.from('trips').update(placeColumns(place, cover)).eq('id', tripId).select('id'),
  );
  assertTripUpdated(rows);
}

/**
 * RLS chỉ cho chủ chuyến sửa bảng trips. Người khác sửa thì PostgREST KHÔNG báo
 * lỗi — nó lọc hết dòng và trả về thành công với 0 dòng. Không kiểm số dòng,
 * thành viên thường chọn địa điểm xong thấy "đã lưu", mở lại vẫn là cũ.
 */
function assertTripUpdated(rows: readonly unknown[]): void {
  if (rows.length === 0) {
    throw new DataError('Chỉ chủ chuyến đi mới đổi được địa điểm và ảnh bìa.', '42501');
  }
}

/** Đổi riêng ảnh đang hiển thị, không đụng tới danh sách hay địa điểm. */
export async function updateCoverIndex(tripId: string, index: number): Promise<void> {
  const rows = unwrap(
    await supabase
      .from('trips')
      .update({ cover_image_index: Math.max(0, index) })
      .eq('id', tripId)
      .select('id'),
  );
  assertTripUpdated(rows);
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
      // Nhúng profile để lấy ảnh đại diện trong CÙNG một truy vấn, thay vì một
      // lượt gọi cho mỗi người. RLS của profiles chỉ trả về người đi chung
      // chuyến, đúng tập người đang được liệt kê ở đây.
      .select('id, display_name, group_id, user_id, role, sort_order, profile:profiles(avatar_path)')
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
    userId: row.user_id,
    avatarUrl: row.user_id !== null ? avatarUrlFromPath(row.profile?.avatar_path) : null,
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
