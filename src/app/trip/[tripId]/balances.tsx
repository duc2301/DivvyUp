import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import type { TransferPerson } from '@/components/money/transfer-row';
import { TransferRow } from '@/components/money/transfer-row';
import { AppHeader } from '@/components/ui/app-header';
import { Button } from '@/components/ui/button';
import { Avatar } from '@/components/ui/avatar';
import { ChevronDown, ChevronUp } from '@/components/ui/icons';
import type { PaymentTarget } from '@/components/ui/payment-sheet';
import { PaymentSheet } from '@/components/ui/payment-sheet';
import { Screen } from '@/components/ui/screen';
import { SectionCard } from '@/components/ui/section-card';
import { ErrorView, LoadingView } from '@/components/ui/state-views';
import { useSessionContext } from '@/features/auth/session-context';
import { getTrip, getTripBalances, listTripLedger, listTripMembers } from '@/lib/data/manager';
import { useAsync } from '@/lib/data/use-async';
import { formatDateTime } from '@/lib/datetime';
import type { MemberStatement, Money, PairDebt } from '@/lib/money';
import {
  buildStatements,
  formatMoney,
  money,
  pairwiseDebts,
  simplifyDebts,
  statementsToBalances,
} from '@/lib/money';

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function signed(amount: Money): string {
  return amount.minor === 0 ? '0' : formatMoney(amount, { signDisplay: 'always' });
}

function toneOf(amount: Money): string {
  if (amount.minor > 0) return 'text-positive';
  if (amount.minor < 0) return 'text-negative';
  return 'text-muted-foreground';
}

/**
 * Giải thích số dư từ gốc tới ngọn, để ai cũng tự kiểm được:
 *
 *   Bước 1. Mỗi người, mỗi khoản: đã ứng bao nhiêu, phải chịu bao nhiêu.
 *   Bước 2. Nợ trực tiếp từng cặp: mỗi phần chia là "người chịu nợ người ứng";
 *           hai người nợ qua lại thì bù trừ cho nhau.
 *   Bước 3. Tối giản: gộp các khoản nợ thành ít lần chuyển nhất. Không ai trả
 *           thêm hay nhận thiếu một đồng — chỉ đường đi của tiền thay đổi.
 *
 * Mọi con số ở đây tính lại từ danh sách khoản chi gốc, rồi ĐỐI CHIẾU với số dư
 * máy chủ tính. Lệch nhau thì báo ngay trên màn — con số sai mà im lặng còn tệ
 * hơn không có màn này.
 */
export default function BalanceDetailScreen() {
  const params = useLocalSearchParams<{
    tripId?: string | string[];
    from?: string | string[];
    to?: string | string[];
    mode?: string | string[];
  }>();
  const tripId = firstParam(params.tripId);
  const focusFrom = firstParam(params.from);
  const focusTo = firstParam(params.to);
  // Dòng được chạm ở chế độ nào thì giải thích theo chế độ đó: cùng một cặp
  // người có thể vừa là giao dịch tối giản vừa là nợ trực tiếp, với hai số tiền khác nhau.
  const focusMode = firstParam(params.mode) === 'direct' ? 'direct' : 'simplified';

  const { isGuest } = useSessionContext();
  const [payment, setPayment] = useState<PaymentTarget | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => new Set([focusFrom, focusTo].filter((id): id is string => Boolean(id))),
  );

  const { data, error, loading, reload } = useAsync(async () => {
    if (!tripId) throw new Error('Thiếu mã chuyến đi.');
    const [trip, members, ledger, balances] = await Promise.all([
      getTrip(tripId),
      listTripMembers(tripId),
      listTripLedger(tripId),
      getTripBalances(tripId),
    ]);
    // Tính NGAY trong hàm async: một khoản chi hỏng (MoneyError) rơi vào trạng
    // thái lỗi có nút thử lại, thay vì ném trong lúc render và làm sập cả màn.
    const currency = trip.currency;
    const statements = buildStatements(
      ledger.expenses,
      ledger.settlements,
      currency,
      members.map((member) => member.id),
    );
    const derived = statementsToBalances(statements);
    const pairs = pairwiseDebts(ledger.expenses, ledger.settlements, currency);
    const transfers = simplifyDebts(derived);
    return { trip, members, ledger, balances, statements, derived, pairs, transfers };
  }, [tripId]);

  const toggle = (key: string): void => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  let body = null;
  if (data) {
    const { statements, derived, pairs, transfers } = data;

    const serverNet = new Map(
      data.balances.map((balance) => [balance.participantId, balance.net.minor]),
    );
    const mismatched = derived.filter(
      (balance) => (serverNet.get(balance.participantId) ?? 0) !== balance.net.minor,
    );
    const sumNet = money(
      derived.reduce((sum, balance) => sum + balance.net.minor, 0),
      data.trip.currency,
    );
    const excludedCount = data.ledger.expenses.filter((expense) => expense.excluded).length;
    const activeCount = data.ledger.expenses.length - excludedCount;

    const memberOf = (id: string) => data.members.find((member) => member.id === id);
    const person = (id: string): TransferPerson => {
      const member = memberOf(id);
      return {
        name: member?.displayName ?? 'Không rõ',
        avatarUrl: member?.avatarUrl ?? null,
        pending: !member?.claimed,
      };
    };
    const nameOf = (id: string): string => memberOf(id)?.displayName ?? 'Không rõ';
    const statementOf = (id: string): MemberStatement | undefined =>
      statements.find((statement) => statement.participantId === id);

    const focusTransfer =
      focusFrom && focusTo && focusMode === 'simplified'
        ? transfers.find((transfer) => transfer.from === focusFrom && transfer.to === focusTo)
        : undefined;
    const focusPair =
      focusFrom && focusTo
        ? pairs.find((pair) => pair.from === focusFrom && pair.to === focusTo)
        : undefined;
    const focusAmount = focusMode === 'simplified' ? focusTransfer?.amount : focusPair?.amount;

    // Toàn bộ nợ trực tiếp ra/vào của người gửi: cộng lại đúng bằng số dư của
    // họ — đây là lời giải thích cho câu "sao tôi chuyển ít/nhiều hơn khoản tôi nợ".
    const senderOut = focusFrom ? pairs.filter((pair) => pair.from === focusFrom) : [];
    const senderIn = focusFrom ? pairs.filter((pair) => pair.to === focusFrom) : [];
    const senderTransfers = focusFrom
      ? transfers.filter((transfer) => transfer.from === focusFrom)
      : [];

    const renderPairItems = (pair: PairDebt) => (
      <View className="mb-2 gap-1 rounded-2xl bg-muted/60 p-3">
        {pair.owedItems.map((item) => (
          <View key={`o-${item.sourceId}`} className="flex-row justify-between gap-3">
            <Text className="min-w-0 flex-1 text-xs text-foreground">
              {nameOf(pair.from)} chịu phần “{item.description}” do {nameOf(pair.to)} ứng
            </Text>
            <Text className="text-xs font-semibold text-negative">+{formatMoney(item.amount)}</Text>
          </View>
        ))}
        {pair.offsetItems.map((item) => (
          <View key={`b-${item.sourceId}`} className="flex-row justify-between gap-3">
            <Text className="min-w-0 flex-1 text-xs text-foreground">
              {item.kind === 'settlement'
                ? `${nameOf(pair.from)} đã chuyển trả trước đó`
                : `Bù trừ: ${nameOf(pair.to)} chịu phần “${item.description}” do ${nameOf(pair.from)} ứng`}
            </Text>
            <Text className="text-xs font-semibold text-positive">−{formatMoney(item.amount)}</Text>
          </View>
        ))}
        {pair.cycleOffset.minor > 0 ? (
          <View className="flex-row justify-between gap-3">
            <Text className="min-w-0 flex-1 text-xs text-foreground">
              Bù trừ vòng qua người khác (nợ đi một vòng rồi quay về, không ai phải chuyển)
            </Text>
            <Text className="text-xs font-semibold text-positive">
              −{formatMoney(pair.cycleOffset)}
            </Text>
          </View>
        ) : null}
        <View className="mt-1 flex-row justify-between border-t border-border pt-1.5">
          <Text className="text-xs font-semibold text-foreground">
            {formatMoney(pair.owedTotal)} − {formatMoney(pair.offsetTotal)}
            {pair.cycleOffset.minor > 0 ? ` − ${formatMoney(pair.cycleOffset)}` : ''}
          </Text>
          <Text className="text-xs font-bold text-foreground">= {formatMoney(pair.amount)}</Text>
        </View>
      </View>
    );

    body = (
      <>
        <SectionCard title="Kiểm chứng">
          <View className="gap-1.5">
            <Text className="text-sm text-foreground">
              {activeCount} khoản chi được tính
              {excludedCount > 0 ? ` · ${excludedCount} khoản đã xong không tính` : ''}
            </Text>
            <Text className={`text-sm ${sumNet.minor === 0 ? 'text-positive' : 'text-negative'}`}>
              {sumNet.minor === 0
                ? '✓ Tổng số dư cả nhóm = 0'
                : `✗ Tổng số dư cả nhóm = ${formatMoney(sumNet)}`}
            </Text>
            <Text
              className={`text-sm ${mismatched.length === 0 ? 'text-positive' : 'text-negative'}`}>
              {mismatched.length === 0
                ? '✓ Khớp từng đồng với số dư máy chủ tính'
                : `✗ Lệch với máy chủ ở ${mismatched.length} người — có thể ai đó vừa sửa khoản chi.`}
            </Text>
            {mismatched.length > 0 ? (
              <Button label="Tải lại" variant="secondary" onPress={reload} busy={loading} />
            ) : null}
            <Text className="text-sm text-foreground">
              Tối giản: {transfers.length} lần chuyển · Trả trực tiếp: {pairs.length} lần chuyển
            </Text>
          </View>
        </SectionCard>

        {focusFrom && focusTo ? (
          <SectionCard
            title={`Vì sao ${nameOf(focusFrom)} chuyển cho ${nameOf(focusTo)}?`}
            hint={
              focusMode === 'direct'
                ? 'Đây là nợ trực tiếp: từng khoản chi làm phát sinh nợ, đã bù trừ hai chiều.'
                : 'Tối giản chỉ đổi đường đi của tiền: mỗi người vẫn trả ra đúng số mình nợ và nhận về đúng số mình được nhận.'
            }>
            {[focusFrom, focusTo].map((id) => {
              const statement = statementOf(id);
              if (!statement) return null;
              return (
                <View key={id} className="mb-2 flex-row items-center gap-3">
                  <Avatar name={nameOf(id)} uri={memberOf(id)?.avatarUrl} size="sm" />
                  <Text className="min-w-0 flex-1 text-sm text-foreground">
                    {nameOf(id)}: ứng {formatMoney(statement.paidTotal)}, chịu{' '}
                    {formatMoney(statement.owedTotal)}
                  </Text>
                  <Text className={`text-sm font-bold ${toneOf(statement.net)}`}>
                    {signed(statement.net)}
                  </Text>
                </View>
              );
            })}
            {focusMode === 'direct' && focusPair ? (
              <>
                <Text className="mb-1 mt-2 text-xs font-semibold text-muted-foreground">
                  Nợ trực tiếp giữa hai người
                </Text>
                {renderPairItems(focusPair)}
              </>
            ) : null}

            {focusMode === 'simplified' && focusFrom ? (
              <>
                <Text className="mb-1 mt-2 text-xs font-semibold text-muted-foreground">
                  Mọi khoản nợ trực tiếp của {nameOf(focusFrom)} (đã bù trừ)
                </Text>
                <View className="mb-2 gap-1 rounded-2xl bg-muted/60 p-3">
                  {senderOut.map((pair) => (
                    <View key={`out-${pair.to}`} className="flex-row justify-between gap-3">
                      <Text className="min-w-0 flex-1 text-xs text-foreground">
                        {nameOf(focusFrom)} nợ {nameOf(pair.to)}
                      </Text>
                      <Text className="text-xs font-semibold text-negative">
                        −{formatMoney(pair.amount)}
                      </Text>
                    </View>
                  ))}
                  {senderIn.map((pair) => (
                    <View key={`in-${pair.from}`} className="flex-row justify-between gap-3">
                      <Text className="min-w-0 flex-1 text-xs text-foreground">
                        {nameOf(pair.from)} nợ {nameOf(focusFrom)}
                      </Text>
                      <Text className="text-xs font-semibold text-positive">
                        +{formatMoney(pair.amount)}
                      </Text>
                    </View>
                  ))}
                  <View className="mt-1 flex-row justify-between border-t border-border pt-1.5">
                    <Text className="text-xs font-semibold text-foreground">Cộng lại = số dư</Text>
                    <Text className="text-xs font-bold text-foreground">
                      {statementOf(focusFrom) ? signed(statementOf(focusFrom)!.net) : '0'}
                    </Text>
                  </View>
                </View>
                <Text className="text-xs leading-5 text-muted-foreground">
                  Thay vì {senderOut.length + senderIn.length} lần chuyển qua lại,{' '}
                  {nameOf(focusFrom)} chỉ cần chuyển{' '}
                  {senderTransfers
                    .map((transfer) => `${formatMoney(transfer.amount)} cho ${nameOf(transfer.to)}`)
                    .join(' và ')}
                  . Những người nợ {nameOf(focusFrom)} sẽ trả thẳng cho người {nameOf(focusFrom)}{' '}
                  đang nợ — tổng tiền ai cũng trả/nhận đúng như bước 1.
                </Text>
              </>
            ) : null}
            {focusAmount ? (
              <View className="mt-3">
                <Button
                  label={`Mở mã QR nhận tiền của ${nameOf(focusTo)}`}
                  variant="secondary"
                  onPress={() =>
                    setPayment({
                      fromName: nameOf(focusFrom),
                      toName: nameOf(focusTo),
                      toUserId: memberOf(focusTo)?.userId ?? null,
                      toAvatarUrl: memberOf(focusTo)?.avatarUrl ?? null,
                      amount: focusAmount,
                    })
                  }
                />
              </View>
            ) : null}
          </SectionCard>
        ) : null}

        <SectionCard
          title="Bước 1 — Số dư từng người"
          hint="Số dư = đã ứng − phần phải chịu (+ đã chuyển trả − đã nhận). Dương là được nhận lại, âm là đang nợ. Chạm một người để xem từng khoản.">
          {statements.map((statement) => {
            const open = expanded.has(statement.participantId);
            return (
              <View key={statement.participantId} className="border-b border-border py-1">
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ expanded: open }}
                  accessibilityLabel={`${nameOf(statement.participantId)}, số dư ${signed(statement.net)}`}
                  onPress={() => toggle(statement.participantId)}
                  className="min-h-12 flex-row items-center gap-3 rounded-xl active:bg-muted">
                  <Avatar
                    name={nameOf(statement.participantId)}
                    uri={memberOf(statement.participantId)?.avatarUrl}
                    size="sm"
                    pending={!memberOf(statement.participantId)?.claimed}
                  />
                  <View className="min-w-0 flex-1">
                    <Text className="text-base text-foreground">
                      {nameOf(statement.participantId)}
                    </Text>
                    <Text className="text-xs text-muted-foreground">
                      ứng {formatMoney(statement.paidTotal)} · chịu{' '}
                      {formatMoney(statement.owedTotal)}
                    </Text>
                  </View>
                  <Text className={`text-base font-semibold ${toneOf(statement.net)}`}>
                    {signed(statement.net)}
                  </Text>
                  {open ? (
                    <ChevronUp size={18} className="text-muted-foreground" />
                  ) : (
                    <ChevronDown size={18} className="text-muted-foreground" />
                  )}
                </Pressable>

                {open ? (
                  <View className="mb-2 mt-1 gap-2 rounded-2xl bg-muted/60 p-3">
                    {statement.lines.length === 0 ? (
                      <Text className="text-xs text-muted-foreground">
                        Chưa dính khoản chi nào.
                      </Text>
                    ) : null}
                    {statement.lines.map((line) => (
                      <View key={line.expenseId} className="flex-row items-start gap-3">
                        <View className="min-w-0 flex-1">
                          <Text className="text-sm text-foreground">{line.description}</Text>
                          <Text className="text-[11px] text-muted-foreground">
                            {formatDateTime(new Date(line.paidAt))}
                            {line.paid.minor > 0 ? ` · ứng ${formatMoney(line.paid)}` : ''}
                            {line.owed.minor > 0 ? ` · chịu ${formatMoney(line.owed)}` : ''}
                          </Text>
                        </View>
                        <Text className={`text-sm font-semibold ${toneOf(line.delta)}`}>
                          {signed(line.delta)}
                        </Text>
                      </View>
                    ))}
                    {statement.settledOut.minor > 0 ? (
                      <View className="flex-row justify-between">
                        <Text className="text-sm text-foreground">Đã chuyển trả</Text>
                        <Text className="text-sm font-semibold text-positive">
                          +{formatMoney(statement.settledOut)}
                        </Text>
                      </View>
                    ) : null}
                    {statement.settledIn.minor > 0 ? (
                      <View className="flex-row justify-between">
                        <Text className="text-sm text-foreground">Đã nhận lại</Text>
                        <Text className="text-sm font-semibold text-negative">
                          −{formatMoney(statement.settledIn)}
                        </Text>
                      </View>
                    ) : null}
                    <View className="flex-row justify-between border-t border-border pt-2">
                      <Text className="text-sm font-semibold text-foreground">Cộng lại</Text>
                      <Text className={`text-sm font-bold ${toneOf(statement.net)}`}>
                        {signed(statement.net)}
                      </Text>
                    </View>
                  </View>
                ) : null}
              </View>
            );
          })}
        </SectionCard>

        <SectionCard
          title="Bước 2 — Nợ trực tiếp, đã bù trừ"
          hint="Mỗi phần chia là “người chịu nợ người ứng”. Hai người nợ qua lại thì bù trừ, còn lại một chiều. Trả theo bảng này thì ai cũng trả đúng người mình nợ.">
          {pairs.length === 0 ? (
            <Text className="text-sm text-muted-foreground">Không ai nợ ai.</Text>
          ) : null}
          {pairs.map((pair) => {
            const key = `pair:${pair.from}:${pair.to}`;
            const open = expanded.has(key);
            const count = pair.owedItems.length + pair.offsetItems.length;
            return (
              <View key={key}>
                <TransferRow
                  from={person(pair.from)}
                  to={person(pair.to)}
                  amount={pair.amount}
                  caption={`${count} khoản · chạm để ${open ? 'thu gọn' : 'xem'}`}
                  onPress={() => toggle(key)}
                />
                {open ? renderPairItems(pair) : null}
              </View>
            );
          })}
        </SectionCard>

        <SectionCard
          title="Bước 3 — Tối giản số lần chuyển"
          hint={`Gộp ${pairs.length} khoản nợ trực tiếp thành ${transfers.length} lần chuyển. Mỗi người vẫn trả ra / nhận về đúng số dư ở bước 1 — kiểm bằng cách cộng các dòng dưới đây của từng người.`}>
          {transfers.length === 0 ? (
            <Text className="text-sm text-muted-foreground">
              Mọi người đã cân, không cần chuyển.
            </Text>
          ) : null}
          {transfers.map((transfer) => (
            <TransferRow
              key={`${transfer.from}-${transfer.to}`}
              from={person(transfer.from)}
              to={person(transfer.to)}
              amount={transfer.amount}
            />
          ))}
        </SectionCard>
      </>
    );
  }

  return (
    <Screen header={<AppHeader title="Cách tính số dư" subtitle={data?.trip.name} showBack />}>
      {loading && data === null ? <LoadingView /> : null}
      {error ? <ErrorView message={error} onRetry={reload} /> : null}
      {body}
      <PaymentSheet target={payment} guest={isGuest} onClose={() => setPayment(null)} />
    </Screen>
  );
}
