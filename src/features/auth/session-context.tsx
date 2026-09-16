import type { ReactNode } from 'react';
import { createContext, useContext } from 'react';

import type { SessionState } from './use-session';
import { useSession } from './use-session';

const SessionContext = createContext<SessionState | null>(null);

/**
 * Một nguồn duy nhất cho trạng thái đăng nhập của cả app.
 *
 * Không để mỗi màn tự gọi useSession(): mỗi lần gọi là một subscription
 * onAuthStateChange riêng, và chúng sẽ lệch nhau vài nhịp render.
 */
export function SessionProvider({ children }: { readonly children: ReactNode }) {
  const value = useSession();
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSessionContext(): SessionState {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error('useSessionContext must be used within a SessionProvider');
  }
  return context;
}
