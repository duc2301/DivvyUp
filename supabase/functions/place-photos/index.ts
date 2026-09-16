/**
 * Ảnh minh hoạ cho địa điểm — một cổng, nhiều nguồn.
 *
 * Gọi: POST { query: string, limit?: number, countryCode?: string }
 * Trả: { photos: Photo[], provider: 'pinterest' | 'unsplash' }
 *
 * THỨ TỰ ƯU TIÊN
 *   1. Pinterest  GET /v5/search/partner/pins
 *      Endpoint này có thật nhưng đang Beta và cần Partner Access do Pinterest
 *      cấp. Chưa được duyệt thì trả 403 — nên coi 403 là "chưa mở khoá" chứ
 *      không phải lỗi, và rơi xuống nguồn kế tiếp trong im lặng.
 *   2. Unsplash   GET /search/photos
 *      Cấp khoá ngay, miễn phí, và BẮT BUỘC ghi công tác giả — đó là lý do
 *      mỗi ảnh trả về đều kèm credit và link.
 *
 * App không biết ảnh đến từ đâu. Ngày nào Partner Access được duyệt, chỉ cần
 * đặt thêm secret PINTEREST_TOKEN là nguồn tự đổi, không phải build lại app.
 *
 * Secret cần đặt:
 *   npx supabase secrets set UNSPLASH_ACCESS_KEY=...
 *   npx supabase secrets set PINTEREST_TOKEN=...   (tuỳ chọn)
 */

import {
  errorResponse,
  fetchWithTimeout,
  handlePreflight,
  jsonResponse,
  requireAuthHeader,
} from '../_shared/http.ts';

interface Photo {
  id: string;
  url: string;
  thumbUrl: string;
  /** Tên tác giả hoặc nguồn, để hiển thị ghi công. */
  credit: string;
  /** Link về trang gốc của ảnh. */
  link: string;
  provider: 'pinterest' | 'unsplash';
}

async function fromPinterest(query: string, limit: number, countryCode: string): Promise<Photo[] | null> {
  const token = Deno.env.get('PINTEREST_TOKEN');
  if (!token) return null;

  const url =
    'https://api.pinterest.com/v5/search/partner/pins' +
    `?term=${encodeURIComponent(query)}` +
    `&country_code=${encodeURIComponent(countryCode)}` +
    `&limit=${limit}`;

  let response: Response;
  try {
    response = await fetchWithTimeout(url, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
  } catch {
    return null;
  }

  // 403 = chưa có Partner Access. Đây là trạng thái BÌNH THƯỜNG khi chưa được
  // duyệt, không phải sự cố — cứ lặng lẽ dùng nguồn dự phòng.
  if (response.status === 403 || response.status === 401) return null;
  if (!response.ok) return null;

  const data = await response.json();
  const items: unknown[] = Array.isArray(data?.items) ? data.items : [];

  const photos = items.flatMap((raw): Photo[] => {
    const item = raw as {
      id?: string;
      title?: string;
      link?: string;
      media?: { images?: Record<string, { url?: string }> };
    };
    const images = item.media?.images ?? {};
    const large = images['1200x']?.url ?? images['600x']?.url ?? images.originals?.url;
    const thumb = images['150x150']?.url ?? images['400x300']?.url ?? large;

    if (!large || !item.id) return [];
    return [
      {
        id: item.id,
        url: large,
        thumbUrl: thumb ?? large,
        credit: item.title?.trim() || 'Pinterest',
        link: item.link ?? `https://www.pinterest.com/pin/${item.id}/`,
        provider: 'pinterest',
      },
    ];
  });

  return photos.length > 0 ? photos : null;
}

/**
 * Kết quả một lần thử nguồn ảnh.
 *
 * Trả lý do thất bại qua GIÁ TRỊ TRẢ VỀ, không qua biến module: Edge Function
 * dùng lại isolate giữa các request, nên biến module sẽ mang lỗi của lượt
 * trước sang lượt sau.
 */
type PhotoAttempt = { photos: Photo[] } | { failure: string };

async function fromUnsplash(query: string, limit: number): Promise<PhotoAttempt> {
  const key = Deno.env.get('UNSPLASH_ACCESS_KEY');
  if (!key) return { failure: 'Chưa đặt secret UNSPLASH_ACCESS_KEY.' };

  const url =
    'https://api.unsplash.com/search/photos' +
    `?query=${encodeURIComponent(query)}` +
    `&per_page=${limit}` +
    '&orientation=landscape' +
    '&content_filter=high';

  let response: Response;
  try {
    response = await fetchWithTimeout(url, {
      headers: { Authorization: `Client-ID ${key}`, 'Accept-Version': 'v1' },
    });
  } catch {
    return { failure: 'Không kết nối được tới Unsplash.' };
  }
  if (!response.ok) {
    return {
      failure:
        response.status === 401
          ? 'Unsplash từ chối khoá (401). Kiểm tra lại Access Key, không phải Secret Key.'
          : `Unsplash trả lỗi ${response.status}.`,
    };
  }

  const data = await response.json();
  const results: unknown[] = Array.isArray(data?.results) ? data.results : [];

  const photos = results.flatMap((raw): Photo[] => {
    const item = raw as {
      id?: string;
      urls?: { regular?: string; small?: string };
      links?: { html?: string };
      user?: { name?: string; links?: { html?: string } };
    };
    if (!item.id || !item.urls?.regular) return [];

    return [
      {
        id: item.id,
        url: item.urls.regular,
        thumbUrl: item.urls.small ?? item.urls.regular,
        // Unsplash yêu cầu ghi tên tác giả kèm link. Không phải trang trí.
        credit: item.user?.name ?? 'Unsplash',
        link: item.user?.links?.html ?? item.links?.html ?? 'https://unsplash.com',
        provider: 'unsplash',
      },
    ];
  });

  return photos.length > 0
    ? { photos }
    : { failure: `Unsplash không có ảnh nào cho "${query}".` };
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  if (!requireAuthHeader(req)) {
    return errorResponse('Cần đăng nhập để xem ảnh địa điểm.', 401);
  }

  let query = '';
  let limit = 12;
  let countryCode = 'VN';
  try {
    const body = await req.json();
    query = typeof body.query === 'string' ? body.query.trim() : '';
    if (typeof body.limit === 'number') limit = Math.min(Math.max(body.limit, 1), 30);
    if (typeof body.countryCode === 'string' && body.countryCode.length === 2) {
      countryCode = body.countryCode.toUpperCase();
    }
  } catch {
    return errorResponse('Body phải là JSON.');
  }

  if (query.length < 2) return jsonResponse({ photos: [], provider: 'unsplash' });

  const pinterest = await fromPinterest(query, limit, countryCode);
  if (pinterest) return jsonResponse({ photos: pinterest, provider: 'pinterest' });

  const unsplash = await fromUnsplash(query, limit);
  if ('photos' in unsplash) {
    return jsonResponse({ photos: unsplash.photos, provider: 'unsplash' });
  }

  return errorResponse(unsplash.failure, 500);
});
