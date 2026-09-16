/**
 * Đọc thông tin Supabase Auth gắn vào URL khi người dùng bấm link trong email.
 *
 * App dùng luồng PKCE, Supabase chuyển hướng về app kèm:
 *   - thành công: `...?code=…&sb_flow_id=…`
 *   - thất bại:   `...?error=access_denied&error_code=otp_expired&error_description=…`
 * Lỗi có khi nằm ở hash thay vì query, và link cũ (luồng implicit) mang token ở
 * hash — nên đọc cả hai chỗ.
 *
 * Hàm thuần, không đụng React Native, để kiểm thử được bằng `node --test`.
 */

export interface AuthRedirect {
  /** Mã PKCE dùng một lần — đổi ra phiên bằng exchangeCodeForSession. */
  readonly code: string | null;
  /** Định danh luồng PKCE supabase-js gắn vào redirect (tham số sb_flow_id). */
  readonly flowId: string | null;
  readonly accessToken: string | null;
  readonly refreshToken: string | null;
  /** 'signup' | 'recovery' | 'magiclink' | … — để nguyên chuỗi, Supabase có thể thêm loại mới. */
  readonly type: string | null;
  readonly errorCode: string | null;
  readonly errorDescription: string | null;
}

function paramsOf(fragment: string): URLSearchParams {
  return new URLSearchParams(fragment.replace(/^[?#]/, ''));
}

/** Trả null khi URL không mang dữ liệu auth nào — tức là mở màn hình bình thường. */
export function parseAuthRedirect(url: string | null | undefined): AuthRedirect | null {
  if (!url) return null;

  const hashAt = url.indexOf('#');
  const beforeHash = hashAt === -1 ? url : url.slice(0, hashAt);
  const hash = hashAt === -1 ? '' : url.slice(hashAt + 1);
  const queryAt = beforeHash.indexOf('?');
  const query = queryAt === -1 ? '' : beforeHash.slice(queryAt + 1);

  const fromHash = paramsOf(hash);
  const fromQuery = paramsOf(query);
  // Hash được ưu tiên: token luôn nằm ở đó, còn query là của chính app đặt vào.
  const read = (key: string): string | null => {
    const value = fromHash.get(key) ?? fromQuery.get(key);
    return value === null || value === '' ? null : value;
  };

  const result: AuthRedirect = {
    code: read('code'),
    flowId: read('sb_flow_id'),
    accessToken: read('access_token'),
    refreshToken: read('refresh_token'),
    type: read('type'),
    errorCode: read('error_code') ?? read('error'),
    errorDescription: read('error_description'),
  };

  const hasAnything =
    result.code !== null ||
    result.accessToken !== null ||
    result.refreshToken !== null ||
    result.errorCode !== null;
  return hasAnything ? result : null;
}

/** Câu tiếng Việt cho lỗi của link trong email. */
export function describeRedirectError(redirect: AuthRedirect): string {
  if (redirect.errorCode === 'otp_expired') {
    return 'Link đã hết hạn hoặc đã được dùng. Hãy yêu cầu gửi lại email mới.';
  }
  if (redirect.errorCode === 'access_denied') {
    return 'Link không còn hợp lệ. Hãy yêu cầu gửi lại email mới.';
  }
  return redirect.errorDescription ?? 'Link không hợp lệ. Hãy yêu cầu gửi lại email mới.';
}
