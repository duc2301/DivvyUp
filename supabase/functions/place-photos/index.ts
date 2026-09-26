/**
 * Ảnh minh hoạ cho địa điểm — một cổng, nhiều nguồn.
 *
 * Gọi: POST {
 *   query: string,             tên kèm quốc gia, ví dụ "Biên Hòa Việt Nam"
 *   name?: string,             riêng tên địa danh — dùng để LỌC ảnh có liên quan
 *   latitude?, longitude?,     toạ độ — dùng tìm ảnh chụp tại chỗ
 *   fallback?: string,         (bản app cũ) tên không kèm quốc gia
 *   limit?: number (1–30, mặc định 30), countryCode?: string
 * }
 * Trả: { photos: Photo[], provider: 'pinterest' | 'unsplash' | 'wikimedia' | 'mixed' }
 *
 * ĐỘ LIÊN QUAN LÀ ƯU TIÊN SỐ MỘT. Tìm "Bien Hoa Viet Nam" trên Unsplash khớp
 * mờ theo từ "Viet Nam" và trả về ảnh Hạ Long, Hội An... cho chuyến đi Biên
 * Hòa. Vì vậy:
 *   1. Pinterest  GET /v5/search/partner/pins — cần Partner Access; 403 nghĩa
 *      là "chưa mở khoá", rơi xuống nguồn kế tiếp trong im lặng.
 *   2. Unsplash   GET /search/photos — CHỈ giữ ảnh có metadata (mô tả, alt,
 *      tag, slug, vị trí) nhắc đúng tên địa danh.
 *   3. Wikimedia Commons — ảnh GẮN TOẠ ĐỘ trong bán kính 10 km: chụp thật tại
 *      chỗ, miễn phí, không cần khoá. Bỏ bản đồ, cờ, logo, ảnh dọc, ảnh nhỏ.
 *   Hai nguồn đã lọc được xen kẽ nhau. Chỉ khi lọc xong không còn ảnh nào mới
 *   trả ảnh Unsplash chưa lọc — ảnh gần đúng vẫn hơn chuyến đi trống trơn.
 *
 * Ghi công: Unsplash bắt buộc ghi tác giả; Wikimedia theo giấy phép từng ảnh.
 * Mỗi ảnh trả về đều kèm credit và link.
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

/**
 * Trigger trips_validate_cover từ chối CẢ bộ ảnh nếu một ghi công dài quá 200
 * ký tự — ghi công Artist trên Commons có thể rất dài (nhiều tác giả, ghi chú
 * tác phẩm phái sinh). Cắt ngay tại nguồn.
 */
const CREDIT_MAX = 200;

function clip(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

interface Photo {
  id: string;
  url: string;
  thumbUrl: string;
  /** Tên tác giả hoặc nguồn, để hiển thị ghi công. */
  credit: string;
  /** Link về trang gốc của ảnh. */
  link: string;
  provider: 'pinterest' | 'unsplash' | 'wikimedia';
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
        credit: clip(item.title?.trim() || 'Pinterest', CREDIT_MAX),
        // Luôn trỏ về trang pin trên pinterest.com: `item.link` là trang đích do
        // người đăng tự đặt (host bất kỳ) — trigger trips_validate_cover sẽ từ chối.
        link: `https://www.pinterest.com/pin/${encodeURIComponent(item.id)}/`,
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

/** Chuẩn hoá để so khớp: bỏ dấu, chữ thường, chỉ còn chữ-số cách nhau một khoảng trắng. */
function normalizeText(input: string): string {
  return stripDiacritics(input)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Ảnh có nhắc tới địa danh không. So cả dạng tách ("da lat") lẫn dạng dính
 * ("dalat") — người chụp viết kiểu nào cũng có.
 */
function mentionsPlace(text: string, placeName: string): boolean {
  const name = normalizeText(placeName);
  if (name.length < 2) return false;
  const haystack = ` ${normalizeText(text)} `;
  if (haystack.includes(` ${name} `)) return true;
  return name.includes(' ') && haystack.replace(/ /g, '').includes(name.replace(/ /g, ''));
}

type PhotoAttempt = { photos: Photo[]; relevant: Photo[] } | { failure: string };

async function fromUnsplash(query: string, placeName: string, limit: number): Promise<PhotoAttempt> {
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
    // Chi tiết hình dạng khoá chỉ ghi vào log máy chủ (Supabase → Edge Functions
    // → Logs), không trả về client: ai có khoá công khai của app cũng gọi được hàm này.
    if (response.status === 401) {
      console.error(
        '[place-photos] Unsplash từ chối khoá (401). Cần Access Key, không phải Secret Key. ' +
          `Khoá hiện tại: ${describeKeyShape(key)}.`,
      );
    } else {
      console.error(`[place-photos] Unsplash trả lỗi ${response.status}.`);
    }
    return { failure: 'Máy chủ ảnh tạm thời không dùng được. Thử lại sau.' };
  }

  const data = await response.json();
  const results: unknown[] = Array.isArray(data?.results) ? data.results : [];

  const photos: Photo[] = [];
  const relevant: Photo[] = [];
  for (const raw of results) {
    const item = raw as {
      id?: string;
      slug?: string;
      description?: string | null;
      alt_description?: string | null;
      urls?: { regular?: string; small?: string };
      links?: { html?: string };
      user?: { name?: string; links?: { html?: string } };
      tags?: { title?: string }[];
      location?: { name?: string | null; city?: string | null };
    };
    if (!item.id || !item.urls?.regular) continue;

    const photo: Photo = {
      id: item.id,
      url: item.urls.regular,
      thumbUrl: item.urls.small ?? item.urls.regular,
      // Unsplash yêu cầu ghi tên tác giả kèm link. Không phải trang trí.
      credit: clip(item.user?.name ?? 'Unsplash', CREDIT_MAX),
      link: item.user?.links?.html ?? item.links?.html ?? 'https://unsplash.com',
      provider: 'unsplash',
    };
    photos.push(photo);

    const text = [
      item.description,
      item.alt_description,
      item.slug,
      item.location?.name,
      item.location?.city,
      ...(item.tags ?? []).map((tag) => tag.title),
    ]
      .filter(Boolean)
      .join(' ');
    if (mentionsPlace(text, placeName)) relevant.push(photo);
  }

  // Không có ảnh nào là kết quả hợp lệ, KHÔNG phải lỗi: phải phân biệt được với
  // lỗi hạ tầng để app không coi "nơi này không có ảnh" là "mạng hỏng" rồi gọi lại mãi.
  return { photos, relevant };
}

/** Tên file Commons gợi ý không phải ảnh phong cảnh/địa danh. */
const COMMONS_NOISE =
  /(\bmap\b|ban do|bản đồ|\bflag\b|\blogo\b|diagram|\bchart\b|\bseal\b|coat of arms|emblem|\bicon\b|screenshot|signature|locator|sơ đồ|so do)/i;

/** Bỏ thẻ HTML trong metadata Artist của Commons. */
function stripHtml(input: string): string {
  return input.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Ảnh gắn toạ độ quanh địa điểm trên Wikimedia Commons. API công khai, không
 * cần khoá; chính sách của Wikimedia yêu cầu User-Agent nhận diện được ứng dụng.
 * Lỗi mạng chỉ làm mất nguồn này, không làm hỏng cả lượt tìm ảnh.
 */
async function fromWikimedia(latitude: number, longitude: number, limit: number): Promise<Photo[]> {
  const url =
    'https://commons.wikimedia.org/w/api.php?action=query&format=json&formatversion=2' +
    '&generator=geosearch&ggsnamespace=6&ggsradius=10000&ggslimit=80' +
    `&ggscoord=${latitude.toFixed(5)}%7C${longitude.toFixed(5)}` +
    '&prop=imageinfo&iiprop=url%7Csize%7Cmime%7Cextmetadata&iiurlwidth=1280' +
    '&iiextmetadatafilter=Artist%7CLicenseShortName';

  let response: Response;
  try {
    response = await fetchWithTimeout(url, {
      headers: { 'User-Agent': 'DivvyUp/1.1 (trip cover photos; https://divvyup.vn)' },
    });
  } catch (error) {
    console.warn('[place-photos] wikimedia: không kết nối được', String(error));
    return [];
  }
  if (!response.ok) {
    // Ghi log để phát hiện khi nguồn này chết hẳn (bị chặn User-Agent → 403 mãi).
    console.warn(`[place-photos] wikimedia trả ${response.status}`);
    return [];
  }

  const data = await response.json().catch(() => null);
  const pages: unknown[] = Array.isArray(data?.query?.pages) ? data.query.pages : [];

  const photos: { photo: Photo; order: number }[] = [];
  for (const raw of pages) {
    const page = raw as {
      pageid?: number;
      title?: string;
      index?: number;
      imageinfo?: {
        thumburl?: string;
        width?: number;
        height?: number;
        mime?: string;
        descriptionurl?: string;
        extmetadata?: { Artist?: { value?: string }; LicenseShortName?: { value?: string } };
      }[];
    };
    const info = page.imageinfo?.[0];
    if (!page.pageid || !page.title || !info?.thumburl) continue;
    if (info.mime !== 'image/jpeg') continue;
    const width = info.width ?? 0;
    const height = info.height ?? 0;
    // Ảnh ngang, đủ lớn cho ảnh bìa toàn màn hình.
    if (width < 1000 || width < height * 1.15) continue;
    if (COMMONS_NOISE.test(page.title)) continue;

    const artist = stripHtml(info.extmetadata?.Artist?.value ?? '') || 'Wikimedia Commons';
    const license = info.extmetadata?.LicenseShortName?.value;
    photos.push({
      // `index` của geosearch là thứ tự theo khoảng cách — gần trước.
      order: page.index ?? Number.MAX_SAFE_INTEGER,
      photo: {
        id: `wm-${page.pageid}`,
        url: info.thumburl,
        thumbUrl: info.thumburl.replace(/\/1280px-/, '/400px-'),
        credit: clip(license ? `${artist} (${license})` : artist, CREDIT_MAX),
        link: info.descriptionurl ?? `https://commons.wikimedia.org/?curid=${page.pageid}`,
        provider: 'wikimedia',
      },
    });
  }

  return photos
    .sort((a, b) => a.order - b.order)
    .slice(0, limit)
    .map((item) => item.photo);
}

function isCoordinate(value: unknown, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= max;
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  if (!hasCallerCredential(req)) {
    return errorResponse('Thiếu khoá truy cập của ứng dụng.', 401);
  }

  let query = '';
  let name = '';
  let fallback = '';
  let limit = 30;
  let countryCode = 'VN';
  let latitude: number | null = null;
  let longitude: number | null = null;
  try {
    const body = await req.json();
    query = typeof body.query === 'string' ? body.query.trim().slice(0, 200) : '';
    name = typeof body.name === 'string' ? body.name.trim().slice(0, 120) : '';
    fallback = typeof body.fallback === 'string' ? body.fallback.trim().slice(0, 120) : '';
    if (typeof body.limit === 'number') limit = Math.min(Math.max(Math.floor(body.limit), 1), 30);
    if (typeof body.countryCode === 'string' && body.countryCode.length === 2) {
      countryCode = body.countryCode.toUpperCase();
    }
    if (isCoordinate(body.latitude, 90) && isCoordinate(body.longitude, 180)) {
      latitude = body.latitude;
      longitude = body.longitude;
    }
  } catch {
    return errorResponse('Body phải là JSON.');
  }

  if (query.length < 2) return jsonResponse({ photos: [], provider: 'unsplash' });

  // Tên dùng để lọc: ưu tiên `name`; bản app cũ gửi tên trong `fallback`.
  const placeName = name || fallback || query;

  const pinterest = await fromPinterest(stripDiacritics(query), limit, countryCode);
  if (pinterest) return jsonResponse({ photos: pinterest, provider: 'pinterest' });

  // Lượt 1: Unsplash theo riêng tên, song song với Wikimedia theo toạ độ. Lượt 2
  // (tên + nước) chỉ khi chưa đủ ảnh: khoá Unsplash dùng chung cho mọi người
  // dùng, hạn mức bản miễn phí chỉ 50 lượt/giờ.
  const unsplashTerms = [stripDiacritics(placeName), stripDiacritics(query)].filter(
    (term, index, all) => term.length >= 2 && all.indexOf(term) === index,
  );
  const [firstUnsplash, wikimedia] = await Promise.all([
    fromUnsplash(unsplashTerms[0], placeName, limit),
    latitude !== null && longitude !== null
      ? fromWikimedia(latitude, longitude, limit)
      : Promise.resolve([] as Photo[]),
  ]);
  const unsplashResults: PhotoAttempt[] = [firstUnsplash];
  const firstRelevant = 'relevant' in firstUnsplash ? firstUnsplash.relevant.length : 0;
  if (unsplashTerms.length > 1 && firstRelevant + wikimedia.length < limit) {
    unsplashResults.push(await fromUnsplash(unsplashTerms[1], placeName, limit));
  }

  const seen = new Set<string>();
  const relevant: Photo[] = [];
  const loose: Photo[] = [];
  let failure: string | null = null;
  for (const result of unsplashResults) {
    if ('failure' in result) {
      failure = result.failure;
      continue;
    }
    for (const photo of result.relevant) {
      if (seen.has(photo.id)) continue;
      seen.add(photo.id);
      relevant.push(photo);
    }
  }
  for (const result of unsplashResults) {
    if ('failure' in result) continue;
    for (const photo of result.photos) {
      if (seen.has(photo.id)) continue;
      seen.add(photo.id);
      loose.push(photo);
    }
  }

  // Xen kẽ hai nguồn đã lọc: vừa đẹp (Unsplash) vừa đúng chỗ (Commons).
  const combined: Photo[] = [];
  for (
    let index = 0;
    combined.length < limit && (index < relevant.length || index < wikimedia.length);
    index += 1
  ) {
    if (index < relevant.length) combined.push(relevant[index]);
    if (index < wikimedia.length && combined.length < limit) combined.push(wikimedia[index]);
  }

  if (combined.length > 0) {
    const provider =
      relevant.length > 0 && wikimedia.length > 0
        ? 'mixed'
        : relevant.length > 0
          ? 'unsplash'
          : 'wikimedia';
    return jsonResponse({ photos: combined, provider });
  }

  // Lọc xong không còn ảnh nào: ảnh gần đúng vẫn hơn chuyến đi không có ảnh.
  if (loose.length > 0) return jsonResponse({ photos: loose.slice(0, limit), provider: 'unsplash' });

  // Mọi lượt Unsplash đều hỏng hạ tầng (và Wikimedia không có gì): báo lỗi để
  // app cho thử lại. Còn nếu các lượt chạy được mà không có ảnh: trả rỗng.
  const everyUnsplashFailed = unsplashResults.every((result) => 'failure' in result);
  if (everyUnsplashFailed && failure) return errorResponse(failure, 502);
  return jsonResponse({ photos: [], provider: 'unsplash' });
});
