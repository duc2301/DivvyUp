import type { LucideIcon } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { Spinner } from './spinner';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  readonly label: ReactNode;
  readonly variant?: Variant;
  readonly busy?: boolean;
  readonly icon?: LucideIcon;
}

const CONTAINER: Record<Variant, string> = {
  primary: 'bg-primary text-primary-foreground',
  secondary: 'border border-border bg-card text-foreground',
  ghost: 'bg-transparent text-muted-foreground',
  danger: 'bg-negative text-primary-foreground',
};

/** Nút viên thuốc cao 56px — cùng ngôn ngữ thẻ mềm với app. */
export function Button({
  label,
  variant = 'primary',
  busy = false,
  disabled = false,
  icon: Icon,
  type = 'button',
  className = '',
  ...rest
}: ButtonProps) {
  const inactive = disabled || busy;
  return (
    <button
      type={type}
      disabled={inactive}
      aria-busy={busy || undefined}
      className={`flex min-h-14 w-full items-center justify-center gap-2 rounded-full px-5 text-base font-semibold transition active:opacity-80 disabled:cursor-not-allowed disabled:opacity-40 ${CONTAINER[variant]} ${className}`}
      {...rest}>
      {busy ? <Spinner /> : Icon ? <Icon size={20} aria-hidden /> : null}
      <span className="min-w-0 truncate">{label}</span>
    </button>
  );
}
