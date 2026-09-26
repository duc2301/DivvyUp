import type { ReactNode } from 'react';

import { Button } from './button';
import { Spinner } from './spinner';

/** Bốn trạng thái mọi màn gọi dữ liệu phải xử lý: đang tải, lỗi, rỗng, có dữ liệu. */

export function LoadingView({ label = 'Đang tải…' }: { readonly label?: string }) {
  return (
    <div role="status" className="flex flex-col items-center gap-3 py-10 text-muted-foreground">
      <Spinner size={24} />
      <p className="text-sm">{label}</p>
    </div>
  );
}

interface ErrorViewProps {
  readonly message: string;
  readonly onRetry?: () => void;
}

export function ErrorView({ message, onRetry }: ErrorViewProps) {
  return (
    <div role="alert" className="flex flex-col gap-3 rounded-2xl border border-negative bg-card p-4">
      <p className="text-sm font-semibold text-negative">{message}</p>
      {onRetry ? <Button label="Thử lại" variant="secondary" onClick={onRetry} /> : null}
    </div>
  );
}

interface EmptyViewProps {
  readonly title: string;
  readonly hint?: string;
  readonly actionLabel?: string;
  readonly onAction?: () => void;
}

export function EmptyView({ title, hint, actionLabel, onAction }: EmptyViewProps) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border px-4 py-10 text-center">
      <p className="text-base font-semibold text-foreground">{title}</p>
      {hint ? <p className="text-sm text-muted-foreground">{hint}</p> : null}
      {actionLabel && onAction ? (
        <div className="w-full pt-1">
          <Button label={actionLabel} onClick={onAction} />
        </div>
      ) : null}
    </div>
  );
}

interface NoticeViewProps {
  readonly message: string;
  readonly tone?: 'success' | 'info';
  readonly children?: ReactNode;
}

export function NoticeView({ message, tone = 'info', children }: NoticeViewProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex flex-col gap-3 rounded-2xl border bg-card p-4 ${
        tone === 'success' ? 'border-positive' : 'border-border'
      }`}>
      <p
        className={`text-sm ${tone === 'success' ? 'font-semibold text-positive' : 'text-foreground'}`}>
        {message}
      </p>
      {children}
    </div>
  );
}
