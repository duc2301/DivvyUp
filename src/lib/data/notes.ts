/**
 * Tầng truy cập dữ liệu — ghi chú dùng chung của chuyến đi (bảng trip_notes).
 *
 * Mọi thành viên đã nhận chỗ đọc/thêm/sửa được (RLS is_trip_member). Không có
 * xoá cứng: xoá = đặt deleted_at, DB chặn khôi phục. "Ai sửa cuối" do trigger
 * điền bằng auth.uid() — client không gửi, nên không mạo danh được.
 */

import { supabase } from '@/lib/supabase/client';
import { DataError, unwrap } from '@/lib/supabase/errors';

/**
 * Nguồn chân lý các giá trị mẫu ghi chú (khớp CHECK trip_notes.template).
 * Tiêu đề/nội dung gợi ý của từng mẫu nằm ở src/lib/notes/templates.ts.
 */
export const NOTE_TEMPLATE_KEYS = ['plan', 'notes', 'description'] as const;
export type NoteTemplateKey = (typeof NOTE_TEMPLATE_KEYS)[number];

export function isNoteTemplateKey(value: unknown): value is NoteTemplateKey {
  return NOTE_TEMPLATE_KEYS.some((key) => key === value);
}

export interface TripNote {
  readonly id: string;
  readonly tripId: string;
  readonly title: string;
  readonly body: string;
  readonly template: NoteTemplateKey | null;
  readonly sortOrder: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** trip_members.id của người sửa cuối; null nếu không xác định được. */
  readonly updatedByMemberId: string | null;
}

export interface TripNoteInput {
  readonly title: string;
  readonly body: string;
}

export const NOTE_TITLE_MAX = 120;
export const NOTE_BODY_MAX = 10000;

/**
 * Kiểm + chuẩn hoá nội dung ghi chú. Dùng chung cho nhánh khách để hai bên báo
 * cùng thông báo lỗi; CHECK của bảng kiểm lại ở DB.
 */
export function validateNoteInput(input: TripNoteInput): TripNoteInput {
  const title = input.title.trim();
  if (title.length > NOTE_TITLE_MAX) {
    throw new DataError(`Tiêu đề ghi chú tối đa ${NOTE_TITLE_MAX} ký tự.`);
  }
  if (input.body.length > NOTE_BODY_MAX) {
    throw new DataError(`Nội dung ghi chú tối đa ${NOTE_BODY_MAX} ký tự.`);
  }
  return { title, body: input.body };
}

export function assertNoteTemplate(template: NoteTemplateKey | null): NoteTemplateKey | null {
  if (template !== null && !isNoteTemplateKey(template)) {
    throw new DataError(`Mẫu ghi chú "${String(template)}" không hợp lệ.`);
  }
  return template;
}

function parseTemplate(value: string | null): NoteTemplateKey | null {
  return isNoteTemplateKey(value) ? value : null;
}

/**
 * Ghi chú còn hiệu lực của chuyến. Hai truy vấn song song: ghi chú + bảng đối
 * chiếu tài khoản → chỗ trong chuyến (updated_by là id tài khoản, màn hình cần
 * trip_members.id để hiện tên/ảnh). Lấy cả người đã rời chuyến để ghi chú cũ
 * vẫn hiện đúng người sửa.
 */
export async function listTripNotes(tripId: string): Promise<TripNote[]> {
  const [noteResult, memberResult] = await Promise.all([
    supabase
      .from('trip_notes')
      .select('id, trip_id, title, body, template, sort_order, created_at, updated_at, updated_by')
      .eq('trip_id', tripId)
      .is('deleted_at', null)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true }),
    supabase.from('trip_members').select('id, user_id').eq('trip_id', tripId).not('user_id', 'is', null),
  ]);

  const memberByUser = new Map<string, string>();
  for (const member of unwrap(memberResult)) {
    if (member.user_id !== null) memberByUser.set(member.user_id, member.id);
  }

  return unwrap(noteResult).map((row) => ({
    id: row.id,
    tripId: row.trip_id,
    title: row.title,
    body: row.body,
    template: parseTemplate(row.template),
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    updatedByMemberId: row.updated_by !== null ? (memberByUser.get(row.updated_by) ?? null) : null,
  }));
}

export async function createTripNote(
  tripId: string,
  input: { title: string; body: string; template: NoteTemplateKey | null },
): Promise<string> {
  const valid = validateNoteInput(input);
  const template = assertNoteTemplate(input.template);

  const rows = unwrap(
    await supabase
      .from('trip_notes')
      .insert({ trip_id: tripId, title: valid.title, body: valid.body, template })
      .select('id'),
  );
  const created = rows[0];
  if (!created) {
    throw new DataError('Tạo ghi chú không thành công.');
  }
  return created.id;
}

/**
 * RLS lọc dòng không được phép thay vì báo lỗi — PostgREST trả thành công với
 * 0 dòng. Không kiểm số dòng thì người dùng thấy "đã lưu" mà thật ra không.
 */
const NOTE_NOT_FOUND = 'Không tìm thấy ghi chú, hoặc bạn không có quyền sửa.';
export const NOTE_STALE_MESSAGE = 'Ghi chú vừa được người khác sửa. Mở lại để xem bản mới nhất.';

function assertNoteTouched(rows: readonly unknown[]): void {
  if (rows.length === 0) {
    throw new DataError(NOTE_NOT_FOUND, '42501');
  }
}

/**
 * Sửa ghi chú với khoá lạc quan: chỉ ghi nếu updated_at vẫn là giá trị đã đọc
 * (`expectedUpdatedAt`, lấy nguyên từ TripNote.updatedAt). Trigger đổi
 * updated_at ở mỗi lần ghi, nên hai người sửa cùng lúc thì người sau trúng 0
 * dòng thay vì âm thầm đè bản của người trước.
 *
 * 0 dòng có hai nghĩa, phân biệt bằng một lần đọc lại:
 *  - ghi chú còn và updated_at đã khác → người khác vừa sửa;
 *  - còn lại (đã xoá, hết quyền, chuyến đã xoá) → lỗi không tìm thấy / không quyền.
 */
export async function updateTripNote(
  noteId: string,
  input: { title: string; body: string },
  expectedUpdatedAt: string,
): Promise<void> {
  const valid = validateNoteInput(input);
  const rows = unwrap(
    await supabase
      .from('trip_notes')
      .update({ title: valid.title, body: valid.body })
      .eq('id', noteId)
      .eq('updated_at', expectedUpdatedAt)
      .is('deleted_at', null)
      .select('id'),
  );
  if (rows.length > 0) return;

  const current = unwrap(
    await supabase.from('trip_notes').select('updated_at').eq('id', noteId).is('deleted_at', null),
  )[0];
  if (current && !sameInstant(current.updated_at, expectedUpdatedAt)) {
    throw new DataError(NOTE_STALE_MESSAGE, '40001');
  }
  throw new DataError(NOTE_NOT_FOUND, '42501');
}

/** So hai mốc giờ ISO theo thời điểm, không theo chuỗi (định dạng múi giờ có thể khác). */
function sameInstant(a: string, b: string): boolean {
  return a === b || Date.parse(a) === Date.parse(b);
}

/** Xoá mềm. DB không cho khôi phục. */
export async function deleteTripNote(noteId: string): Promise<void> {
  const rows = unwrap(
    await supabase
      .from('trip_notes')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', noteId)
      .is('deleted_at', null)
      .select('id'),
  );
  assertNoteTouched(rows);
}
