import type { ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import type { Edge } from 'react-native-safe-area-context';
import { SafeAreaView } from 'react-native-safe-area-context';

interface ScreenProps {
  readonly children: ReactNode;
  /** Nội dung cố định phía trên, không cuộn theo — thường là AppHeader. */
  readonly header?: ReactNode;
  readonly scroll?: boolean;
  readonly edges?: readonly Edge[];
}

export function Screen({
  children,
  header,
  scroll = true,
  // Header mặc định của Stack đã tắt, nên màn hình tự lo phần tai thỏ.
  edges = ['top', 'left', 'right'],
}: ScreenProps) {
  return (
    <View className="flex-1 bg-background">
      <SafeAreaView edges={edges} className="flex-1">
        {header}
        {scroll ? (
          <ScrollView
            className="flex-1"
            contentContainerClassName="gap-4 px-4 pb-16 pt-2"
            keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
        ) : (
          <View className="flex-1 px-4 pt-2">{children}</View>
        )}
      </SafeAreaView>
    </View>
  );
}
