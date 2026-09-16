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

/**
 * Bỏ dấu tiếng Việt trước khi tìm ảnh.
 *
 * Kho ảnh của Unsplash và Pinterest lập chỉ mục bằng tiếng Anh, nên từ khoá có
 * dấu gần như không khớp gì. Đo thực tế trên Unsplash:
 *   "Đà Lạt Việt Nam"  ->     1 ảnh
 *   "Da Lat Viet Nam"  -> 3.433 ảnh
 *   "Hội An Việt Nam"  ->    50 ảnh
 *   "Hoi An Viet Nam"  -> 2.322 ảnh
 *
 * NFD tách dấu thanh ra khỏi nguyên âm, nhưng KHÔNG tách được đ/Đ vì đó là chữ
 * cái riêng chứ không phải chữ có dấu — phải thay tay.
 */
function stripDiacritics(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}

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
          ? 'Unsplash từ chối khoá (401). Cần Access Key, không phải Secret Key. ' +
            `Khoá hiện tại: ${describeKeyShape(key)}.`
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

  if (!hasCallerCredential(req)) {
    return errorResponse('Thiếu khoá truy cập của ứng dụng.', 401);
  }

  let query = '';
  let fallback = '';
  let limit = 12;
  let countryCode = 'VN';
  try {
    const body = await req.json();
    query = typeof body.query === 'string' ? body.query.trim() : '';
    fallback = typeof body.fallback === 'string' ? body.fallback.trim() : '';
    if (typeof body.limit === 'number') limit = Math.min(Math.max(body.limit, 1), 30);
    if (typeof body.countryCode === 'string' && body.countryCode.length === 2) {
      countryCode = body.countryCode.toUpperCase();
    }
  } catch {
    return errorResponse('Body phải là JSON.');
  }

  if (query.length < 2) return jsonResponse({ photos: [], provider: 'unsplash' });

  // Thử lần lượt: từ khoá đầy đủ đã bỏ dấu, rồi tới từ khoá dự phòng (thường là
  // tên địa điểm không kèm quốc gia). Địa danh ít nổi tiếng hay không có ảnh khi
  // ghép cả tên nước, nhưng riêng tên thì vẫn có.
  const attempts = [stripDiacritics(query), fallback ? stripDiacritics(fallback) : '']
    .filter((term, index, all) => term.length >= 2 && all.indexOf(term) === index);

  let lastFailure = 'Không tìm được ảnh nào cho địa điểm này.';

  for (const term of attempts) {
    const pinterest = await fromPinterest(term, limit, countryCode);
    if (pinterest) return jsonResponse({ photos: pinterest, provider: 'pinterest' });

    const unsplash = await fromUnsplash(term, limit);
    if ('photos' in unsplash) {
      return jsonResponse({ photos: unsplash.photos, provider: 'unsplash' });
    }
    lastFailure = unsplash.failure;
  }

  return errorResponse(lastFailure, 500);
});
