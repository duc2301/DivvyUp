/**
 * Cổng "Đặt mật khẩu" cho tài khoản tạo qua Google — phần thuần, dùng chung
 * mobile và web (qua @core), test bằng node --test.
 *
 * Supabase tạo tài khoản NGAY lúc Google trả về, không hoãn được. Người mới
 * qua Google chưa có mật khẩu → app bắt đặt mật khẩu trước khi vào. Máy chủ là
 * nguồn chân lý (RPC account_needs_password); ở đây chỉ quyết định CÓ CẦN hỏi
 * máy chủ không, để tài khoản chỉ dùng mật khẩu không bao giờ phải chờ hay bị
 * kẹt ở cổng này.
 */

interface IdentityLike {
  readonly provider?: string | null;
}

interface UserLike {
  readonly id?: string;
  readonly identities?: readonly IdentityLike[] | null;
  readonly app_metadata?: { readonly providers?: unknown } | null;
}

/**
 * Tài khoản có đăng nhập bằng nhà cung cấp khác email/mật khẩu (Google…) → có
 * thể chưa có mật khẩu, cần hỏi máy chủ. Chỉ có 'email' → chắc chắn có mật
 * khẩu, không hỏi. Không đọc được gì → không hỏi (thà cho vào còn hơn chặn
 * nhầm người đã có mật khẩu).
 */
export function mayNeedPassword(user: UserLike | null | undefined): boolean {
  return providersMayNeedPassword(gateProviders(user));
}

/**
 * Nhà cung cấp đăng nhập của tài khoản (identities, thiếu thì app_metadata),
 * đã khử trùng và sắp xếp — dùng làm khoá "khi nào kiểm lại" bằng chuỗi nguyên
 * thuỷ: đổi thứ tự trả về của máy chủ không làm kiểm lại vô cớ.
 */
export function gateProviders(user: UserLike | null | undefined): string[] {
  if (!user) return [];
  const fromIdentities = (user.identities ?? [])
    .map((identity) => identity.provider)
    .filter((provider): provider is string => typeof provider === 'string' && provider !== '');
  const rawProviders = user.app_metadata?.providers;
  const fromMetadata = Array.isArray(rawProviders)
    ? rawProviders.filter((provider): provider is string => typeof provider === 'string' && provider !== '')
    : [];
  const providers = fromIdentities.length > 0 ? fromIdentities : fromMetadata;
  return [...new Set(providers)].sort();
}

/** Có nhà cung cấp nào khác email/mật khẩu → có thể chưa có mật khẩu, phải hỏi máy chủ. */
export function providersMayNeedPassword(providers: readonly string[]): boolean {
  return providers.some((provider) => provider !== 'email');
}

/**
 * Kết quả kiểm tra máy chủ → có chặn ở cổng không. Lỗi (mất mạng, RPC chưa
 * có vì migration chưa chạy) → KHÔNG chặn: chặn nhầm thì người đã có mật khẩu
 * bị đưa vào màn đặt mật khẩu và ghi đè mất mật khẩu cũ. Lần mở app sau kiểm
 * lại. Chỉ chặn khi máy chủ trả đúng `true`.
 */
export function gateFromServer(result: { readonly ok: true; readonly value: unknown } | { readonly ok: false }): boolean {
  return result.ok && result.value === true;
}

/**
 * Kết quả kiểm với máy chủ. `certain` false = lỗi hoặc quá giờ: tạm cho qua
 * (value false) nhưng phải kiểm lại khi app quay lại — không cho qua cả phiên.
 */
export interface NeedsPasswordCheck {
  readonly value: boolean;
  readonly certain: boolean;
}

/** Kết quả kiểm đã lưu, gắn với người dùng được kiểm. */
export interface NeedsPasswordResult extends NeedsPasswordCheck {
  readonly userId: string;
}

/**
 * Giá trị cổng cho người dùng HIỆN TẠI: không có người dùng → false; kết quả
 * lưu là của NGƯỜI KHÁC (vừa đổi tài khoản) hoặc chưa có → null (đang kiểm).
 */
export function currentNeedsPassword(
  userId: string | null,
  checked: NeedsPasswordResult | null,
  providers: readonly string[] = ['?'],
): boolean | null {
  if (userId === null) return false;
  // Chỉ dùng email/mật khẩu → chắc chắn đã có mật khẩu, không chờ nhịp kiểm nào
  // (không chớp lớp che sau khi đăng nhập bằng mật khẩu).
  if (!providersMayNeedPassword(providers)) return false;
  return checked?.userId === userId ? checked.value : null;
}

/**
 * signUp trả "thành công" giả khi email ĐÃ có tài khoản (chống dò email): có
 * user nhưng identities rỗng, và KHÔNG gửi email nào. Nhận ra để báo đúng thay
 * vì "Đã gửi email xác nhận".
 */
export function isExistingAccountSignUp(user: UserLike | null | undefined): boolean {
  return user != null && Array.isArray(user.identities) && user.identities.length === 0;
}
