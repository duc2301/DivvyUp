import { getPaymentInfo } from '@/entities/profile';
import { useAsync } from '@/shared/lib/async';
import type { Money } from '@/shared/lib/money';
import { formatMoney } from '@/shared/lib/money';
import { Avatar, Button, ErrorView, LoadingView, Sheet } from '@/shared/ui';

export interface PaymentTarget {
  readonly fromName: string;
  readonly toName: string;
  /** Tài khoản của người nhận; null nếu chỗ đó chưa ai nhận trong app. */
  readonly toUserId: string | null;
  readonly toAvatarUrl: string | null;
  readonly amount: Money;
}

interface PaymentSheetProps {
  readonly target: PaymentTarget | null;
  readonly onClose: () => void;
}

/** Ai trả ai bao nhiêu, kèm mã QR nhận tiền của người nhận (qua getPaymentInfo). */
export function PaymentSheet({ target, onClose }: PaymentSheetProps) {
  const toUserId = target?.toUserId ?? null;
  const { data, error, loading, reload } = useAsync(async () => {
    if (!toUserId) return null;
    return getPaymentInfo(toUserId);
  }, [toUserId]);

  return (
    <Sheet open={target !== null} onClose={onClose}>
      {target ? (
        <>
          <div className="flex items-center gap-3">
            <Avatar
              name={target.toName}
              uri={data?.avatarUrl ?? target.toAvatarUrl}
              size="md"
              pending={!toUserId}
            />
            <div className="min-w-0 flex-1">
              <p className="text-xs text-muted-foreground">{target.fromName} chuyển cho</p>
              <p className="truncate text-lg font-semibold text-foreground">{target.toName}</p>
            </div>
            <p className="text-xl font-bold text-primary">{formatMoney(target.amount)}</p>
          </div>

          <div className="flex flex-col items-center rounded-2xl border border-border bg-background p-4">
            {!toUserId ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                {target.toName} chưa vào app nên chưa có mã QR. Gửi mã mời để họ nhận chỗ và thêm
                mã QR trong Hồ sơ.
              </p>
            ) : loading && data === null ? (
              <LoadingView label="Đang tải mã QR…" />
            ) : error ? (
              <ErrorView message={error} onRetry={reload} />
            ) : data?.qrUrl ? (
              <img
                src={data.qrUrl}
                alt={`Mã QR nhận tiền của ${target.toName}`}
                width={260}
                height={260}
                className="h-[260px] w-[260px] object-contain"
              />
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">
                {target.toName} chưa thêm mã QR nhận tiền.
              </p>
            )}
            {data?.note ? (
              <p className="mt-3 select-all text-center text-sm font-medium text-foreground">
                {data.note}
              </p>
            ) : null}
          </div>

          <Button label="Đóng" variant="secondary" onClick={onClose} />
        </>
      ) : null}
    </Sheet>
  );
}
