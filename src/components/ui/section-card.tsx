import type { ReactNode } from 'react';
import { Text, View } from 'react-native';

interface SectionCardProps {
  readonly title?: string;
  readonly hint?: string;
  readonly children: ReactNode;
}

export function SectionCard({ title, hint, children }: SectionCardProps) {
  return (
    // Bo tròn lớn + bóng mềm thay cho viền cứng: thẻ nổi lên khỏi nền kem thay
    // vì bị kẻ khung. Viền vẫn giữ một nét mảnh vì ở bản tối, bóng gần như
    // không nhìn thấy nên cần thứ khác phân tách thẻ với nền.
    <View className="rounded-3xl border border-border bg-card p-5 shadow-sm">
      {title ? (
        <Text className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          {title}
        </Text>
      ) : null}
      {hint ? <Text className="mt-1.5 text-xs leading-5 text-muted-foreground">{hint}</Text> : null}
      <View className={title || hint ? 'mt-4' : ''}>{children}</View>
    </View>
  );
}
