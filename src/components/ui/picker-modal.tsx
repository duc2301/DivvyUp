import { FlatList, Modal, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export interface PickerItem {
  readonly value: string;
  readonly label: string;
  readonly detail?: string;
  readonly disabled?: boolean;
}

interface PickerModalProps {
  readonly visible: boolean;
  readonly title: string;
  readonly items: readonly PickerItem[];
  readonly emptyText?: string;
  readonly onSelect: (value: string) => void;
  readonly onClose: () => void;
}

/**
 * Danh sách chọn dạng tấm trượt từ dưới lên.
 *
 * Tự dựng bằng Modal thay vì dùng Picker của nền tảng: Picker trên Android và
 * iOS trông và hành xử khác hẳn nhau, còn ở đây cần một danh sách có nhãn phụ
 * (đã chọn rồi / chưa có tài khoản) mà Picker không biểu đạt được.
 */
export function PickerModal({
  visible,
  title,
  items,
  emptyText = 'Không còn lựa chọn nào.',
  onSelect,
  onClose,
}: PickerModalProps) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Đóng danh sách"
        onPress={onClose}
        className="flex-1 bg-black/50"
      />
      <View className="max-h-[70%] rounded-t-3xl border-t border-border bg-card">
        <SafeAreaView edges={['bottom']}>
          <View className="flex-row items-center justify-between border-b border-border px-4 py-3">
            <Text className="text-base font-semibold text-foreground">{title}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Đóng"
              onPress={onClose}
              className="h-11 w-11 items-center justify-center">
              <Text className="text-lg text-muted-foreground">×</Text>
            </Pressable>
          </View>

          <FlatList
            data={items}
            keyExtractor={(item) => item.value}
            ListEmptyComponent={
              <Text className="px-4 py-6 text-center text-sm text-muted-foreground">
                {emptyText}
              </Text>
            }
            renderItem={({ item }) => (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={item.label}
                accessibilityState={{ disabled: item.disabled }}
                disabled={item.disabled}
                onPress={() => onSelect(item.value)}
                className={`min-h-14 flex-row items-center justify-between border-b border-border px-4 ${
                  item.disabled ? 'opacity-40' : ''
                }`}>
                <Text className="min-w-0 flex-1 text-base text-foreground">{item.label}</Text>
                {item.detail ? (
                  <Text className="pl-3 text-xs text-muted-foreground">{item.detail}</Text>
                ) : null}
              </Pressable>
            )}
          />
        </SafeAreaView>
      </View>
    </Modal>
  );
}
