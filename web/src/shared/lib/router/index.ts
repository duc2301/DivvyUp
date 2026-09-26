import { useNavigate } from 'react-router';

/**
 * Quay lại màn trước; mở thẳng bằng link (không có lịch sử trong app) thì về
 * `fallback`. Tương đương `router.canGoBack() ? back() : replace(...)` của mobile.
 * react-router ghi `idx` vào history.state — 0 nghĩa là trang đầu tiên của phiên.
 */
export function useGoBack(fallback: string = '/'): () => void {
  const navigate = useNavigate();
  return () => {
    const state: unknown = window.history.state;
    const idx =
      typeof state === 'object' && state !== null && 'idx' in state && typeof state.idx === 'number'
        ? state.idx
        : 0;
    if (idx > 0) void navigate(-1);
    else void navigate(fallback, { replace: true });
  };
}

/** Ký tự điều khiển (mã < 32, 127) hoặc dấu gạch chéo ngược. */
function hasUnsafeChar(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 32 || code === 127 || code === 92) return true;
  }
  return false;
}

/**
 * Chỉ nhận đường dẫn nội bộ cho ?next= — chặn open redirect.
 *
 * So bằng URL thật thay vì so tiền tố chuỗi: "/%09/evil.com" giải mã thành
 * "/	/evil.com", qua được phép so tiền tố, và trình duyệt bỏ ký tự tab nên
 * thành "//evil.com". Từ chối mọi ký tự điều khiển, rồi yêu cầu cùng origin.
 */
export function safeInternalPath(value: string | null | undefined, fallback = '/'): string {
  if (!value || !value.startsWith('/') || hasUnsafeChar(value)) {
    return fallback;
  }
  try {
    const url = new URL(value, window.location.origin);
    if (url.origin !== window.location.origin) return fallback;
    return url.pathname + url.search + url.hash;
  } catch {
    return fallback;
  }
}
