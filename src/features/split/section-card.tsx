import type { ReactNode } from 'react';
import { Text, View } from 'react-native';

interface SectionCardProps {
  readonly title: string;
  readonly hint?: string;
  readonly children: ReactNode;
}

export function SectionCard({ title, hint, children }: SectionCardProps) {
  return (
    <View className="rounded-2xl border border-border bg-card p-4">
      <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </Text>
      {hint ? <Text className="mt-1 text-xs text-muted-foreground">{hint}</Text> : null}
      <View className="mt-3">{children}</View>
    </View>
  );
}
