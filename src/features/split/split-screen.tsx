import { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { CurrencyCode, ExpenseRecord, SplitMode } from '@/lib/money';
import {
  CURRENCY_CODES,
  DEFAULT_CURRENCY,
  computeBalances,
  currencyInfo,
  formatMoney,
  linesBalanceTotal,
  parseAmount,
  simplifyDebts,
  splitExpense,
} from '@/lib/money';

import type { Participant } from './participant-row';
import { ParticipantRow } from './participant-row';
import { SectionCard } from './section-card';
import { SegmentedControl } from './segmented-control';

const MODE_OPTIONS = [
  { value: 'equal' as const, label: 'Chia đều' },
  { value: 'shares' as const, label: 'Theo phần' },
];

const INITIAL_PARTICIPANTS: Participant[] = [
  { id: 'p1', name: 'Bạn', shares: 1 },
  { id: 'p2', name: 'An', shares: 1 },
  { id: 'p3', name: 'Bình', shares: 1 },
];

export function SplitScreen() {
  const [rawAmount, setRawAmount] = useState('450000');
  const [currency, setCurrency] = useState<CurrencyCode>(DEFAULT_CURRENCY);
  const [mode, setMode] = useState<SplitMode>('equal');
  const [participants, setParticipants] = useState<Participant[]>(INITIAL_PARTICIPANTS);
  const [payerId, setPayerId] = useState('p1');
  const [nextId, setNextId] = useState(4);

  // React Compiler đang bật — không cần useMemo cho các phép tính dẫn xuất dưới đây.
  const total = parseAmount(rawAmount, currency);

  const splitResult = total
    ? splitExpense({
        total,
        participantIds: participants.map((participant) => participant.id),
        mode,
        shares: Object.fromEntries(participants.map((p) => [p.id, p.shares])),
        // Người ứng tiền nhận phần lẻ — quy ước dễ giải thích nhất với người dùng.
        remainderPriority: [payerId],
      })
    : null;

  const lines = splitResult?.ok ? splitResult.lines : [];
  const amountById = new Map(lines.map((line) => [line.participantId, line.amount]));
  const totalsMatch = total !== null && splitResult?.ok === true && linesBalanceTotal(total, lines);

  const nameOf = (id: string): string => {
    const found = participants.find((participant) => participant.id === id);
    const name = found?.name.trim();
    return name && name !== '' ? name : 'Chưa đặt tên';
  };

  let transfers: { from: string; to: string; amountLabel: string }[] = [];
  if (total && splitResult?.ok) {
    const expense: ExpenseRecord = {
      id: 'draft',
      payments: [{ participantId: payerId, amount: total }],
      shares: lines,
    };
    const balances = computeBalances(
      [expense],
      currency,
      participants.map((participant) => participant.id),
    );
    transfers = simplifyDebts(balances).map((transfer) => ({
      from: nameOf(transfer.from),
      to: nameOf(transfer.to),
      amountLabel: formatMoney(transfer.amount),
    }));
  }

  const updateParticipant = (id: string, patch: Partial<Participant>): void => {
    setParticipants((current) =>
      current.map((participant) =>
        participant.id === id ? { ...participant, ...patch } : participant,
      ),
    );
  };

  const addParticipant = (): void => {
    const id = `p${nextId}`;
    // Đặt tên mặc định thay vì để rỗng: người dùng thêm nhanh vài người rồi
    // xem kết quả ngay, không phải gõ tên trước mới hiểu dòng "ai trả ai".
    setParticipants((current) => [...current, { id, name: `Người ${nextId}`, shares: 1 }]);
    setNextId((value) => value + 1);
  };

  const removeParticipant = (id: string): void => {
    setParticipants((current) => {
      const next = current.filter((participant) => participant.id !== id);
      // Người ứng tiền bị xoá thì phải chuyển vai trò, nếu không số dư sẽ treo
      // vào một id không còn tồn tại.
      if (id === payerId && next.length > 0) setPayerId(next[0].id);
      return next;
    });
  };

  const errorMessage = total === null ? 'Chưa đọc được số tiền.' : splitResult?.ok === false ? splitResult.error : null;

  return (
    <View className="flex-1 bg-background">
      <SafeAreaView edges={['top', 'left', 'right']} className="flex-1">
        <ScrollView
          className="flex-1"
          contentContainerClassName="gap-4 px-4 pb-32 pt-2"
          keyboardShouldPersistTaps="handled">
          <View>
            <Text className="text-3xl font-bold text-foreground">DivvyUp</Text>
            <Text className="mt-1 text-sm text-muted-foreground">
              Chia hoá đơn không lệch một đồng
            </Text>
          </View>

          <SectionCard title="Khoản chi">
            {/* Ô nhập và thanh chọn tiền tệ nằm trên HAI dòng riêng.
                Xếp cùng một dòng flex-row sẽ hỏng trên màn hẹp: flexShrink của
                React Native mặc định là 0, nên thanh 4 lựa chọn giữ nguyên bề
                rộng và bóp ô nhập xuống còn vài pixel. */}
            <TextInput
              value={rawAmount}
              onChangeText={setRawAmount}
              keyboardType="number-pad"
              inputMode="numeric"
              accessibilityLabel="Tổng số tiền"
              className="min-h-14 rounded-xl bg-muted px-3 text-3xl font-semibold text-foreground"
            />
            <View className="mt-3">
              <SegmentedControl
                options={CURRENCY_CODES.map((code) => ({ value: code, label: code }))}
                value={currency}
                onChange={setCurrency}
                accessibilityLabel="Đơn vị tiền tệ"
              />
            </View>
            <Text className="mt-2 text-sm text-muted-foreground">
              {total
                ? `Đọc thành ${formatMoney(total)} · lưu nội bộ ${total.minor} ${
                    currencyInfo(currency).decimals === 0 ? 'đồng' : 'đơn vị nhỏ nhất'
                  }`
                : 'Nhập số tiền, ví dụ 450.000'}
            </Text>
          </SectionCard>

          <SectionCard title="Cách chia">
            <SegmentedControl
              options={MODE_OPTIONS}
              value={mode === 'shares' ? 'shares' : 'equal'}
              onChange={setMode}
              accessibilityLabel="Cách chia khoản chi"
            />
          </SectionCard>

          <SectionCard
            title="Người tham gia"
            hint="Chấm tròn ₫ đánh dấu người đã ứng tiền. Người đó cũng là người nhận phần lẻ.">
            {participants.map((participant) => (
              <ParticipantRow
                key={participant.id}
                participant={participant}
                mode={mode}
                isPayer={participant.id === payerId}
                amount={amountById.get(participant.id) ?? null}
                canRemove={participants.length > 1}
                onChangeName={(id, name) => updateParticipant(id, { name })}
                onChangeShares={(id, shares) => updateParticipant(id, { shares })}
                onSelectPayer={setPayerId}
                onRemove={removeParticipant}
              />
            ))}

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Thêm người tham gia"
              onPress={addParticipant}
              className="mt-3 min-h-11 items-center justify-center rounded-xl bg-muted">
              <Text className="text-base font-semibold text-foreground">+ Thêm người</Text>
            </Pressable>
          </SectionCard>

          {errorMessage ? (
            <View className="rounded-2xl border border-negative bg-card p-4">
              <Text className="text-sm font-semibold text-negative">{errorMessage}</Text>
            </View>
          ) : (
            <SectionCard title="Kiểm chứng">
              <View className="flex-row items-center justify-between">
                <Text className="text-sm text-muted-foreground">Tổng các phần chia</Text>
                <Text
                  className={`text-base font-semibold ${
                    totalsMatch ? 'text-positive' : 'text-negative'
                  }`}>
                  {totalsMatch ? `✓ khớp ${formatMoney(total!)}` : '✗ LỆCH TỔNG'}
                </Text>
              </View>
              <Text className="mt-2 text-xs text-muted-foreground">
                Phép so sánh này chạy trên số nguyên, không phải số thực — nên dấu ✓ nghĩa là khớp
                tuyệt đối tới từng đồng.
              </Text>
            </SectionCard>
          )}

          {transfers.length > 0 ? (
            <SectionCard title="Ai trả ai" hint="Đã tối giản số lần chuyển tiền.">
              {transfers.map((transfer, index) => (
                <View
                  key={`${transfer.from}-${transfer.to}-${index}`}
                  className="flex-row items-center justify-between py-2">
                  <Text className="flex-1 text-base text-foreground">
                    {transfer.from} → {transfer.to}
                  </Text>
                  <Text className="text-base font-semibold text-negative">
                    {transfer.amountLabel}
                  </Text>
                </View>
              ))}
            </SectionCard>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
