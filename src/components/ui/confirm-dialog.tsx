import { Modal, Pressable, Text, View } from 'react-native';

import { Button } from './button';

interface ConfirmDialogProps {
  readonly visible: boolean;
  readonly title: string;
  readonly message: string;
  readonly confirmLabel: string;
  readonly cancelLabel?: string;
  readonly destructive?: boolean;
  readonly busy?: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

/**
 * Hộp thoại xác nhận cho thao tác không hoàn tác được.
 *
 * Tự dựng bằng Modal thay vì dùng Alert.alert: trên web, react-native-web cài
 * Alert.alert thành hàm KHÔNG LÀM GÌ — nút xoá sẽ im lặng không phản hồi, hoặc
 * tệ hơn là bỏ qua bước xác nhận. Modal chạy giống nhau ở mọi nền tảng.
 */
export function ConfirmDialog({
  visible,
  title,
  message,
  confirmLabel,
  cancelLabel = 'Huỷ',
  destructive = false,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View className="flex-1 items-center justify-center px-6">
        {/* Chạm ra ngoài để huỷ — trừ lúc đang xử lý, kẻo đóng hộp thoại giữa
            chừng khi lệnh xoá đã gửi đi. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Đóng hộp thoại"
          disabled={busy}
          onPress={onCancel}
          className="absolute inset-0 bg-black/50"
        />
        <View className="w-full max-w-sm gap-4 rounded-3xl bg-card p-6">
          <Text className="font-display text-xl text-foreground">{title}</Text>
          <Text className="text-sm leading-5 text-muted-foreground">{message}</Text>
          <View className="flex-row gap-3 pt-2">
            <View className="min-w-0 flex-1">
              <Button label={cancelLabel} variant="secondary" onPress={onCancel} disabled={busy} />
            </View>
            <View className="min-w-0 flex-1">
              <Button
                label={confirmLabel}
                variant={destructive ? 'danger' : 'primary'}
                onPress={onConfirm}
                busy={busy}
              />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}
