/**
 * Tìm địa điểm và ảnh minh hoạ.
 *
 * Cả hai đều đi qua Edge Function chứ KHÔNG gọi thẳng nhà cung cấp: khoá API
 * nằm trên máy chủ, không bị nung vào bundle app. Nhờ vậy đổi nhà cung cấp ảnh
 * (Pinterest ↔ Unsplash) là việc phía server, app không phải build lại.
 */

import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase/client';
import { DataError } from '@/lib/supabase/errors';

export interface PlaceResult {
  readonly id: string;
  readonly name: string;
  readonly address: string | null;
  readonly country: string | null;
  readonly latitude: number;
  readonly longitude: number;
  readonly provider: 'mapbox';
}

export interface PlacePhoto {
  readonly id: string;
  readonly url: string;
  readonly thumbUrl: string;
  /** Tên tác giả hoặc nguồn — Unsplash BẮT BUỘC hiển thị. */
  readonly credit: string;
  readonly link: string;
  readonly provider: 'pinterest' | 'unsplash';
}

/**
 * Lấy thông báo lỗi THẬT từ Edge Function.
 *
 * KHÔNG được đọc `error.message`: với FunctionsHttpError nó là một chuỗi CỐ ĐỊNH
 * ('Edge Function returned a non-2xx status code'), giống hệt nhau cho 401, 404,
 * 500 hay 502. Mã trạng thái và body nằm trong `error.context` — một Response.
 *
 * Đây là lý do mọi câu chẩn đoán mà Edge Function dày công soạn ra ("Mapbox từ
 * chối token (401)", "Chưa đặt secret UNSPLASH_ACCESS_KEY") chưa bao giờ đến
 * được mắt người dùng: chúng bị nuốt sạch và thay bằng một câu chung chung.
 */
async function describeFunctionError(error: unknown, fallback: string): Promise<DataError> {
  if (error instanceof FunctionsFetchError) {
    return new DataError('Không kết nối được tới máy chủ. Kiểm tra mạng.');
  }

  if (error instanceof FunctionsHttpError) {
    const status = error.context.status;

    // Body do chính Edge Function của mình soạn, dạng { error: "..." }.
    const body = (await error.context.json().catch(() => null)) as { error?: string } | null;
    if (body?.error) return new DataError(body.error);

    if (status === 401) {
      return new DataError('Thiếu quyền gọi dịch vụ. Hãy đăng nhập lại.');
    }
    if (status === 404) {
      return new DataError(
        'Chưa triển khai Edge Function trên Supabase. Chạy: npx supabase functions deploy',
      );
    }
    return new DataError(`${fallback} (mã ${status})`);
  }

  return new DataError(fallback);
}

export async function searchPlaces(query: string, limit = 6): Promise<PlaceResult[]> {
  const trimmed = query.trim();
  // Dưới 2 ký tự thì kết quả toàn nhiễu mà vẫn tốn một lượt gọi có tính phí.
  if (trimmed.length < 2) return [];

  const { data, error } = await supabase.functions.invoke<{ places: PlaceResult[] }>(
    'place-search',
    { body: { query: trimmed, limit } },
  );

  if (error) throw await describeFunctionError(error, 'Không tìm được địa điểm.');
  return data?.places ?? [];
}

export async function fetchPlacePhotos(
  query: string,
  options: { limit?: number; countryCode?: string; fallback?: string } = {},
): Promise<PlacePhoto[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const { data, error } = await supabase.functions.invoke<{
    photos: PlacePhoto[];
    provider: string;
  }>('place-photos', {
    body: {
      query: trimmed,
      // Từ khoá rút gọn dùng khi từ khoá đầy đủ không ra ảnh nào — thường là
      // tên địa điểm bỏ phần tên nước.
      fallback: options.fallback ?? '',
      limit: options.limit ?? 12,
      countryCode: options.countryCode ?? 'VN',
    },
  });

  if (error) throw await describeFunctionError(error, 'Không tải được ảnh địa điểm.');
  return data?.photos ?? [];
}
