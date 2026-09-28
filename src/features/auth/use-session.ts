import type { Session } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import type { NeedsPasswordResult } from '@/lib/auth/password-gate';
import { currentNeedsPassword, gateProviders } from '@/lib/auth/password-gate';
import { fetchNeedsPassword } from '@/lib/data/account';
import { supabase } from '@/lib/supabase/client';


export interface SessionState {
  readonly session: Session | null;
  /** true cho tới khi biết chắc là có hay không có phiên đăng nhập. */
  readonly loading: boolean;
  readonly userId: string | null;
  /** true nếu người dùng chọn dùng app với tư cách khách (lưu local). */
  readonly isGuest: boolean;
  /** Đặt chế độ khách và lưu vào AsyncStorage. */
  readonly setGuestMode: (val: boolean) => Promise<void>;
  /**
   * Tài khoản mới tạo qua Google chưa có mật khẩu → phải qua màn Đặt mật khẩu.
   * null = đang kiểm (chỉ khi có phiên); không có phiên → false.
   */
  readonly needsPassword: boolean | null;
  /**
   * Gọi ngay sau khi đặt mật khẩu THÀNH CÔNG: đánh dấu đã có mật khẩu mà không
   * hỏi lại máy chủ — hỏi lại mà lỗi mạng thì người dùng kẹt ở cổng dù mật khẩu
   * đã lưu.
   */
  readonly markPasswordSet: () => void;
}

/**
 * Theo dõi phiên đăng nhập Supabase.
 *
 * `loading` là trạng thái riêng, không gộp với `session === null`: lúc mới mở
 * app, đọc phiên từ AsyncStorage mất vài chục mili giây. Không tách ra thì màn
 * hình đăng nhập sẽ chớp một cái rồi biến mất với người đã đăng nhập sẵn.
 */
export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [isGuest, setIsGuest] = useState(false);
  // Kết quả cổng đặt mật khẩu, gắn với người được kiểm.
  const [needsPassword, setNeedsPassword] = useState<NeedsPasswordResult | null>(null);
  // Tăng để kiểm lại cổng (kết quả trước chưa chắc — lỗi/quá giờ).
  const [recheck, setRecheck] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        // Kiểm tra xem trước đó có chọn làm khách không.
        const guestStored = await AsyncStorage.getItem('divvyup_is_guest');
        if (guestStored === 'true') setIsGuest(true);

        const { data } = await supabase.auth.getSession();
        if (cancelled) return;
        setSession(data.session);
      } catch {
        if (cancelled) return;
        setSession(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void init();

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (cancelled) return;
      setSession(nextSession);
      setLoading(false);
      // Hết phiên thì bỏ kết quả kiểm: đăng nhập lại đúng người đó phải kiểm lại,
      // không dùng giá trị cũ (vd đã đặt mật khẩu ở máy khác trong lúc đó).
      if (nextSession === null) setNeedsPassword(null);
      // Có phiên thật thì thôi làm khách. Không tắt cờ, app ở trạng thái lai:
      // menu vẫn hiện "Khách" không có nút Đăng xuất, và mọi dữ liệu vẫn ghi
      // vào máy thay vì lên tài khoản vừa đăng nhập.
      if (nextSession !== null) {
        setIsGuest(false);
        void AsyncStorage.setItem('divvyup_is_guest', 'false').catch(() => undefined);
      }
    });

    return () => {
      cancelled = true;
      listener.subscription.unsubscribe();
    };
  }, []);

  // Cổng đặt mật khẩu. Deps là giá trị nguyên thuỷ (id + danh sách nhà cung
  // cấp đã sắp xếp): đổi người hoặc vừa liên kết Google thì kiểm lại, làm mới
  // token thì không. Không cần eslint-disable — thứ đó làm React Compiler bỏ
  // qua cả hook này.
  const userId = session?.user.id ?? null;
  const providers = gateProviders(session?.user);
  const providersKey = providers.join(',');
  useEffect(() => {
    if (userId === null) return;
    let cancelled = false;
    // fetchNeedsPassword không ném lỗi và có hạn chờ; vẫn chốt catch: promise
    // treo ở đây là AuthGate chờ mãi.
    void fetchNeedsPassword(providersKey === '' ? [] : providersKey.split(','))
      .catch(() => ({ value: false, certain: false }))
      .then((check) => {
        if (!cancelled) setNeedsPassword({ userId, ...check });
      });
    return () => {
      cancelled = true;
    };
  }, [userId, providersKey, recheck]);

  // Lần kiểm trước lỗi/quá giờ (tạm cho qua): quay lại app thì kiểm lại — quyết
  // định "bắt buộc đặt mật khẩu" không bị bỏ qua cả phiên vì một lần mạng chập.
  const uncertain = needsPassword !== null && !needsPassword.certain;
  useEffect(() => {
    if (!uncertain) return;
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') setRecheck((value) => value + 1);
    });
    return () => subscription.remove();
  }, [uncertain]);

  const markPasswordSet = (): void => {
    if (userId !== null) setNeedsPassword({ userId, value: false, certain: true });
  };

  const needsPasswordNow = currentNeedsPassword(userId, needsPassword, providers);

  // Hàm này sẽ được gọi từ SignIn screen khi chọn "Tiếp tục với tư cách khách".
  const setGuestMode = async (val: boolean) => {
    setIsGuest(val);
    await AsyncStorage.setItem('divvyup_is_guest', String(val));
  };

  return {
    session,
    loading,
    userId: session?.user.id ?? null,
    isGuest,
    setGuestMode,
    needsPassword: needsPasswordNow,
    markPasswordSet,
  };
}
