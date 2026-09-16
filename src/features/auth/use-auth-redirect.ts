import * as Linking from 'expo-linking';
import { useEffect, useMemo } from 'react';
import { Platform } from 'react-native';

import type { AuthRedirect } from './auth-redirect';
import { parseAuthRedirect } from './auth-redirect';

/**
 * Dữ liệu auth trong URL đã mở app (link xác nhận email, link đặt lại mật khẩu).
 *
 * Trên web, token nằm trên thanh địa chỉ — xoá ngay sau khi đọc để nó không
 * nằm lại trong lịch sử trình duyệt, và để tải lại trang không dùng lại một
 * token đã tiêu.
 */
export function useAuthRedirect(): AuthRedirect | null {
  const url = Linking.useURL();
  const redirect = useMemo(() => parseAuthRedirect(url), [url]);

  useEffect(() => {
    if (Platform.OS !== 'web' || redirect === null || typeof window === 'undefined') return;
    const { pathname, search, hash } = window.location;
    if (hash === '') return;
    window.history.replaceState(window.history.state, '', `${pathname}${search}`);
  }, [redirect]);

  return redirect;
}
