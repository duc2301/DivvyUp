import type { Session } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';

import { supabase } from '@/lib/supabase/client';

export interface SessionState {
  readonly session: Session | null;
  /** true cho tới khi biết chắc là có hay không có phiên đăng nhập. */
  readonly loading: boolean;
  readonly userId: string | null;
}

/**
 * Theo dõi phiên đăng nhập Supabase.
 *
 * `loading` là trạng thái riêng, không gộp với `session === null`: lúc mới mở
 * app, đọc phiên từ AsyncStorage mất vài chục mili giây. Không tách ra thì màn
 * hình đăng nhập sẽ chớp một cái rồi biến mất với người đã đăng nhập sẵn.
 */
export function useSession(): SessionState {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    supabase.auth
      .getSession()
      .then(({ data }) => {
        // Người dùng có thể đã rời màn hình trước khi lời gọi này xong.
        if (cancelled) return;
        setSession(data.session);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setSession(null);
        setLoading(false);
      });

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

  return { session, loading, userId: session?.user.id ?? null };
}
