import type { ReactNode } from 'react';

import { SessionProvider } from '@/entities/session';
import { ThemeProvider } from '@/shared/lib/theme';

export function AppProviders({ children }: { readonly children: ReactNode }) {
  return (
    <ThemeProvider>
      <SessionProvider>{children}</SessionProvider>
    </ThemeProvider>
  );
}
