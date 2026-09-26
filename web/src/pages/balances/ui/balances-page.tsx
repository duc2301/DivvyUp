import { ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';
import { useParams, useSearchParams } from 'react-router';

import { getTripBalances, listTripLedger, SignedAmount, signed, toneOf, TransferRow } from '@/entities/balance';
import { listTripMembers, memberLookup } from '@/entities/member';
import { getTrip } from '@/entities/trip';
import type { PaymentTarget } from '@/features/payment-qr';
import { PaymentSheet } from '@/features/payment-qr';
import { useAsync } from '@/shared/lib/async';
import { routes } from '@/shared/config';
import { formatDateTime } from '@/shared/lib/datetime';
import type { PairDebt } from '@/shared/lib/money';
import {
  buildStatements,
  formatMoney,
  pairwiseDebts,
  simplifyDebts,
  statementsToBalances,
  sumMoney,
} from '@/shared/lib/money';
import { AppHeader, Avatar, Button, ErrorView, LoadingView, Screen, SectionCard } from '@/shared/ui';

/**
 * "Cách tính số dư" — bản web của balances.tsx: Kiểm chứng, Vì sao A chuyển B,
 * Bước 1 bảng kê, Bước 2 nợ trực tiếp đã bù trừ, Bước 3 tối giản. Mọi con số
 * tính lại từ khoản chi gốc bằng lõi chung rồi ĐỐI CHIẾU với số dư máy chủ.
 */
export function BalancesPage() {
  const { tripId = '' } = useParams();
  const [search] = useSearchParams();
  const focusFrom = search.get('from') ?? undefined;
  const focusTo = search.get('to') ?? undefined;
  const focusMode = search.get('mode') === 'direct' ? 'direct' : 'simplified';

  const [payment, setPayment] = useState<PaymentTarget | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => new Set([focusFrom, focusTo].filter((id): id is string => Boolean(id))),
  );

  const { data, error, loading, reload } = useAsync(async () => {
    const [trip, members, ledger, balances] = await Promise.all([
      getTrip(tripId),
      listTripMembers(tripId),
      listTripLedger(tripId),
      getTripBalances(tripId),
    ]);
    return { trip, members, ledger, balances };
  }, [tripId]);

  const toggle = (key: string): void =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  let body = null;
  if (data) {
    const currency = data.trip.currency;
    const statements = buildStatements(
      data.ledger.expenses,
      data.ledger.settlements,
      currency,
      data.members.map((member) => member.id),
    );
    const derived = statementsToBalances(statements);
    const pairs = pairwiseDebts(data.ledger.expenses, data.ledger.settlements, currency);
    const transfers = simplifyDebts(derived);

    const serverNet = new Map(data.balances.map((balance) => [balance.participantId, balance.net.minor]));
    const mismatched = derived.filter((balance) => (serverNet.get(balance.participantId) ?? 0) !== balance.net.minor);
    const sumNet = sumMoney(
      derived.map((balance) => balance.net),
      currency,
    );
    const excludedCount = data.ledger.expenses.filter((expense) => expense.excluded).length;
    const activeCount = data.ledger.expenses.length - excludedCount;

    const lookup = memberLookup(data.members);
    const { nameOf } = lookup;
    const statementOf = (id: string) => statements.find((statement) => statement.participantId === id);

    const focusTransfer =
      focusFrom && focusTo && focusMode === 'simplified'
        ? transfers.find((transfer) => transfer.from === focusFrom && transfer.to === focusTo)
        : undefined;
    const focusPair =
      focusFrom && focusTo ? pairs.find((pair) => pair.from === focusFrom && pair.to === focusTo) : undefined;
    const focusAmount = focusMode === 'simplified' ? focusTransfer?.amount : focusPair?.amount;

    const senderOut = focusFrom ? pairs.filter((pair) => pair.from === focusFrom) : [];
    const senderIn = focusFrom ? pairs.filter((pair) => pair.to === focusFrom) : [];
    const senderTransfers = focusFrom ? transfers.filter((transfer) => transfer.from === focusFrom) : [];

    const renderPairItems = (pair: PairDebt) => (
      <div className="mb-2 flex flex-col gap-1 rounded-2xl bg-muted/60 p-3 text-xs">
        {pair.owedItems.map((item) => (
          <div key={`o-${item.sourceId}`} className="flex justify-between gap-3">
            <span className="min-w-0 flex-1 text-foreground">
              {nameOf(pair.from)} chịu phần “{item.description}” do {nameOf(pair.to)} ứng
            </span>
            <span className="font-semibold text-negative">+{formatMoney(item.amount)}</span>
          </div>
        ))}
        {pair.offsetItems.map((item) => (
          <div key={`b-${item.sourceId}`} className="flex justify-between gap-3">
            <span className="min-w-0 flex-1 text-foreground">
              {item.kind === 'settlement'
                ? `${nameOf(pair.from)} đã chuyển trả trước đó`
                : `Bù trừ: ${nameOf(pair.to)} chịu phần “${item.description}” do ${nameOf(pair.from)} ứng`}
            </span>
            <span className="font-semibold text-positive">−{formatMoney(item.amount)}</span>
          </div>
        ))}
        {pair.cycleOffset.minor > 0 ? (
          <div className="flex justify-between gap-3">
            <span className="min-w-0 flex-1 text-foreground">Bù trừ vòng qua người khác</span>
            <span className="font-semibold text-positive">−{formatMoney(pair.cycleOffset)}</span>
          </div>
        ) : null}
        <div className="mt-1 flex justify-between border-t border-border pt-1.5">
          <span className="font-semibold text-foreground">
            {formatMoney(pair.owedTotal)} − {formatMoney(pair.offsetTotal)}
            {pair.cycleOffset.minor > 0 ? ` − ${formatMoney(pair.cycleOffset)}` : ''}
          </span>
          <span className="font-bold text-foreground">= {formatMoney(pair.amount)}</span>
        </div>
      </div>
    );

    body = (
      <>
        <SectionCard title="Kiểm chứng">
          <div className="flex flex-col gap-1.5 text-sm">
            <p className="text-foreground">
              {activeCount} khoản chi được tính
              {excludedCount > 0 ? ` · ${excludedCount} khoản đã xong không tính` : ''}
            </p>
            <p className={sumNet.minor === 0 ? 'text-positive' : 'text-negative'}>
              {sumNet.minor === 0
                ? '✓ Tổng số dư cả nhóm = 0'
                : `✗ Tổng số dư cả nhóm = ${formatMoney(sumNet)}`}
            </p>
            <p className={mismatched.length === 0 ? 'text-positive' : 'text-negative'}>
              {mismatched.length === 0
                ? '✓ Khớp từng đồng với số dư máy chủ tính'
                : `✗ Lệch với máy chủ ở ${mismatched.length} người — có thể ai đó vừa sửa khoản chi.`}
            </p>
            {mismatched.length > 0 ? (
              <Button label="Tải lại" variant="secondary" onClick={reload} busy={loading} />
            ) : null}
            <p className="text-foreground">
              Tối giản: {transfers.length} lần chuyển · Trả trực tiếp: {pairs.length} lần chuyển
            </p>
          </div>
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
                <div key={id} className="mb-2 flex items-center gap-3">
                  <Avatar name={nameOf(id)} uri={lookup.byId(id)?.avatarUrl} size="sm" />
                  <span className="min-w-0 flex-1 text-sm text-foreground">
                    {nameOf(id)}: ứng {formatMoney(statement.paidTotal)}, chịu {formatMoney(statement.owedTotal)}
                  </span>
                  <SignedAmount amount={statement.net} className="text-sm font-bold" />
                </div>
              );
            })}

            {focusMode === 'direct' && focusPair ? (
              <>
                <p className="mb-1 mt-2 text-xs font-semibold text-muted-foreground">Nợ trực tiếp giữa hai người</p>
                {renderPairItems(focusPair)}
              </>
            ) : null}

            {focusMode === 'simplified' ? (
              <>
                <p className="mb-1 mt-2 text-xs font-semibold text-muted-foreground">
                  Mọi khoản nợ trực tiếp của {nameOf(focusFrom)} (đã bù trừ)
                </p>
                <div className="mb-2 flex flex-col gap-1 rounded-2xl bg-muted/60 p-3 text-xs">
                  {senderOut.map((pair) => (
                    <div key={`out-${pair.to}`} className="flex justify-between gap-3">
                      <span className="min-w-0 flex-1 text-foreground">
                        {nameOf(focusFrom)} nợ {nameOf(pair.to)}
                      </span>
                      <span className="font-semibold text-negative">−{formatMoney(pair.amount)}</span>
                    </div>
                  ))}
                  {senderIn.map((pair) => (
                    <div key={`in-${pair.from}`} className="flex justify-between gap-3">
                      <span className="min-w-0 flex-1 text-foreground">
                        {nameOf(pair.from)} nợ {nameOf(focusFrom)}
                      </span>
                      <span className="font-semibold text-positive">+{formatMoney(pair.amount)}</span>
                    </div>
                  ))}
                  <div className="mt-1 flex justify-between border-t border-border pt-1.5">
                    <span className="font-semibold text-foreground">Cộng lại = số dư</span>
                    <span className="font-bold text-foreground">
                      {statementOf(focusFrom) ? signed(statementOf(focusFrom)!.net) : '0'}
                    </span>
                  </div>
                </div>
                <p className="text-xs leading-5 text-muted-foreground">
                  Thay vì {senderOut.length + senderIn.length} lần chuyển qua lại, {nameOf(focusFrom)} chỉ cần chuyển{' '}
                  {senderTransfers.map((transfer) => `${formatMoney(transfer.amount)} cho ${nameOf(transfer.to)}`).join(' và ')}
                  . Những người nợ {nameOf(focusFrom)} sẽ trả thẳng cho người {nameOf(focusFrom)} đang nợ — tổng tiền ai
                  cũng trả/nhận đúng như bước 1.
                </p>
              </>
            ) : null}

            {focusAmount ? (
              <div className="mt-3">
                <Button
                  label={`Mở mã QR nhận tiền của ${nameOf(focusTo)}`}
                  variant="secondary"
                  onClick={() =>
                    setPayment({
                      fromName: nameOf(focusFrom),
                      toName: nameOf(focusTo),
                      toUserId: lookup.byId(focusTo)?.userId ?? null,
                      toAvatarUrl: lookup.byId(focusTo)?.avatarUrl ?? null,
                      amount: focusAmount,
                    })
                  }
                />
              </div>
            ) : null}
          </SectionCard>
        ) : null}

        <SectionCard
          title="Bước 1 — Số dư từng người"
          hint="Số dư = đã ứng − phần phải chịu (+ đã chuyển trả − đã nhận). Dương là được nhận lại, âm là đang nợ. Chạm một người để xem từng khoản.">
          {statements.map((statement) => {
            const id = statement.participantId;
            const open = expanded.has(id);
            const member = lookup.byId(id);
            return (
              <div key={id} className="border-b border-border py-1 last:border-b-0">
                <button
                  type="button"
                  aria-expanded={open}
                  aria-label={`${nameOf(id)}, số dư ${signed(statement.net)}`}
                  onClick={() => toggle(id)}
                  className="flex min-h-12 w-full items-center gap-3 rounded-xl text-left hover:bg-muted/60 active:bg-muted">
                  <Avatar name={nameOf(id)} uri={member?.avatarUrl} size="sm" pending={!member?.claimed} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-base text-foreground">{nameOf(id)}</span>
                    <span className="block text-xs text-muted-foreground">
                      ứng {formatMoney(statement.paidTotal)} · chịu {formatMoney(statement.owedTotal)}
                    </span>
                  </span>
                  <SignedAmount amount={statement.net} />
                  {open ? (
                    <ChevronUp size={18} className="text-muted-foreground" aria-hidden />
                  ) : (
                    <ChevronDown size={18} className="text-muted-foreground" aria-hidden />
                  )}
                </button>

                {open ? (
                  <div className="mb-2 mt-1 flex flex-col gap-2 rounded-2xl bg-muted/60 p-3">
                    {statement.lines.length === 0 ? (
                      <p className="text-xs text-muted-foreground">Chưa dính khoản chi nào.</p>
                    ) : null}
                    {statement.lines.map((line) => (
                      <div key={line.expenseId} className="flex items-start gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-foreground">{line.description}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {formatDateTime(new Date(line.paidAt))}
                            {line.paid.minor > 0 ? ` · ứng ${formatMoney(line.paid)}` : ''}
                            {line.owed.minor > 0 ? ` · chịu ${formatMoney(line.owed)}` : ''}
                          </p>
                        </div>
                        <span className={`text-sm font-semibold ${toneOf(line.delta)}`}>{signed(line.delta)}</span>
                      </div>
                    ))}
                    {statement.settledOut.minor > 0 ? (
                      <div className="flex justify-between text-sm">
                        <span className="text-foreground">Đã chuyển trả</span>
                        <span className="font-semibold text-positive">+{formatMoney(statement.settledOut)}</span>
                      </div>
                    ) : null}
                    {statement.settledIn.minor > 0 ? (
                      <div className="flex justify-between text-sm">
                        <span className="text-foreground">Đã nhận lại</span>
                        <span className="font-semibold text-negative">−{formatMoney(statement.settledIn)}</span>
                      </div>
                    ) : null}
                    <div className="flex justify-between border-t border-border pt-2 text-sm">
                      <span className="font-semibold text-foreground">Cộng lại</span>
                      <SignedAmount amount={statement.net} className="text-sm font-bold" />
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </SectionCard>

        <SectionCard
          title="Bước 2 — Nợ trực tiếp, đã bù trừ"
          hint="Mỗi phần chia là “người chịu nợ người ứng”. Hai người nợ qua lại thì bù trừ, còn lại một chiều. Trả theo bảng này thì ai cũng trả đúng người mình nợ.">
          {pairs.length === 0 ? <p className="text-sm text-muted-foreground">Không ai nợ ai.</p> : null}
          {pairs.map((pair) => {
            const key = `pair:${pair.from}:${pair.to}`;
            const open = expanded.has(key);
            const count = pair.owedItems.length + pair.offsetItems.length;
            return (
              <div key={key}>
                <TransferRow
                  from={lookup.personOf(pair.from)}
                  to={lookup.personOf(pair.to)}
                  amount={pair.amount}
                  caption={`${count} khoản · chạm để ${open ? 'thu gọn' : 'xem'}`}
                  onClick={() => toggle(key)}
                />
                {open ? renderPairItems(pair) : null}
              </div>
            );
          })}
        </SectionCard>

        <SectionCard
          title="Bước 3 — Tối giản số lần chuyển"
          hint={`Gộp ${pairs.length} khoản nợ trực tiếp thành ${transfers.length} lần chuyển. Mỗi người vẫn trả ra / nhận về đúng số dư ở bước 1 — kiểm bằng cách cộng các dòng dưới đây của từng người. Chạm một dòng để mở mã QR nhận tiền.`}>
          {transfers.length === 0 ? (
            <p className="text-sm text-muted-foreground">Mọi người đã cân, không cần chuyển.</p>
          ) : null}
          {transfers.map((transfer) => (
            <TransferRow
              key={`${transfer.from}-${transfer.to}`}
              from={lookup.personOf(transfer.from)}
              to={lookup.personOf(transfer.to)}
              amount={transfer.amount}
              caption="chạm để mở mã QR"
              onClick={() =>
                setPayment({
                  fromName: nameOf(transfer.from),
                  toName: nameOf(transfer.to),
                  toUserId: lookup.byId(transfer.to)?.userId ?? null,
                  toAvatarUrl: lookup.byId(transfer.to)?.avatarUrl ?? null,
                  amount: transfer.amount,
                })
              }
            />
          ))}
        </SectionCard>
      </>
    );
  }

  return (
    <Screen
      header={
        <AppHeader title="Cách tính số dư" subtitle={data?.trip.name} showBack backFallback={`${routes.trip(tripId)}?tab=balances`} />
      }>
      {loading && data === null ? <LoadingView /> : null}
      {error ? <ErrorView message={error} onRetry={reload} /> : null}
      {body}
      <PaymentSheet target={payment} onClose={() => setPayment(null)} />
    </Screen>
  );
}
