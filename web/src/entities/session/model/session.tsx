import type { Session } from '@supabase/supabase-js';
import type { ReactNode } from 'react';
import { createContext, useContext, useEffect, useState } from 'react';

import { supabase } from '@/shared/api';

import type { NeedsPasswordResult } from '../api';
import { currentNeedsPassword, fetchNeedsPassword, gateProviders } from '../api';

interface SessionState {
  /** true cho tới khi supabase-js đọc xong phiên (kể cả đổi ?code trên URL). */
  readonly loading: boolean;
  readonly session: Session | null;
  readonly userId: string | null;
  /**
   * Tài khoản mới tạo qua Google chưa có mật khẩu → phải qua trang Đặt mật khẩu.
   * null = đang kiểm (chỉ khi có phiên); không có phiên → false.
   */
  readonly needsPassword: boolean | null;
  /**
   * Gọi ngay sau khi đặt mật khẩu THÀNH CÔNG: đánh dấu đã có mật khẩu mà không
   * hỏi lại máy chủ (hỏi lại mà lỗi mạng thì kẹt ở cổng dù mật khẩu đã lưu).
   */
  readonly markPasswordSet: () => void;
}

interface AuthState {
  readonly loading: boolean;
  readonly session: Session | null;
}

const SessionContext = createContext<SessionState | null>(null);

/**
 * Phiên đăng nhập theo supabase.auth.onAuthStateChange. Web bắt buộc đăng
 * nhập — không có chế độ khách như mobile.
 */
export function SessionProvider({ children }: { readonly children: ReactNode }) {
  const [auth, setAuth] = useState<AuthState>({ loading: true, session: null });
  // Kết quả cổng đặt mật khẩu, gắn với người được kiểm.
  const [checked, setChecked] = useState<NeedsPasswordResult | null>(null);
  // Tăng để kiểm lại cổng (kết quả trước chưa chắc — lỗi/quá giờ).
  const [recheck, setRecheck] = useState(0);

  useEffect(() => {
    let active = true;
    // INITIAL_SESSION luôn tới sau khi client khởi tạo xong, nên không cần getSession riêng.
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      setAuth({ loading: false, session });
      // Hết phiên thì bỏ kết quả kiểm — đăng nhập lại phải kiểm lại.
      if (session === null) setChecked(null);
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  // Cổng đặt mật khẩu. Deps nguyên thuỷ (id + nhà cung cấp đã sắp xếp): đổi
  // người hoặc vừa liên kết Google thì kiểm lại, làm mới token thì không.
  const userId = auth.session?.user.id ?? null;
  const providers = gateProviders(auth.session?.user);
  const providersKey = providers.join(',');
  useEffect(() => {
    if (userId === null) return;
    let active = true;
    // fetchNeedsPassword không ném và có hạn chờ; vẫn chốt catch để không bao
    // giờ treo guard ở màn tải.
    void fetchNeedsPassword(providersKey === '' ? [] : providersKey.split(','))
      .catch(() => ({ value: false, certain: false }))
      .then((check) => {
        if (active) setChecked({ userId, ...check });
      });
    return () => {
      active = false;
    };
  }, [userId, providersKey, recheck]);

  // Lần kiểm trước lỗi/quá giờ (tạm cho qua): tab được mở lại thì kiểm lại.
  const uncertain = checked !== null && !checked.certain;
  useEffect(() => {
    if (!uncertain) return;
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') setRecheck((value) => value + 1);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [uncertain]);

  const markPasswordSet = (): void => {
    if (userId !== null) setChecked({ userId, value: false, certain: true });
  };

  const value: SessionState = {
    loading: auth.loading,
    session: auth.session,
    userId,
    needsPassword: currentNeedsPassword(userId, checked, providers),
    markPasswordSet,
  };

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession phải nằm trong <SessionProvider>.');
  return value;
}
