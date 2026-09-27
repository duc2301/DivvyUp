/**
 * Tầng truy cập dữ liệu — lưu trữ chuyến đi CÁ NHÂN (bảng trip_archives).
 *
 * Mỗi dòng là "người này đã cất chuyến kia khỏi danh sách chính của mình". RLS
 * chỉ trả và chỉ cho xoá dòng của chính người đang đăng nhập, nên không cần lọc
 * theo user_id ở đây. Không đụng bảng trips: người khác trong chuyến không thấy
 * gì thay đổi.
 */

import type { ArchivedTrips } from '@/lib/trips/archive';
import { supabase } from '@/lib/supabase/client';
import { unwrap, unwrapVoid } from '@/lib/supabase/errors';

/** id chuyến → thời điểm lưu trữ, của người đang đăng nhập. */
export async function listArchivedTrips(): Promise<ArchivedTrips> {
  const rows = unwrap(await supabase.from('trip_archives').select('trip_id, archived_at'));
  return new Map(rows.map((row) => [row.trip_id, row.archived_at]));
}

/** Thời điểm lưu trữ của một chuyến, hoặc null nếu người này chưa lưu trữ. */
export async function getTripArchivedAt(tripId: string): Promise<string | null> {
  const rows = unwrap(
    await supabase.from('trip_archives').select('archived_at').eq('trip_id', tripId),
  );
  return rows[0]?.archived_at ?? null;
}

/**
 * Lưu trữ / bỏ lưu trữ. Gọi lặp lại vô hại: lưu trữ chuyến đã lưu trữ thì giữ
 * thời điểm cũ (ON CONFLICT DO NOTHING — không cần quyền UPDATE), bỏ lưu trữ
 * chuyến chưa lưu trữ thì xoá 0 dòng.
 */
export async function setTripArchived(tripId: string, archived: boolean): Promise<void> {
  if (archived) {
    unwrapVoid(
      await supabase
        .from('trip_archives')
        .upsert({ trip_id: tripId }, { onConflict: 'user_id,trip_id', ignoreDuplicates: true }),
    );
    return;
  }
  unwrapVoid(await supabase.from('trip_archives').delete().eq('trip_id', tripId));
}
