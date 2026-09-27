import { CalendarDays, ChevronRight, NotebookPen, Pencil, Plus } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';

import { getTripBalances, listTripLedger } from '@/entities/balance';
import { listAllExpenses } from '@/entities/expense';
import { listTripMembers } from '@/entities/member';
import { getTrip, tripDateLabel, updateCoverIndex, useBackgroundCover } from '@/entities/trip';
import { useSession } from '@/entities/session';
import { ArchiveCard } from '@/features/archive-trip';
import { describeError, useAsync } from '@/shared/lib/async';
import { routes } from '@/shared/config';
import { formatMoney, money, simplifyDebts, sumMoney } from '@/shared/lib/money';
import { ErrorView, LoadingView, SegmentedControl } from '@/shared/ui';
import { BalancePanel } from '@/widgets/balance-panel';
import { ExpenseList } from '@/widgets/expense-list';
import { MembersPanel } from '@/widgets/members-panel';
import { TripHero } from '@/widgets/trip-hero';

type Tab = 'expenses' | 'balances' | 'members';

const TABS = [
  { value: 'expenses' as const, label: 'Khoản chi' },
  { value: 'balances' as const, label: 'Số dư' },
  { value: 'members' as const, label: 'Thành viên' },
];

function parseTab(value: string | null): Tab {
  return value === 'balances' || value === 'members' ? value : 'expenses';
}

/** Màn chuyến đi — bản web của overview.tsx (bỏ thẻ thời tiết). */
export function TripPage() {
  const { tripId = '' } = useParams();
  const navigate = useNavigate();
  const [search, setSearch] = useSearchParams();
  // Tab nằm trên URL: quay lại từ "Cách tính số dư" vẫn đúng tab Số dư.
  const tab = parseTab(search.get('tab'));
  const setTab = (next: Tab): void =>
    setSearch(next === 'expenses' ? {} : { tab: next }, { replace: true });
  const [actionError, setActionError] = useState<string | null>(null);
  const { userId } = useSession();

  const { data, error, loading, reload } = useAsync(async () => {
    const [trip, members, expenses, balances, ledger] = await Promise.all([
      getTrip(tripId),
      listTripMembers(tripId),
      listAllExpenses(tripId),
      getTripBalances(tripId),
      listTripLedger(tripId),
    ]);
    return { trip, members, expenses, balances, ledger };
  }, [tripId]);

  // Vừa đổi địa điểm (bộ ảnh rỗng) → tải ảnh bìa ở nền rồi tải lại màn.
  const cover = useBackgroundCover(data?.trip ?? null, reload);

  const hasMembers = (data?.members.length ?? 0) > 0;
  const settledCount = data ? data.expenses.filter((expense) => expense.settledAt).length : 0;
  // Tổng chi cả chuyến qua sumMoney — chặn sẵn việc lẫn đơn vị tiền tệ.
  const totalSpent = data
    ? sumMoney(data.expenses.map((expense) => expense.total), data.trip.currency)
    : money(0, 'VND');
  const coverImages = data?.trip.cover.images ?? [];

  const addExpense = (): void => {
    // Chưa có ai thì không chia được — dẫn thẳng tới chỗ thêm người.
    void navigate(hasMembers ? routes.expenseNew(tripId) : routes.tripMembers(tripId));
  };

  return (
    <div className="mx-auto min-h-dvh w-full max-w-md bg-background pb-safe">
      <TripHero
        // key theo bộ ảnh + vị trí: hero chỉ đọc initialIndex lúc mount.
        key={`${coverImages.map((image) => image.url).join('|')}#${data?.trip.cover.index ?? 0}`}
        loading={data === null || cover.loading}
        images={coverImages}
        initialIndex={data?.trip.cover.index ?? 0}
        onEditPlace={() => void navigate(routes.tripPlace(tripId))}
        onChangeIndex={(next) => {
          updateCoverIndex(tripId, next).catch((caught: unknown) =>
            setActionError(`Chưa lưu được ảnh bìa đang chọn: ${describeError(caught)}`),
          );
        }}
      />

      {/* Thẻ đè lên ảnh. */}
      <div className="relative -mt-7 flex flex-col gap-3 rounded-t-3xl bg-background px-4 pb-24 pt-5">
        {loading && data === null ? <LoadingView /> : null}
        {error ? <ErrorView message={error} onRetry={reload} /> : null}
        {actionError ? <ErrorView message={actionError} /> : null}

        {data ? (
          <>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <h1 className="break-words font-display text-3xl font-semibold leading-tight text-foreground">
                  {data.trip.name}
                </h1>
                <Link
                  to={routes.tripPlace(tripId)}
                  aria-label={data.trip.place ? 'Đổi địa điểm chuyến đi' : 'Chọn địa điểm chuyến đi'}
                  className="mt-1 inline-flex min-h-8 items-center text-sm">
                  <span className="text-muted-foreground">
                    {data.trip.place
                      ? `📍 ${data.trip.place.name}${data.trip.place.country ? `, ${data.trip.place.country}` : ''}`
                      : 'Chưa chọn địa điểm'}
                  </span>
                  <span className="pl-1 font-medium text-accent-strong">{data.trip.place ? 'Đổi' : 'Chọn'} ›</span>
                </Link>
                <Link
                  to={routes.tripEdit(tripId)}
                  aria-label="Sửa tên và ngày chuyến đi"
                  className="flex min-h-8 w-fit items-center gap-1.5 text-sm text-muted-foreground">
                  <CalendarDays size={14} aria-hidden />
                  {tripDateLabel(data.trip.startDate, data.trip.endDate) ?? 'Chưa đặt ngày'}
                  <Pencil size={13} className="text-accent-strong" aria-hidden />
                </Link>
                {cover.loading ? (
                  <p className="mt-1 text-xs text-muted-foreground">Đang tìm ảnh bìa cho {data.trip.place?.name}…</p>
                ) : null}
                {cover.error ? (
                  <p className="mt-1 text-xs text-negative">
                    Chưa tải được ảnh bìa: {cover.error}{' '}
                    <button type="button" onClick={cover.retry} className="min-h-8 font-semibold text-accent-strong underline">
                      Thử lại
                    </button>
                  </p>
                ) : null}
              </div>
              <div className="flex flex-col items-end">
                <span className="whitespace-nowrap text-xl font-bold text-primary">{formatMoney(totalSpent)}</span>
                <span className="text-xs text-muted-foreground">tổng chi</span>
              </div>
            </div>

            <Link
              to={routes.tripNotes(tripId)}
              aria-label="Ghi chú chuyến đi"
              className="flex min-h-12 items-center gap-3 rounded-2xl bg-muted/60 px-4 hover:bg-muted active:bg-muted">
              <NotebookPen size={18} className="text-primary" aria-hidden />
              <span className="min-w-0 flex-1 text-sm font-medium text-foreground">Ghi chú chuyến đi</span>
              <span className="text-xs text-muted-foreground">Kế hoạch, lưu ý…</span>
              <ChevronRight size={18} className="text-muted-foreground" aria-hidden />
            </Link>

            <ArchiveCard trip={data.trip} openTransfers={simplifyDebts(data.balances).length} />

            <div className="mt-2">
              <SegmentedControl options={TABS} value={tab} onChange={setTab} ariaLabel="Chọn nội dung hiển thị" />
            </div>

            {/* Ngay dưới tab: luôn trong tầm tay, không bị cuộn mất khi có nhiều khoản. */}
            <button
              type="button"
              onClick={addExpense}
              className="flex min-h-12 items-center justify-center gap-2 rounded-full bg-primary px-5 text-base font-semibold text-primary-foreground active:opacity-80">
              <Plus size={20} aria-hidden />
              {hasMembers ? 'Thêm khoản chi' : 'Thêm thành viên trước'}
            </button>

            <div className="mt-1">
              {tab === 'expenses' ? (
                <ExpenseList
                  expenses={data.expenses}
                  members={data.members}
                  myUserId={userId}
                  editHref={(expenseId) => routes.expenseEdit(tripId, expenseId)}
                  onChanged={reload}
                />
              ) : null}
              {tab === 'balances' ? (
                <BalancePanel
                  balances={data.balances}
                  ledger={data.ledger}
                  members={data.members}
                  currency={data.trip.currency}
                  settledCount={settledCount}
                  detailHref={(focus) => routes.balances(tripId, focus)}
                />
              ) : null}
              {tab === 'members' ? (
                <MembersPanel members={data.members} manageHref={routes.tripMembers(tripId)} />
              ) : null}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
