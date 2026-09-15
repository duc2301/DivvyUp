import { Pressable, Text, TextInput, View } from 'react-native';

import type { Money, SplitMode } from '@/lib/money';
import { formatMoney } from '@/lib/money';

export interface Participant {
  readonly id: string;
  readonly name: string;
  readonly shares: number;
}

interface ParticipantRowProps {
  readonly participant: Participant;
  readonly mode: SplitMode;
  readonly isPayer: boolean;
  readonly amount: Money | null;
  readonly canRemove: boolean;
  readonly onChangeName: (id: string, name: string) => void;
  readonly onChangeShares: (id: string, shares: number) => void;
  readonly onSelectPayer: (id: string) => void;
  readonly onRemove: (id: string) => void;
}

export function ParticipantRow({
  participant,
  mode,
  isPayer,
  amount,
  canRemove,
  onChangeName,
  onChangeShares,
  onSelectPayer,
  onRemove,
}: ParticipantRowProps) {
  const displayName = participant.name.trim() === '' ? 'Chưa đặt tên' : participant.name.trim();

  return (
    <View className="border-b border-border py-1">
      <View className="flex-row items-center">
        <Pressable
          accessibilityRole="radio"
          accessibilityState={{ selected: isPayer }}
          accessibilityLabel={`Đặt ${displayName} là người ứng tiền`}
          onPress={() => onSelectPayer(participant.id)}
          className="h-11 w-11 items-center justify-center">
          <View
            className={`h-6 w-6 items-center justify-center rounded-full border-2 ${
              isPayer ? 'border-primary bg-primary' : 'border-border'
            }`}>
            {isPayer ? <Text className="text-xs font-bold text-primary-foreground">₫</Text> : null}
          </View>
        </Pressable>

        {/* min-w-0 là bắt buộc, không phải trang trí: trên bản web,
            react-native-web dựng TextInput thành <input>, mà thẻ này có bề rộng
            nội tại tối thiểu. Mặc định min-width:auto của flex item không cho
            co xuống dưới mức đó, nên ô tên giữ nguyên ~197px và đẩy nút xoá
            tràn ra ngoài thẻ. Trên native không có giới hạn này nên lỗi chỉ lộ
            ở web — đúng kiểu bug âm thầm của file dùng chung nhiều nền tảng. */}
        <TextInput
          value={participant.name}
          onChangeText={(text) => onChangeName(participant.id, text)}
          placeholder="Tên"
          accessibilityLabel="Tên người tham gia"
          className="min-h-11 min-w-0 flex-1 rounded-lg px-2 text-base text-foreground"
        />

        <Text
          numberOfLines={1}
          className="shrink-0 pl-2 text-right text-base font-semibold text-foreground">
          {amount ? formatMoney(amount) : '—'}
        </Text>

        {canRemove ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Xoá ${displayName} khỏi danh sách`}
            onPress={() => onRemove(participant.id)}
            className="h-11 w-11 items-center justify-center">
            <Text className="text-lg text-muted-foreground">×</Text>
          </Pressable>
        ) : null}
      </View>

      {/* Bộ tăng giảm số phần nằm ở DÒNG RIÊNG thay vì chen vào dòng trên.
          Nhét chung một dòng thì trên màn ~400px không đủ chỗ cho cả tên, số
          tiền, nút xoá và hai nút ±, mà thu nhỏ nút lại sẽ phá luật vùng chạm
          tối thiểu 44pt. */}
      {mode === 'shares' ? (
        <View className="flex-row items-center justify-end gap-2 pb-1 pr-1">
          <Text className="mr-auto pl-11 text-sm text-muted-foreground">Số phần</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Giảm số phần của ${displayName}`}
            onPress={() => onChangeShares(participant.id, Math.max(0, participant.shares - 1))}
            className="h-11 w-11 items-center justify-center rounded-lg bg-muted">
            <Text className="text-lg text-foreground">−</Text>
          </Pressable>
          <Text className="w-8 text-center text-base font-semibold text-foreground">
            {participant.shares}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Tăng số phần của ${displayName}`}
            onPress={() => onChangeShares(participant.id, participant.shares + 1)}
            className="h-11 w-11 items-center justify-center rounded-lg bg-muted">
            <Text className="text-lg text-foreground">+</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
