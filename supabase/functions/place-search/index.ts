/**
 * Tìm địa điểm du lịch — proxy cho Mapbox Search.
 *
 * Gọi: POST { query: string, limit?: number }
 * Trả: { places: PlaceResult[] }
 *
 * Biến môi trường cần đặt (KHÔNG commit vào repo):
 *   npx supabase secrets set MAPBOX_TOKEN=pk....
 */

import {
  errorResponse,
  fetchWithTimeout,
  handlePreflight,
  jsonResponse,
  requireAuthHeader,
} from '../_shared/http.ts';

interface PlaceResult {
  id: string;
  name: string;
  address: string | null;
  country: string | null;
  latitude: number;
  longitude: number;
  provider: 'mapbox';
}

interface MapboxFeature {
  id?: string;
  properties?: {
    mapbox_id?: string;
    name?: string;
    place_formatted?: string;
    full_address?: string;
    coordinates?: { latitude?: number; longitude?: number };
    context?: { country?: { name?: string } };
  };
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  if (!requireAuthHeader(req)) {
    return errorResponse('Cần đăng nhập để tìm địa điểm.', 401);
  }

  const token = Deno.env.get('MAPBOX_TOKEN');
  if (!token) {
    // Nói rõ là lỗi cấu hình phía máy chủ, đừng để lập trình viên tưởng do
    // người dùng gõ sai.
    return errorResponse('Máy chủ chưa cấu hình MAPBOX_TOKEN.', 500);
  }

  let query = '';
  let limit = 6;
  try {
    const body = await req.json();
    query = typeof body.query === 'string' ? body.query.trim() : '';
    if (typeof body.limit === 'number') limit = Math.min(Math.max(body.limit, 1), 10);
  } catch {
    return errorResponse('Body phải là JSON.');
  }

  // Dưới 2 ký tự thì gợi ý toàn nhiễu mà vẫn tính một lượt gọi.
  if (query.length < 2) return jsonResponse({ places: [] });

  const url =
    'https://api.mapbox.com/search/geocode/v6/forward' +
    `?q=${encodeURIComponent(query)}` +
    // Chỉ lấy thành phố, khu vực và địa danh nổi bật — đúng yêu cầu "tên thành
    // phố hoặc địa chỉ nổi bật", không trả về số nhà ngõ ngách.
    '&types=place,locality,region,poi' +
    `&limit=${limit}` +
    '&language=vi' +
    `&access_token=${token}`;

  let response: Response;
  try {
    response = await fetchWithTimeout(url);
  } catch {
    return errorResponse('Không kết nối được tới dịch vụ bản đồ.', 502);
  }

  if (!response.ok) {
    return errorResponse(`Dịch vụ bản đồ trả lỗi ${response.status}.`, 502);
  }

  const data = await response.json();
  const features: MapboxFeature[] = Array.isArray(data?.features) ? data.features : [];

  const places: PlaceResult[] = features.flatMap((feature) => {
    const props = feature.properties ?? {};
    const latitude = props.coordinates?.latitude;
    const longitude = props.coordinates?.longitude;
    const name = props.name;

    // Bỏ qua bản ghi thiếu toạ độ hoặc thiếu tên: hiện lên cũng không chọn được.
    if (!name || typeof latitude !== 'number' || typeof longitude !== 'number') return [];

    return [
      {
        id: props.mapbox_id ?? feature.id ?? `${latitude},${longitude}`,
        name,
        address: props.place_formatted ?? props.full_address ?? null,
        country: props.context?.country?.name ?? null,
        latitude,
        longitude,
        provider: 'mapbox' as const,
      },
    ];
  });

  return jsonResponse({ places });
});
