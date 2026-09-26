import type { ReactNode } from 'react';
import { useEffect, useId } from 'react';
import { createPortal } from 'react-dom';

import { Button } from './button';

interface OverlayProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** Khoá đóng (đang xử lý): chạm nền hay Esc không đóng được. */
  readonly locked?: boolean;
  readonly placement: 'center' | 'bottom';
  readonly labelledBy?: string;
  readonly children: ReactNode;
}

/** Lớp phủ dùng chung cho Sheet và Dialog: portal, nền mờ, Esc để đóng, khoá cuộn nền. */
function Overlay({ open, onClose, locked = false, placement, labelledBy, children }: OverlayProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !locked) onClose();
    };
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, locked, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      className={`fixed inset-0 z-50 flex justify-center ${
        placement === 'center' ? 'items-center px-6' : 'items-end'
      }`}>
      <button
        type="button"
        aria-label="Đóng"
        tabIndex={-1}
        disabled={locked}
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-scrim/50"
      />
      {children}
    </div>,
    document.body,
  );
}

interface SheetProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title?: string;
  readonly locked?: boolean;
  readonly children: ReactNode;
}

/** Bảng trượt từ đáy lên, giống Modal animationType="slide" của mobile. */
export function Sheet({ open, onClose, title, locked, children }: SheetProps) {
  const titleId = useId();
  return (
    <Overlay
      open={open}
      onClose={onClose}
      locked={locked}
      placement="bottom"
      labelledBy={title ? titleId : undefined}>
      <div className="relative flex max-h-[85dvh] w-full max-w-md flex-col gap-4 overflow-y-auto rounded-t-3xl bg-card px-5 pb-safe pt-3 text-card-foreground">
        <span aria-hidden className="h-1.5 w-12 shrink-0 self-center rounded-full bg-muted" />
        {title ? (
          <h2 id={titleId} className="text-lg font-semibold text-foreground">
            {title}
          </h2>
        ) : null}
        {children}
        <div className="h-4 shrink-0" />
      </div>
    </Overlay>
  );
}

interface ConfirmDialogProps {
  readonly open: boolean;
  readonly title: string;
  readonly message: string;
  readonly confirmLabel: string;
  readonly cancelLabel?: string;
  readonly destructive?: boolean;
  readonly busy?: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

/** Hộp xác nhận cho thao tác không hoàn tác được. Đang xử lý thì không đóng được. */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel = 'Huỷ',
  destructive = false,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const titleId = useId();
  return (
    <Overlay open={open} onClose={onCancel} locked={busy} placement="center" labelledBy={titleId}>
      <div className="relative flex w-full max-w-sm flex-col gap-4 rounded-3xl bg-card p-6 text-card-foreground">
        <h2 id={titleId} className="font-display text-xl font-semibold text-foreground">
          {title}
        </h2>
        <p className="text-sm leading-5 text-muted-foreground">{message}</p>
        <div className="flex gap-3 pt-2">
          <Button label={cancelLabel} variant="secondary" onClick={onCancel} disabled={busy} />
          <Button
            label={confirmLabel}
            variant={destructive ? 'danger' : 'primary'}
            onClick={onConfirm}
            busy={busy}
          />
        </div>
      </div>
    </Overlay>
  );
}

export interface PickerItem {
  readonly value: string;
  readonly label: string;
  readonly detail?: string;
  readonly disabled?: boolean;
}

interface PickerSheetProps {
  readonly open: boolean;
  readonly title: string;
  readonly items: readonly PickerItem[];
  readonly emptyText?: string;
  readonly onSelect: (value: string) => void;
  readonly onClose: () => void;
}

/** Chọn một mục trong danh sách — thay PickerModal của mobile. */
export function PickerSheet({ open, title, items, emptyText, onSelect, onClose }: PickerSheetProps) {
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      {items.length === 0 ? (
        <p className="py-4 text-sm text-muted-foreground">{emptyText ?? 'Không có lựa chọn nào.'}</p>
      ) : (
        <ul className="flex flex-col">
          {items.map((item) => (
            <li key={item.value}>
              <button
                type="button"
                disabled={item.disabled}
                onClick={() => onSelect(item.value)}
                className="flex min-h-12 w-full items-center justify-between gap-3 rounded-xl px-3 text-left text-base text-foreground hover:bg-muted active:bg-muted disabled:opacity-50">
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {item.detail ? (
                  <span className="text-xs text-muted-foreground">{item.detail}</span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      )}
      <Button label="Đóng" variant="secondary" onClick={onClose} />
    </Sheet>
  );
}
