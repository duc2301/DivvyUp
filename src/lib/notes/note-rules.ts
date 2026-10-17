/**
 * Luật dùng chung của ghi chú — nguồn chân lý DUY NHẤT, khớp CHECK của bảng
 * trip_notes (migration 20260925_1000). File thuần (không Supabase, không Yjs)
 * để cả tầng dữ liệu (notes.ts) lẫn lõi đồng soạn (collab-session.ts) và web dùng.
 */

export const NOTE_TITLE_MAX = 120;
export const NOTE_BODY_MAX = 10000;

/** So hai mốc giờ ISO theo thời điểm, không theo chuỗi (định dạng múi giờ có thể khác). */
export function sameInstant(a: string, b: string): boolean {
  return a === b || Date.parse(a) === Date.parse(b);
}
