import { ActivityIndicator, Text, View } from 'react-native';

import { Button } from './button';

/**
 * Bốn trạng thái mà mọi màn hình gọi dữ liệu phải xử lý đủ: đang tải, lỗi,
 * rỗng, có dữ liệu. Thiếu trạng thái lỗi là thiếu sót hay gặp nhất, nên gom
 * sẵn ở đây để không màn nào quên.
 */

export function LoadingView({ label = 'Đang tải…' }: { readonly label?: string }) {
  return (
    <View className="items-center gap-3 py-10">
      <ActivityIndicator />
      <Text className="text-sm text-muted-foreground">{label}</Text>
    </View>
  );
}

interface ErrorViewProps {
  readonly message: string;
  readonly onRetry?: () => void;
}

export function ErrorView({ message, onRetry }: ErrorViewProps) {
  return (
    <View className="gap-3 rounded-2xl border border-negative bg-card p-4">
      <Text className="text-sm font-semibold text-negative">{message}</Text>
      {onRetry ? <Button label="Thử lại" variant="secondary" onPress={onRetry} /> : null}
    </View>
  );
}

interface EmptyViewProps {
  readonly title: string;
  readonly hint?: string;
  readonly actionLabel?: string;
  readonly onAction?: () => void;
}

export function EmptyView({ title, hint, actionLabel, onAction }: EmptyViewProps) {
  return (
    <View className="items-center gap-3 rounded-2xl border border-dashed border-border px-4 py-10">
      <Text className="text-center text-base font-semibold text-foreground">{title}</Text>
      {hint ? <Text className="text-center text-sm text-muted-foreground">{hint}</Text> : null}
      {actionLabel && onAction ? (
        <View className="w-full pt-1">
          <Button label={actionLabel} onPress={onAction} />
        </View>
      ) : null}
    </View>
  );
}
