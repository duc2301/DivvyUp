/**
 * Tiện ích dùng chung cho các Edge Function.
 *
 * Lý do có proxy này thay vì gọi thẳng từ app: biến EXPO_PUBLIC_* bị nung vào
 * bundle, ai giải nén APK cũng đọc được. Khoá Mapbox hay Pinterest lộ ra là
 * người khác xài hết hạn mức của bạn. Đặt khoá ở đây thì nó không bao giờ rời
 * khỏi máy chủ.
 */

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

export function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ error: message }, status);
}

/** Trả về response cho preflight, hoặc null nếu không phải preflight. */
export function handlePreflight(req: Request): Response | null {
  return req.method === 'OPTIONS' ? new Response('ok', { headers: corsHeaders }) : null;
}

/**
 * Chỉ cho client của app gọi, không để proxy thành cổng mở cho cả Internet.
 *
 * CHẤP NHẬN apikey HOẶC Authorization — không được đòi riêng Authorization.
 * Lý do: với khoá kiểu mới `sb_publishable_...`, supabase-js chỉ gửi khoá ở
 * header `apikey` và KHÔNG nhân đôi sang `Authorization` khi người dùng chưa
 * đăng nhập. Khoá anon kiểu JWT cũ thì có gửi cả hai. Đòi riêng Authorization
 * sẽ chặn sạch chế độ khách — vốn là một chế độ hợp lệ của app.
 *
 * Việc xác thực thật do nền tảng Supabase làm trước khi hàm này chạy: request
 * không kèm khoá hợp lệ đã bị chặn từ vòng ngoài. Hàm này chỉ là lớp kiểm lại
 * phòng khi ai đó deploy với --no-verify-jwt.
 */
export function hasCallerCredential(req: Request): boolean {
  const auth = req.headers.get('Authorization');
  if (auth && auth.toLowerCase().startsWith('bearer ') && auth.length > 10) return true;

  const apikey = req.headers.get('apikey');
  return Boolean(apikey && apikey.length > 10);
}

/** fetch có hạn giờ, để một nhà cung cấp chậm không treo cả hàm. */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = 8000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
