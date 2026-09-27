import { Archive } from 'lucide-react';
import { useState } from 'react';

import { archiveCardCopy, getTripArchivedAt, isTripEnded, setTripArchived } from '@/entities/trip';
import { describeError, useAsync } from '@/shared/lib/async';
import { toIsoDate } from '@/shared/lib/datetime';
import { Button } from '@/shared/ui';

interface ArchiveCardProps {
  readonly trip: {
    readonly id: string;
    readonly startDate: string | null;
    readonly endDate: string | null;
  };
  /** Số lần chuyển tiền còn lại theo cách tối giản — 0 là đã thanh toán xong. */
  readonly openTransfers: number;
}

/**
 * Thẻ lưu trữ ở trang chuyến đi (bản web của components/trip/archive-card.tsx).
 * Chỉ hiện khi có việc để nói: đã lưu trữ (cho bỏ lưu trữ), hoặc đã kết thúc
 * mà chưa lưu trữ (nhắc). Tải trạng thái riêng — lỗi ở đây không làm hỏng trang.
 */
export function ArchiveCard({ trip, openTransfers }: ArchiveCardProps) {
  const state = useAsync(() => getTripArchivedAt(trip.id), [trip.id]);
  // Kết quả bấm gần nhất — không tải lại, kẻo thẻ biến mất lúc đang nhìn.
  const [override, setOverride] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (state.error) {
    return <p className="text-xs text-negative">Không đọc được trạng thái lưu trữ: {state.error}</p>;
  }
  if (override === undefined && state.loading) return null;

  const archivedAt = override !== undefined ? override : state.data;
  const archived = archivedAt !== null;
  const copy = archiveCardCopy(archived, isTripEnded(trip, toIsoDate(new Date())), openTransfers);
  if (!copy) return null;

  const toggle = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await setTripArchived(trip.id, !archived);
      setOverride(archived ? null : new Date().toISOString());
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center gap-3">
        <Archive
          size={18}
          className={archived ? 'text-muted-foreground' : 'text-accent-strong'}
          aria-hidden
        />
        <h2 className="min-w-0 flex-1 text-sm font-semibold text-foreground">
          {copy.title}
        </h2>
      </div>
      <p className="text-xs leading-5 text-muted-foreground">{copy.hint}</p>
      {error ? <p className="text-xs text-negative">{error}</p> : null}
      <Button
        label={copy.action}
        variant={archived ? 'secondary' : 'primary'}
        busy={busy}
        onClick={() => void toggle()}
      />
    </section>
  );
}
