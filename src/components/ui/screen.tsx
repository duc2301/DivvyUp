import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
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
          <KeyboardAvoidingView
            className="flex-1"
            // Android bật edge-to-edge từ Expo SDK 54, cửa sổ KHÔNG còn tự co
            // lại khi bàn phím hiện lên — nên phải tự đẩy nội dung. iOS thì
            // 'padding' là cách chuẩn.
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
            <ScrollView
              className="flex-1"
              // Chừa thêm chỗ dưới đáy để ô nhập cuối cùng không dính sát bàn phím.
              contentContainerClassName="gap-4 px-4 pb-24 pt-2"
              keyboardShouldPersistTaps="handled"
              // Vuốt xuống là đóng bàn phím, không cần bấm nút riêng.
              keyboardDismissMode="interactive"
              // iOS tự chừa đúng chiều cao bàn phím và cuộn tới ô đang gõ.
              automaticallyAdjustKeyboardInsets>
              {children}
            </ScrollView>
          </KeyboardAvoidingView>
        ) : (
          <View className="flex-1 px-4 pt-2">{children}</View>
        )}
      </SafeAreaView>
    </View>
  );
}
