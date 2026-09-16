/**
 * Tìm địa điểm và ảnh minh hoạ.
 *
 * Cả hai đều đi qua Edge Function chứ KHÔNG gọi thẳng nhà cung cấp: khoá API
 * nằm trên máy chủ, không bị nung vào bundle app. Nhờ vậy đổi nhà cung cấp ảnh
 * (Pinterest ↔ Unsplash) là việc phía server, app không phải build lại.
 */

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

/** Dịch lỗi của Edge Function sang câu người dùng đọc được. */
function describeFunctionError(error: unknown, fallback: string): DataError {
  const message = error instanceof Error ? error.message : '';
  if (message.includes('401')) {
    return new DataError('Bạn cần đăng nhập để dùng tính năng này.');
  }
  if (message.toLowerCase().includes('not found') || message.includes('404')) {
    return new DataError(
      'Chưa triển khai Edge Function trên Supabase. Chạy: npx supabase functions deploy',
    );
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

  if (error) throw describeFunctionError(error, 'Không tìm được địa điểm. Thử lại sau.');
  return data?.places ?? [];
}

export async function fetchPlacePhotos(
  query: string,
  options: { limit?: number; countryCode?: string } = {},
): Promise<PlacePhoto[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const { data, error } = await supabase.functions.invoke<{
    photos: PlacePhoto[];
    provider: string;
  }>('place-photos', {
    body: {
      query: trimmed,
      limit: options.limit ?? 12,
      countryCode: options.countryCode ?? 'VN',
    },
  });

  if (error) throw describeFunctionError(error, 'Không tải được ảnh địa điểm. Thử lại sau.');
  return data?.photos ?? [];
}
