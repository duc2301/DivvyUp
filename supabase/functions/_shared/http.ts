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
 * Chỉ cho người đã đăng nhập gọi.
 *
 * Supabase tự xác thực JWT trước khi hàm chạy (trừ khi deploy với
 * --no-verify-jwt), nhưng kiểm lại ở đây để nếu ai đó lỡ tắt cờ đó thì proxy
 * vẫn không thành cổng mở cho cả Internet dùng chùa hạn mức API.
 */
export function requireAuthHeader(req: Request): string | null {
  const header = req.headers.get('Authorization');
  if (!header || !header.toLowerCase().startsWith('bearer ')) return null;
  return header;
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
