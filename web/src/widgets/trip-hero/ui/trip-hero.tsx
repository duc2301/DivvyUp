import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';

import type { TripCoverImage } from '@/entities/trip';
import { assets } from '@/shared/config';
import { useGoBack } from '@/shared/lib/router';
import { IconButton } from '@/shared/ui';

interface TripHeroProps {
  readonly images: readonly TripCoverImage[];
  /** CHỈ đọc lúc mount — màn cha đặt `key` theo bộ ảnh để hero dựng lại khi dữ liệu về. */
  readonly initialIndex: number;
  readonly onEditPlace: () => void;
  /** Gọi khi NGƯỜI DÙNG dừng lướt ở một ảnh khác. */
  readonly onChangeIndex: (index: number) => void;
  readonly rightAction?: ReactNode;
  /** Dữ liệu chưa về: không hiện lời mời chọn địa điểm kẻo chớp nhầm. */
  readonly loading?: boolean;
  readonly backFallback?: string;
}

const MAX_DOTS = 10;
/** Web không có "hết quán tính" — coi như đã dừng sau từng này ms không cuộn. */
const SCROLL_SETTLE_MS = 160;

/**
 * Ảnh bìa lướt ngang (scroll-snap), bản web của components/ui/trip-hero.tsx.
 * Dừng ở ảnh nào thì ảnh đó thành ảnh hiện tại và được ghi lại.
 */
export function TripHero({
  images,
  initialIndex,
  onEditPlace,
  onChangeIndex,
  rightAction,
  loading = false,
  backFallback = '/',
}: TripHeroProps) {
  const goBack = useGoBack(backFallback);
  const scroller = useRef<HTMLDivElement>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [index, setIndex] = useState(() =>
    images.length === 0 ? 0 : Math.min(Math.max(initialIndex, 0), images.length - 1),
  );

  // Đưa về ảnh đã lưu ngay khi mount. Cố ý chạy một lần: hero được remount theo `key`.
  useEffect(() => {
    const element = scroller.current;
    if (element && index > 0) element.scrollTo({ left: index * element.clientWidth, behavior: 'instant' });
    return () => {
      if (settleTimer.current) clearTimeout(settleTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasCover = images.length > 0;
  const current = hasCover ? images[Math.min(index, images.length - 1)] : null;

  const settle = (): void => {
    const element = scroller.current;
    if (!element || element.clientWidth === 0) return;
    const next = Math.round(element.scrollLeft / element.clientWidth);
    // Lệnh cuộn do chính component phát ra rơi vào trang hiện tại nên bị bỏ qua.
    if (next === index || next < 0 || next >= images.length) return;
    setIndex(next);
    onChangeIndex(next);
  };

  const onScroll = (): void => {
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(settle, SCROLL_SETTLE_MS);
  };

  const step = (delta: number): void => {
    const element = scroller.current;
    if (!element) return;
    const target = Math.min(Math.max(index + delta, 0), images.length - 1);
    element.scrollTo({ left: target * element.clientWidth, behavior: 'smooth' });
  };

  return (
    <div className="relative h-[280px] w-full overflow-hidden bg-muted">
      {hasCover ? (
        <div
          ref={scroller}
          onScroll={onScroll}
          aria-label={`Bộ ảnh bìa, ảnh ${index + 1} trên ${images.length}`}
          className="scrollbar-none flex h-full snap-x snap-mandatory overflow-x-auto overscroll-x-contain">
          {images.map((image, imageIndex) => (
            <img
              key={image.url}
              src={image.url}
              alt=""
              draggable={false}
              loading={Math.abs(imageIndex - index) <= 1 ? 'eager' : 'lazy'}
              className="h-full w-full shrink-0 snap-start snap-always object-cover"
            />
          ))}
        </div>
      ) : loading ? null : (
        <>
          <img src={assets.tripPlaceholder} alt="" className="h-full w-full object-cover" />
          <button
            type="button"
            onClick={onEditPlace}
            className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-scrim/55 px-6 text-center text-on-image">
            <span aria-hidden className="text-2xl">
              📍
            </span>
            <span className="text-lg font-semibold">Chọn địa điểm cho chuyến đi</span>
            <span className="text-xs text-on-image/75">Ảnh bìa sẽ tự gợi ý theo nơi bạn chọn</span>
          </button>
        </>
      )}

      {/* Dải tối mờ ở mép trên để nút trắng đọc được trên ảnh trời sáng. */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-scrim/50 to-transparent" />

      <div className="pointer-events-none absolute inset-x-2 top-0 flex items-center justify-between pt-safe">
        <div className="pointer-events-auto mt-1.5">
          <IconButton icon={ChevronLeft} label="Quay lại" variant="onImage" onClick={goBack} />
        </div>
        <div className="pointer-events-auto mt-1.5">{rightAction ?? null}</div>
      </div>

      {/* Nút chuyển ảnh cho chuột (máy tính không vuốt được). */}
      {images.length > 1 ? (
        <>
          {index > 0 ? (
            <div className="absolute left-2 top-1/2 hidden -translate-y-1/2 sm:block">
              <IconButton icon={ChevronLeft} label="Ảnh trước" variant="onImage" onClick={() => step(-1)} />
            </div>
          ) : null}
          {index < images.length - 1 ? (
            <div className="absolute right-2 top-1/2 hidden -translate-y-1/2 sm:block">
              <IconButton icon={ChevronRight} label="Ảnh sau" variant="onImage" onClick={() => step(1)} />
            </div>
          ) : null}
        </>
      ) : null}

      {images.length > MAX_DOTS ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-[68px] flex justify-center">
          <span className="rounded-full bg-scrim/45 px-2.5 py-0.5 text-xs font-semibold text-on-image">
            {index + 1}/{images.length}
          </span>
        </div>
      ) : images.length > 1 ? (
        <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-[68px] flex justify-center gap-1.5">
          {images.map((image, dotIndex) => (
            <span
              key={image.url}
              className={`h-1.5 rounded-full ${dotIndex === index ? 'w-5 bg-on-image' : 'w-1.5 bg-on-image/50'}`}
            />
          ))}
        </div>
      ) : null}

      {/* Unsplash BẮT BUỘC ghi công tác giả kèm link. Chỉ mở link https. */}
      {current?.credit ? (
        current.link?.startsWith('https://') ? (
          <a
            href={current.link}
            target="_blank"
            rel="noopener noreferrer"
            className="absolute bottom-10 right-3 rounded-full bg-scrim/45 px-2 py-1 text-[10px] text-on-image">
            Ảnh: {current.credit}
          </a>
        ) : (
          <span className="absolute bottom-10 right-3 rounded-full bg-scrim/45 px-2 py-1 text-[10px] text-on-image">
            Ảnh: {current.credit}
          </span>
        )
      ) : null}
    </div>
  );
}
