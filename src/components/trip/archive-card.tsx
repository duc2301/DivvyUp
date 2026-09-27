import { Text, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Archive } from '@/components/ui/icons';
import { archiveCardCopy } from '@/lib/trips/archive';

interface ArchiveCardProps {
  /** Thời điểm NGƯỜI NÀY lưu trữ chuyến, null nếu chưa. */
  readonly archivedAt: string | null;
  /** Chuyến đã kết thúc (isTripEnded). */
  readonly ended: boolean;
  /** Số lần chuyển tiền còn lại theo cách tối giản — 0 là đã thanh toán xong. */
  readonly openTransfers: number;
  readonly busy: boolean;
  readonly onToggle: () => void;
}

/**
 * Thẻ lưu trữ ở trang chuyến đi. Chỉ hiện khi có việc để nói: chuyến đã lưu
 * trữ (cho bỏ lưu trữ), hoặc đã kết thúc mà chưa lưu trữ (nhắc lưu trữ). Chữ
 * dùng chung với web qua archiveCardCopy.
 */
export function ArchiveCard({ archivedAt, ended, openTransfers, busy, onToggle }: ArchiveCardProps) {
  const archived = archivedAt !== null;
  const copy = archiveCardCopy(archived, ended, openTransfers);
  if (!copy) return null;

  return (
    <View className="mt-3 gap-3 rounded-2xl border border-border bg-card p-4">
      <View className="flex-row items-center gap-3">
        <Archive size={18} className={archived ? 'text-muted-foreground' : 'text-accent-strong'} />
        <Text className="min-w-0 flex-1 text-sm font-semibold text-foreground">{copy.title}</Text>
      </View>
      <Text className="text-xs leading-5 text-muted-foreground">{copy.hint}</Text>
      <Button
        label={copy.action}
        variant={archived ? 'secondary' : 'primary'}
        busy={busy}
        onPress={onToggle}
      />
    </View>
  );
}
