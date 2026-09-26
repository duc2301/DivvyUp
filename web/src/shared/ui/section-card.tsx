import type { ReactNode } from 'react';

interface SectionCardProps {
  readonly title?: ReactNode;
  readonly hint?: ReactNode;
  readonly children: ReactNode;
}

/** Thẻ bo 28px, viền mảnh + bóng mềm — tách khỏi nền trắng bằng viền, không bằng màu. */
export function SectionCard({ title, hint, children }: SectionCardProps) {
  return (
    <section className="rounded-3xl border border-border bg-card p-5 text-card-foreground shadow-sm">
      {title ? (
        <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          {title}
        </h2>
      ) : null}
      {hint ? <p className="mt-1.5 text-xs leading-5 text-muted-foreground">{hint}</p> : null}
      <div className={title || hint ? 'mt-4' : ''}>{children}</div>
    </section>
  );
}
