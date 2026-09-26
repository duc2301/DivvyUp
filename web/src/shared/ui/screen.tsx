import type { ReactNode } from 'react';

interface ScreenProps {
  readonly children: ReactNode;
  /** Phần cố định phía trên (thường là AppHeader), dính khi cuộn. */
  readonly header?: ReactNode;
}

/**
 * Khung một màn: cột max-w-md căn giữa (trên máy tính trông như điện thoại),
 * chừa tai thỏ và thanh home của iPhone qua env(safe-area-inset-*).
 */
export function Screen({ children, header }: ScreenProps) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col bg-background px-safe">
      {header ? (
        <header className="sticky top-0 z-20 bg-background/95 pt-safe backdrop-blur">
          {header}
        </header>
      ) : (
        <div className="pt-safe" />
      )}
      <main className="flex flex-1 flex-col gap-4 px-4 pb-24 pt-2">{children}</main>
    </div>
  );
}
