/**
 * Tiện ích bắt lỗi cho mọi lời gọi Supabase.
 *
 * Lý do tồn tại: `supabase.from(...)` luôn trả về { data, error }, và `data`
 * có thể là null ngay cả khi không có lỗi. Dùng thẳng `data` mà bỏ qua `error`
 * là lỗi hay gặp nhất khi làm việc với supabase-js — nó biến một lỗi mạng
 * thành một màn hình trống không giải thích được.
 */

import type { PostgrestError } from '@supabase/supabase-js';

export class DataError extends Error {
  readonly code: string | null;
  readonly hint: string | null;

  constructor(message: string, code: string | null = null, hint: string | null = null) {
    super(message);
    this.name = 'DataError';
    this.code = code;
    this.hint = hint;
  }
}

/**
 * Dịch lỗi Postgres sang câu tiếng Việt người dùng đọc được.
 *
 * Các mã này khớp với `using errcode = ...` trong RPC ở supabase/migrations/.
 */
function friendlyMessage(error: PostgrestError): string {
  switch (error.code) {
    case '28000':
      return 'Bạn cần đăng nhập để thực hiện thao tác này.';
    case '42501':
      // Bao gồm cả trường hợp RLS chặn. Cố ý không phân biệt "không tồn tại"
      // với "không có quyền" — phân biệt sẽ tiết lộ dữ liệu của nhóm khác.
      return error.message || 'Bạn không có quyền với dữ liệu này.';
    case '23514': // check_violation
      return error.message || 'Dữ liệu không thoả ràng buộc của hệ thống.';
    case '23505': // unique_violation
      return 'Bản ghi này đã tồn tại.';
    case '23503': // foreign_key_violation
      return 'Dữ liệu tham chiếu tới bản ghi không tồn tại.';
    case 'PGRST301':
      return 'Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.';
    case 'PGRST205':
      // Bảng chưa có trong schema cache — gần như luôn là do chưa áp migration.
      return 'Cơ sở dữ liệu chưa có bảng này. Hãy áp các migration trong supabase/migrations/ rồi thử lại.';
    case 'PGRST202':
      return 'Cơ sở dữ liệu chưa có hàm RPC này. Hãy áp các migration trong supabase/migrations/ rồi thử lại.';
    default:
      return error.message || 'Không kết nối được tới máy chủ.';
  }
}

export function unwrap<T>(result: { data: T | null; error: PostgrestError | null }): T {
  if (result.error) {
    throw new DataError(friendlyMessage(result.error), result.error.code, result.error.hint);
  }
  if (result.data === null) {
    throw new DataError('Máy chủ không trả về dữ liệu.');
  }
  return result.data;
}

/** Dành cho thao tác không trả dữ liệu (RPC void, update, delete). */
export function unwrapVoid(result: { error: PostgrestError | null }): void {
  if (result.error) {
    throw new DataError(friendlyMessage(result.error), result.error.code, result.error.hint);
  }
}

/**
 * Cột *_minor trong DB là bigint. PostgREST trả về dưới dạng số JSON, nên giá
 * trị vượt 2^53 sẽ mất chính xác MÀ KHÔNG BÁO LỖI. Với app tiền bạc thì im lặng
 * sai là tệ nhất — chặn ngay tại biên.
 */
export function toSafeMinor(value: number | string | null | undefined, field: string): number {
  const parsed = typeof value === 'string' ? Number(value) : value;

  if (parsed === null || parsed === undefined || Number.isNaN(parsed)) {
    throw new DataError(`Trường "${field}" không phải số hợp lệ.`);
  }
  if (!Number.isSafeInteger(parsed)) {
    throw new DataError(
      `Trường "${field}" vượt ngưỡng số nguyên an toàn của JavaScript (${String(value)}).`,
    );
  }
  return parsed;
}
