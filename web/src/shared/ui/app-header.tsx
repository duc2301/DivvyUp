import { ChevronLeft } from 'lucide-react';
import type { ReactNode } from 'react';

import { useGoBack } from '../lib/router';

import { IconButton } from './icon-button';

interface AppHeaderProps {
  readonly title: string;
  readonly subtitle?: string;
  /** Có nút quay lại; mở thẳng bằng link thì nút đưa về `backFallback`. */
  readonly showBack?: boolean;
  readonly backFallback?: string;
  /** Thay hành vi mặc định của nút quay lại (vd: đóng trình soạn ghi chú). */
  readonly onBack?: () => void;
  readonly right?: ReactNode;
  /**
   * center: hàng nút ở trên, tiêu đề lớn căn giữa bên dưới.
   * inline: tiêu đề bên trái cùng hàng với nút — cho màn gốc.
   */
  readonly layout?: 'center' | 'inline';
}

export function AppHeader({
  title,
  subtitle,
  showBack = false,
  backFallback = '/',
  onBack,
  right,
  layout = 'center',
}: AppHeaderProps) {
  const goBack = useGoBack(backFallback);
  const back = showBack ? (
    <IconButton icon={ChevronLeft} label="Quay lại" onClick={onBack ?? goBack} />
  ) : null;

  if (layout === 'inline') {
    return (
      <div className="px-4 pb-2 pt-2">
        <div className="flex min-h-11 items-center gap-2">
          {back}
          <h1 className="min-w-0 flex-1 font-display text-3xl font-semibold leading-tight text-foreground">
            {title}
          </h1>
          {right ? <div className="flex items-center">{right}</div> : null}
        </div>
        {subtitle ? <p className="text-sm text-muted-foreground">{subtitle}</p> : null}
      </div>
    );
  }

  return (
    <div className="px-4 pb-2 pt-2">
      <div className="flex min-h-11 items-center justify-between">
        {back ?? <span className="h-11 w-11" />}
        {right ? <div className="flex items-center gap-1">{right}</div> : <span className="h-11 w-11" />}
      </div>
      <h1 className="mt-2 text-center font-display text-4xl font-semibold leading-tight text-foreground">
        {title}
      </h1>
      {subtitle ? <p className="mt-1 text-center text-sm text-muted-foreground">{subtitle}</p> : null}
    </div>
  );
}
