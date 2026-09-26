import { Pressable, Text, View } from 'react-native';

import { Avatar } from '@/components/ui/avatar';
import { ArrowRight } from '@/components/ui/icons';
import type { Money } from '@/lib/money';
import { formatMoney } from '@/lib/money';

export interface TransferPerson {
  readonly name: string;
  readonly avatarUrl: string | null;
  /** Chỗ chưa ai nhận trong app — avatar viền đứt. */
  readonly pending: boolean;
}

interface TransferRowProps {
  readonly from: TransferPerson;
  readonly to: TransferPerson;
  readonly amount: Money;
  readonly onPress?: () => void;
  /** Dòng phụ dưới số tiền, ví dụ "bù trừ 2 khoản". */
  readonly caption?: string;
}

function Person({ person }: { readonly person: TransferPerson }) {
  return (
    <View className="w-20 items-center gap-1">
      <Avatar name={person.name} uri={person.avatarUrl} size="md" pending={person.pending} />
      <Text numberOfLines={2} className="text-center text-xs font-medium leading-4 text-foreground">
        {person.name}
      </Text>
    </View>
  );
}

/**
 * Một giao dịch "A chuyển cho B": avatar nằm TRÊN tên của cả người gửi lẫn
 * người nhận, số tiền và mũi tên ở giữa. Đọc từ trái qua phải đúng chiều tiền đi.
 */
export function TransferRow({ from, to, amount, onPress, caption }: TransferRowProps) {
  const label = `${from.name} chuyển ${formatMoney(amount)} cho ${to.name}`;
  const body = (
    <View className="flex-row items-start gap-1 py-2.5">
      <Person person={from} />
      <View className="min-w-0 flex-1 items-center pt-1.5">
        <Text numberOfLines={1} className="text-base font-bold text-foreground">
          {formatMoney(amount)}
        </Text>
        <View className="mt-0.5 h-5 w-full flex-row items-center">
          <View className="h-px flex-1 bg-border" />
          <ArrowRight size={18} className="text-primary" />
        </View>
        {caption ? (
          <Text numberOfLines={1} className="mt-0.5 text-[11px] text-muted-foreground">
            {caption}
          </Text>
        ) : null}
      </View>
      <Person person={to} />
    </View>
  );

  if (!onPress) {
    return (
      <View accessible accessibilityLabel={label}>
        {body}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}. Chạm để xem chi tiết`}
      onPress={onPress}
      className="-mx-2 rounded-2xl px-2 active:bg-muted">
      {body}
    </Pressable>
  );
}
