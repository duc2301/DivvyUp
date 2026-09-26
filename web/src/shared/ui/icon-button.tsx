import type { LucideIcon } from 'lucide-react';

import { Spinner } from './spinner';

type Variant = 'ghost' | 'primary' | 'danger' | 'onImage';

interface IconButtonProps {
  readonly icon: LucideIcon;
  /** BẮT BUỘC: nút không có chữ nên trình đọc màn hình chỉ có nhãn này. */
  readonly label: string;
  readonly onClick: () => void;
  readonly variant?: Variant;
  readonly disabled?: boolean;
  readonly busy?: boolean;
}

const CONTAINER: Record<Variant, string> = {
  ghost: 'text-foreground hover:bg-muted',
  primary: 'bg-primary text-primary-foreground',
  danger: 'text-negative hover:bg-muted',
  // Nền mờ nhẹ để nút đọc được trên mọi ảnh bìa.
  onImage: 'bg-scrim/30 text-on-image backdrop-blur-sm',
};

/** Vùng chạm luôn 44×44 kể cả khi icon chỉ 22px. */
export function IconButton({
  icon: Icon,
  label,
  onClick,
  variant = 'ghost',
  disabled = false,
  busy = false,
}: IconButtonProps) {
  const inactive = disabled || busy;
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={inactive}
      aria-busy={busy || undefined}
      onClick={onClick}
      className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition active:opacity-60 disabled:cursor-not-allowed disabled:opacity-40 ${CONTAINER[variant]}`}>
      {busy ? (
        <Spinner />
      ) : (
        <Icon size={22} strokeWidth={variant === 'onImage' ? 2.5 : 2} aria-hidden />
      )}
    </button>
  );
}
