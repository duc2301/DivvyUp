import type { Session } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

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
    });

    return () => {
      cancelled = true;
      listener.subscription.unsubscribe();
    };
  }, []);

  // Hàm này sẽ được gọi từ SignIn screen khi chọn "Tiếp tục với tư cách khách".
  const setGuestMode = async (val: boolean) => {
    setIsGuest(val);
    await AsyncStorage.setItem('divvyup_is_guest', String(val));
  };

  return { session, loading, userId: session?.user.id ?? null, isGuest, setGuestMode };
}
