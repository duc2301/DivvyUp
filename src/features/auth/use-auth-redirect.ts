import * as Linking from 'expo-linking';
import { useEffect, useMemo } from 'react';
import { Platform } from 'react-native';

import type { AuthRedirect } from './auth-redirect';
import { parseAuthRedirect } from './auth-redirect';

/** Tham số do Supabase Auth gắn vào URL — không phải của app. */
const AUTH_QUERY_KEYS = ['code', 'sb_flow_id', 'error', 'error_code', 'error_description'];

/**
 * Dữ liệu auth trong URL đã mở app (link xác nhận email, link đặt lại mật khẩu).
 *
 * LƯU Ý: đây là URL GẦN NHẤT đã mở app, không nhất thiết là lý do màn hình hiện
 * tại được mở. Màn dùng hook này phải tự đối chiếu với tham số route của chính
 * nó (vd `confirmed=1`) trước khi tin — nếu không, một link lỗi mở app từ hôm
 * qua sẽ hiện lại thông báo lỗi mỗi lần quay về màn đăng nhập.
 *
 * Trên web, dữ liệu auth nằm trên thanh địa chỉ — xoá ngay sau khi đọc để nó
 * không nằm lại trong lịch sử, và tải lại trang không dùng lại mã đã tiêu.
 */
export function useAuthRedirect(): AuthRedirect | null {
  // useLinkingURL chứ KHÔNG phải useURL: useURL chỉ nghe sự kiện phát ra SAU
  // khi màn hình mount. App đang chạy nền mà bấm link, expo-router nhận sự kiện
  // và mở màn này trước — useURL không bao giờ thấy link, màn đặt lại mật khẩu
  // báo "link không hợp lệ". useLinkingURL trả ngay URL gần nhất đã mở app.
  const url = Linking.useLinkingURL();
  const redirect = useMemo(() => parseAuthRedirect(url), [url]);

  useEffect(() => {
    if (Platform.OS !== 'web' || redirect === null || typeof window === 'undefined') return;
    // Hoãn một nhịp: expo-router ghi lại URL từ trạng thái điều hướng ngay sau
    // khi màn mount, xoá sớm hơn thì bị chính router ghi đè trở lại.
    const timer = setTimeout(() => {
      const { pathname, search, hash } = window.location;
      const query = new URLSearchParams(search);
      const hadAuthQuery = AUTH_QUERY_KEYS.some((key) => query.has(key));
      if (hash === '' && !hadAuthQuery) return;
      AUTH_QUERY_KEYS.forEach((key) => query.delete(key));
      const rest = query.toString();
      window.history.replaceState(window.history.state, '', `${pathname}${rest ? `?${rest}` : ''}`);
    }, 0);
    return () => clearTimeout(timer);
  }, [redirect]);

  return redirect;
}
