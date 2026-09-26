import { useState } from 'react';

type Size = 'sm' | 'md' | 'lg';

interface AvatarProps {
  readonly name: string;
  readonly uri?: string | null;
  readonly size?: Size;
  /** Chỗ chưa ai nhận trong app: chữ cái trên nền nhạt, viền đứt. */
  readonly pending?: boolean;
}

const DIMENSION: Record<Size, number> = { sm: 32, md: 40, lg: 96 };
const TEXT: Record<Size, string> = { sm: 'text-xs', md: 'text-sm', lg: 'text-3xl' };

/** Chữ cái đầu của TỪ CUỐI — tên tiếng Việt gọi theo tên, không theo họ. */
function initialOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const last = words[words.length - 1] ?? '?';
  return last.charAt(0).toUpperCase();
}

export function Avatar({ name, uri, size = 'md', pending = false }: AvatarProps) {
  const dimension = DIMENSION[size];
  const [broken, setBroken] = useState<string | null>(null);

  if (uri && broken !== uri) {
    return (
      <img
        src={uri}
        alt={`Ảnh đại diện của ${name}`}
        width={dimension}
        height={dimension}
        loading="lazy"
        onError={() => setBroken(uri)}
        style={{ width: dimension, height: dimension }}
        className="shrink-0 rounded-full object-cover"
      />
    );
  }

  return (
    <span
      role="img"
      aria-label={`Ảnh đại diện của ${name}`}
      style={{ width: dimension, height: dimension }}
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold ${TEXT[size]} ${
        pending
          ? 'border border-dashed border-border bg-muted text-muted-foreground'
          : 'bg-accent text-accent-foreground'
      }`}>
      {initialOf(name)}
    </span>
  );
}
