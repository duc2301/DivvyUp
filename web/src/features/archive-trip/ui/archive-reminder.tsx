import { Archive } from 'lucide-react';
import { useNavigate } from 'react-router';

import { Button } from '@/shared/ui';

interface ArchiveReminderProps {
  /** Số chuyến đã kết thúc còn ở danh sách chính. */
  readonly count: number;
  readonly archiveHref: string;
  readonly onDismiss: () => void;
}

/** Banner nhắc lưu trữ ở đầu danh sách chính. */
export function ArchiveReminder({ count, archiveHref, onDismiss }: ArchiveReminderProps) {
  const navigate = useNavigate();
  return (
    <section
      aria-label="Nhắc lưu trữ chuyến đã kết thúc"
      className="flex flex-col gap-3 rounded-3xl border border-border bg-card p-5 shadow-sm">
      <div className="flex items-center gap-3">
        <Archive size={20} className="text-accent-strong" aria-hidden />
        <h2 className="min-w-0 flex-1 text-base font-semibold text-foreground">
          {count} chuyến đã kết thúc
        </h2>
      </div>
      <p className="text-sm leading-5 text-muted-foreground">
        Lưu trữ để danh sách gọn hơn. Chỉ ẩn khỏi danh sách của bạn — người khác vẫn thấy bình
        thường, và bạn xem lại được trong mục Lưu trữ.
      </p>
      <div className="flex gap-3">
        <Button label="Để sau" variant="secondary" className="min-w-0 flex-1" onClick={onDismiss} />
        <Button
          label="Xem & lưu trữ"
          className="min-w-0 flex-1"
          onClick={() => void navigate(archiveHref)}
        />
      </div>
    </section>
  );
}
