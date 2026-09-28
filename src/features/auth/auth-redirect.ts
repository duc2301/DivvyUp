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
  /** Tham số `error` thô (errorCode ưu tiên error_code) — để nhận ra access_denied. */
  readonly error: string | null;
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
    error: read('error'),
    errorDescription: read('error_description'),
  };

  const hasAnything =
    result.code !== null ||
    result.accessToken !== null ||
    result.refreshToken !== null ||
    result.errorCode !== null;
  return hasAnything ? result : null;
}

/**
 * Người dùng tự huỷ ở Google (bấm Huỷ ở màn đồng ý) — không phải lỗi: Google
 * trả `error=access_denied` và không có mã riêng. GoTrue lại đổi MỌI lỗi 403
 * thành `error=access_denied` kèm `error_code` riêng (user_banned,
 * provider_email_needs_verification…) — những lỗi đó phải báo, không coi là huỷ.
 */
export function isOAuthCancellation(redirect: AuthRedirect): boolean {
  return (
    redirect.error === 'access_denied' &&
    (redirect.errorCode === null || redirect.errorCode === 'access_denied')
  );
}

/**
 * Câu tiếng Việt cho lỗi khi quay về từ Google — không dùng câu của link email
 * ("yêu cầu gửi lại email" vô nghĩa ở đây). Như describeRedirectError: KHÔNG
 * hiện error_description.
 */
export function describeOAuthError(redirect: AuthRedirect): string {
  if (redirect.errorCode === 'provider_email_needs_verification') {
    return 'Email Google của bạn chưa được xác minh. Kiểm tra hộp thư để xác minh rồi thử lại.';
  }
  return 'Không đăng nhập được bằng Google. Thử lại, hoặc dùng email và mật khẩu.';
}

/** Câu tiếng Việt cho lỗi của link trong email. */
export function describeRedirectError(redirect: AuthRedirect): string {
  if (redirect.errorCode === 'otp_expired') {
    return 'Link đã hết hạn hoặc đã được dùng. Hãy yêu cầu gửi lại email mới.';
  }
  if (redirect.errorCode === 'access_denied') {
    return 'Link không còn hợp lệ. Hãy yêu cầu gửi lại email mới.';
  }
  // KHÔNG hiện error_description: nó nằm nguyên văn trên URL, ai cũng soạn được
  // ("Tài khoản bị khoá, chuyển 50.000đ tới STK… để mở") và sẽ hiện trong khung
  // lỗi ngay trên domain thật của app. Chỉ dùng câu có sẵn theo mã lỗi.
  return 'Link không hợp lệ. Hãy yêu cầu gửi lại email mới.';
}
