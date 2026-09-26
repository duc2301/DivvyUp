import { Info } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';

import type { NamedBalance, TripLedger } from '@/entities/balance';
import { SignedAmount, TransferRow } from '@/entities/balance';
import type { TripMember } from '@/entities/member';
import { memberLookup } from '@/entities/member';
import type { CurrencyCode } from '@/shared/lib/money';
import { pairwiseDebts, simplifyDebts } from '@/shared/lib/money';
import { Avatar, SegmentedControl } from '@/shared/ui';

export type SettleMode = 'simplified' | 'direct';

interface BalancePanelProps {
  readonly balances: readonly NamedBalance[];
  readonly ledger: TripLedger;
  readonly members: readonly TripMember[];
  readonly currency: CurrencyCode;
  readonly settledCount: number;
  /** Đường dẫn "Cách tính số dư", kèm cặp người + chế độ khi chạm một dòng. */
  readonly detailHref: (focus?: { from: string; to: string; mode: SettleMode }) => string;
}

/**
 * Tab Số dư: số dư từng người (+/− kèm màu) và "Chi tiết người trả" với công tắc
 * Tối giản / Trả trực tiếp. Mọi con số từ lõi tiền dùng chung.
 */
export function BalancePanel({ balances, ledger, members, currency, settledCount, detailHref }: BalancePanelProps) {
  // Mặc định tối giản (ít lần chuyển nhất).
  const [mode, setMode] = useState<SettleMode>('simplified');
  const lookup = memberLookup(members);

  const transfers = simplifyDebts(balances);
  const directDebts = pairwiseDebts(ledger.expenses, ledger.settlements, currency);
  const shown = mode === 'simplified' ? transfers : directDebts;
  const unsettledPeople = balances.filter((balance) => balance.net.minor !== 0).length;

  return (
    <div className="flex flex-col gap-3">
      <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">Số dư</h2>
        {balances.length === 0 ? (
          <p className="text-sm text-muted-foreground">Chưa có thành viên nào.</p>
        ) : (
          <ul>
            {balances.map((balance) => {
              const member = lookup.byId(balance.participantId);
              return (
                <li key={balance.participantId} className="flex items-center gap-3 py-2">
                  <Avatar name={balance.displayName} uri={member?.avatarUrl} size="sm" pending={!member?.claimed} />
                  <span className="min-w-0 flex-1 truncate text-base text-foreground">{balance.displayName}</span>
                  <SignedAmount amount={balance.net} className="pl-3 text-base font-semibold" />
                </li>
              );
            })}
          </ul>
        )}
        {settledCount > 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">Không tính {settledCount} khoản chi đã đánh dấu xong.</p>
        ) : null}
      </section>

      {transfers.length > 0 ? (
        <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Chi tiết người trả
          </h2>
          <SegmentedControl
            options={[
              { value: 'simplified' as const, label: `Tối giản · ${transfers.length}` },
              { value: 'direct' as const, label: `Trả trực tiếp · ${directDebts.length}` },
            ]}
            value={mode}
            onChange={setMode}
            ariaLabel="Cách chuyển tiền"
          />
          <p className="mb-1 mt-2 text-xs leading-5 text-muted-foreground">
            {mode === 'simplified'
              ? `Ít lần chuyển nhất (${transfers.length} lần cho ${unsettledPeople} người còn nợ/được nhận). Có thể chuyển cho người mình không chi chung — tổng mỗi người trả/nhận vẫn đúng từng đồng.`
              : 'Ai nợ ai trả nấy theo từng khoản, đã bù trừ hai chiều. Nhiều lần chuyển hơn nhưng dễ đối chiếu.'}{' '}
            Chạm một dòng để xem vì sao.
          </p>
          {shown.map((transfer) => (
            <Link
              key={`${mode}-${transfer.from}-${transfer.to}`}
              to={detailHref({ from: transfer.from, to: transfer.to, mode })}
              className="-mx-2 block rounded-2xl px-2 hover:bg-muted/60 active:bg-muted">
              <TransferRow from={lookup.personOf(transfer.from)} to={lookup.personOf(transfer.to)} amount={transfer.amount} />
            </Link>
          ))}
          <Link
            to={detailHref()}
            className="mt-2 flex min-h-11 items-center justify-center gap-2 rounded-xl bg-muted/60 text-sm font-medium text-foreground hover:bg-muted">
            <Info size={16} className="text-primary" aria-hidden />
            Xem cách tính: khoản nào bù trừ khoản nào
          </Link>
        </section>
      ) : null}
    </div>
  );
}
