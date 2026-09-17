import { Image } from 'expo-image';
import { Modal, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { getPaymentInfo } from '@/lib/data/profile';
import { useAsync } from '@/lib/data/use-async';
import type { Money } from '@/lib/money';
import { formatMoney } from '@/lib/money';

import { Avatar } from './avatar';
import { Button } from './button';
import { ErrorView, LoadingView } from './state-views';

export interface PaymentTarget {
  readonly fromName: string;
  readonly toName: string;
  /** Tài khoản của người nhận; null nếu chỗ đó chưa có ai nhận trong app. */
  readonly toUserId: string | null;
  readonly toAvatarUrl: string | null;
  readonly amount: Money;
}

interface PaymentSheetProps {
  readonly target: PaymentTarget | null;
  /** Chế độ khách: không có tài khoản nên không có mã QR của ai cả. */
  readonly guest?: boolean;
  readonly onClose: () => void;
}

/**
 * Bảng "chuyển tiền": ai trả ai bao nhiêu, kèm mã QR nhận tiền của người nhận.
 *
 * Mở ra từ dòng "ai trả ai" trong tab Số dư. Mục đích là khỏi phải nhắn tin hỏi
 * số tài khoản: quét mã ngay trên màn hình, hoặc chụp màn hình rồi mở app ngân
 * hàng quét lại.
 */
export function PaymentSheet({ target, guest = false, onClose }: PaymentSheetProps) {
  const insets = useSafeAreaInsets();
  const toUserId = target?.toUserId ?? null;

  const { data, error, loading, reload } = useAsync(async () => {
    if (!toUserId) return null;
    return getPaymentInfo(toUserId);
  }, [toUserId]);

  return (
    <Modal visible={target !== null} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Đóng"
        onPress={onClose}
        className="absolute inset-0 bg-black/50"
      />
      {target ? (
        <View
          style={{ paddingBottom: insets.bottom + 16 }}
          className="absolute inset-x-0 bottom-0 gap-4 rounded-t-3xl bg-card px-5 pt-3">
          <View className="h-1.5 w-12 self-center rounded-full bg-muted" />

          <View className="flex-row items-center gap-3">
            <Avatar name={target.toName} uri={data?.avatarUrl ?? target.toAvatarUrl} size="md" pending={!toUserId} />
            <View className="min-w-0 flex-1">
              <Text className="text-xs text-muted-foreground">
                {target.fromName} chuyển cho
              </Text>
              <Text numberOfLines={1} className="text-lg font-semibold text-foreground">
                {target.toName}
              </Text>
            </View>
            <Text className="text-xl font-bold text-primary">{formatMoney(target.amount)}</Text>
          </View>

          <View className="items-center rounded-2xl border border-border bg-background p-4">
            {guest ? (
              <Text className="py-8 text-center text-sm text-muted-foreground">
                Chế độ khách không có mã QR nhận tiền. Đăng nhập và mời mọi người vào chuyến để
                xem mã QR của nhau.
              </Text>
            ) : !toUserId ? (
              <Text className="py-8 text-center text-sm text-muted-foreground">
                {target.toName} chưa vào app nên chưa có mã QR. Gửi mã mời để họ nhận chỗ và
                thêm mã QR trong Hồ sơ.
              </Text>
            ) : loading && data === null ? (
              <LoadingView label="Đang tải mã QR…" />
            ) : error ? (
              <ErrorView message={error} onRetry={reload} />
            ) : data?.qrUrl ? (
              <Image
                source={{ uri: data.qrUrl }}
                style={{ width: 260, height: 260 }}
                contentFit="contain"
                accessibilityLabel={`Mã QR nhận tiền của ${target.toName}`}
              />
            ) : (
              <Text className="py-8 text-center text-sm text-muted-foreground">
                {target.toName} chưa thêm mã QR nhận tiền.
              </Text>
            )}
            {data?.note ? (
              <Text selectable className="mt-3 text-center text-sm font-medium text-foreground">
                {data.note}
              </Text>
            ) : null}
          </View>

          <Button label="Đóng" variant="secondary" onPress={onClose} />
        </View>
      ) : null}
    </Modal>
  );
}
