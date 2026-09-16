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
  hasCallerCredential,
} from '../_shared/http.ts';


/**
 * Mô tả hình dạng khoá mà KHÔNG lộ khoá.
 *
 * Chỉ trả về 4 ký tự đầu, độ dài, và có dính khoảng trắng hay không — đủ để
 * phân biệt "sk." với "pk." hoặc phát hiện dấu nháy/xuống dòng lọt vào lúc đặt
 * secret, mà không tiết lộ gì có thể dùng lại được.
 */
function describeKeyShape(raw: string): string {
  const trimmed = raw.trim();
  const parts = [`dài ${raw.length} ký tự`, `bắt đầu bằng "${trimmed.slice(0, 4)}"`];
  if (raw !== trimmed) parts.push('CÓ khoảng trắng/xuống dòng ở đầu hoặc cuối');
  if (/^["']|["']$/.test(trimmed)) parts.push('CÓ dấu nháy bao quanh');
  return parts.join(', ');
}

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

  if (!hasCallerCredential(req)) {
    return errorResponse('Thiếu khoá truy cập của ứng dụng.', 401);
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
    // Chỉ lấy cấp thành phố trở lên, không trả về số nhà ngõ ngách.
    //
    // KHÔNG có 'poi' ở đây: Geocoding v6 không nhận type đó và sẽ trả 422 cho
    // CẢ câu truy vấn. Điểm tham quan (POI) nằm ở Search Box API, một endpoint
    // khác — nếu sau này cần "Hồ Xuân Hương" chứ không chỉ "Đà Lạt" thì phải
    // gọi /search/searchbox/v1/suggest, không phải thêm type vào đây.
    '&types=place,locality,region,district' +
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
    if (response.status === 401) {
      return errorResponse(
        'Mapbox từ chối token (401). Cần token PUBLIC bắt đầu bằng "pk.", không phải "sk.". ' +
          `Token hiện tại: ${describeKeyShape(token)}.`,
        502,
      );
    }
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
