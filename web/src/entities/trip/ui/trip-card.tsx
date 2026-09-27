import { Link } from 'react-router';

import type { TripSummary } from '../api';
import { currentCover } from '../api';
import { tripListDateLabel } from '../lib/format';

interface TripCardProps {
  readonly trip: TripSummary;
  readonly to: string;
  /** Nhãn "Đã kết thúc" — gợi ý có thể lưu trữ. */
  readonly ended?: boolean;
}

/** Thẻ chuyến đi ở danh sách: nền là ảnh bìa đang chọn, lớp phủ tối để chữ đọc được. */
export function TripCard({ trip, to, ended = false }: TripCardProps) {
  const cover = currentCover(trip.cover);
  const dates = tripListDateLabel(trip.startDate, trip.endDate) ?? 'Chưa đặt ngày';

  return (
    <Link
      to={to}
      aria-label={`Mở chuyến đi ${trip.name}${ended ? ', đã kết thúc' : ''}`}
      className="relative block h-36 overflow-hidden rounded-3xl border border-border bg-card shadow-sm transition active:scale-[0.99]">
      {cover ? (
        <>
          <img
            src={cover.thumbUrl || cover.url}
            alt=""
            loading="lazy"
            className="absolute inset-0 h-full w-full object-cover"
          />
          <div className="absolute inset-0 flex flex-col justify-end bg-scrim/45 p-5">
            {ended ? <EndedChip onImage /> : null}
            <div className="flex items-center justify-between gap-3">
              <h2 className="min-w-0 flex-1 truncate font-display text-2xl font-semibold text-on-image">
                {trip.name}
              </h2>
              <span className="rounded-lg bg-on-image/20 px-2 py-1 text-xs font-semibold text-on-image">
                {trip.currency}
              </span>
            </div>
            <p className="mt-1 truncate text-sm text-on-image/80">
              {trip.place ? `📍 ${trip.place.name} · ` : ''}
              {dates}
            </p>
          </div>
        </>
      ) : (
        <div className="flex h-full flex-col justify-end p-5">
          {ended ? <EndedChip /> : null}
          <h2 className="truncate font-display text-2xl font-semibold text-foreground">{trip.name}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{dates}</p>
        </div>
      )}
    </Link>
  );
}

function EndedChip({ onImage = false }: { readonly onImage?: boolean }) {
  return (
    <span
      className={`absolute right-4 top-4 rounded-full px-2.5 py-1 text-xs font-semibold ${
        onImage ? 'bg-on-image/20 text-on-image' : 'bg-muted text-muted-foreground'
      }`}>
      Đã kết thúc
    </span>
  );
}
