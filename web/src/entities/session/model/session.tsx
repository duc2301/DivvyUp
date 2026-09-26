import type { Session } from '@supabase/supabase-js';
import type { ReactNode } from 'react';
import { createContext, useContext, useEffect, useState } from 'react';

import { supabase } from '@/shared/api';

interface SessionState {
  /** true cho tới khi supabase-js đọc xong phiên (kể cả đổi ?code trên URL). */
  readonly loading: boolean;
  readonly session: Session | null;
  readonly userId: string | null;
}

const SessionContext = createContext<SessionState | null>(null);

/**
 * Phiên đăng nhập theo supabase.auth.onAuthStateChange. Web bắt buộc đăng
 * nhập — không có chế độ khách như mobile.
 */
export function SessionProvider({ children }: { readonly children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ loading: true, session: null, userId: null });

  useEffect(() => {
    let active = true;
    // INITIAL_SESSION luôn tới sau khi client khởi tạo xong, nên không cần getSession riêng.
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      setState({ loading: false, session, userId: session?.user.id ?? null });
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  return <SessionContext.Provider value={state}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession phải nằm trong <SessionProvider>.');
  return value;
}
