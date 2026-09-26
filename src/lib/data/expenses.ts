/**
 * Tầng truy cập dữ liệu — khoản chi, số dư, tất toán.
 *
 * Cầu nối giữa lõi tiền tệ (src/lib/money) và Postgres. Quy tắc: ra khỏi tầng
 * này thì mọi số tiền đều là `Money`, không còn số trần.
 *
 * Mọi id người ở đây là `trip_members.id`, KHÔNG phải id tài khoản — người
 * chưa nhận lời mời vẫn có công nợ đầy đủ.
 */

import type { PostgrestError } from '@supabase/supabase-js';

import type { Balance, LedgerExpense, LedgerSettlement, Money, SplitLine } from '@/lib/money';
import { money, sumMoney } from '@/lib/money';
import { supabase } from '@/lib/supabase/client';
import type { ExpenseSnapshotRow, SplitModeDb } from '@/lib/supabase/database.types';
import { DataError, toSafeMinor, unwrap, unwrapVoid } from '@/lib/supabase/errors';

import { parseCurrency } from './trips';

export interface ExpenseSummary {
  readonly id: string;
  readonly description: string;
  readonly total: Money;
  readonly paidByMemberId: string;
  readonly splitMode: SplitModeDb;
  readonly paidAt: string;
  readonly createdBy: string;
  /** Khác null = đã xong: vẫn hiện, vẫn tính vào tổng chi, KHÔNG tính vào số dư. */
  readonly settledAt: string | null;
}

export interface ExpenseDetail extends ExpenseSummary {
  readonly shares: readonly SplitLine[];
}

export interface SaveExpenseInput {
  readonly tripId: string;
  readonly description: string;
  readonly total: Money;
  /** trip_members.id của người đại diện đã đứng ra trả. */
  readonly paidByMemberId: string;
  /** Kết quả trả về từ splitExpense(). */
  readonly shares: readonly SplitLine[];
  readonly splitMode: SplitModeDb;
  /** Mặc định là thời điểm hiện tại. */
  readonly paidAt?: Date;
}

/**
 * Kiểm bất biến tổng TRƯỚC khi gửi đi.
 *
 * Việc này không thay thế ràng buộc ở DB — client luôn có thể bị bỏ qua. Nó chỉ
 * để báo lỗi tức thì cho người dùng, không tốn một vòng mạng. DB vẫn kiểm lại
 * trong RPC và một lần nữa bằng constraint trigger lúc COMMIT.
 */
export function assertSharesBalance(input: SaveExpenseInput): void {
  if (input.description.trim() === '') {
    throw new DataError('Khoản chi cần có mô tả.');
  }
  if (input.total.minor <= 0) {
    throw new DataError('Khoản chi phải lớn hơn 0.');
  }
  if (input.shares.length === 0) {
    throw new DataError('Phải có ít nhất một người gánh khoản chi.');
  }
  if (input.shares.some((share) => share.amount.minor < 0)) {
    throw new DataError('Phần chia của một người không được âm.');
  }
  const ids = new Set(input.shares.map((share) => share.participantId));
  if (ids.size !== input.shares.length) {
    throw new DataError('Một người xuất hiện hai lần trong khoản chi.');
  }

  // sumMoney tự ném lỗi nếu danh sách lẫn đơn vị tiền tệ.
  const owed = sumMoney(
    input.shares.map((share) => share.amount),
    input.total.currency,
  );

  if (owed.minor !== input.total.minor) {
    const diff = owed.minor - input.total.minor;
    const direction = diff > 0 ? 'thừa' : 'thiếu';
    throw new DataError(
      `Tổng phần chia đang ${direction} ${Math.abs(diff)} so với tổng khoản chi.`,
    );
  }
}

function sharesPayload(
  shares: readonly SplitLine[],
): { member_id: string; amount_minor: number }[] {
  return shares.map((share) => ({
    member_id: share.participantId,
    amount_minor: share.amount.minor,
  }));
}

export async function createExpense(input: SaveExpenseInput): Promise<string> {
  assertSharesBalance(input);

  return unwrap(
    await supabase.rpc('create_expense', {
      p_trip_id: input.tripId,
      p_description: input.description.trim(),
      p_amount_minor: input.total.minor,
      p_paid_by: input.paidByMemberId,
      p_shares: sharesPayload(input.shares),
      p_split_mode: input.splitMode,
      p_paid_at: (input.paidAt ?? new Date()).toISOString(),
    }),
  );
}

/** Sửa khoản chi: thay toàn bộ phần chia, không cộng trừ theo delta. */
export async function updateExpense(expenseId: string, input: SaveExpenseInput): Promise<void> {
  assertSharesBalance(input);

  unwrapVoid(
    await supabase.rpc('update_expense', {
      p_expense_id: expenseId,
      p_description: input.description.trim(),
      p_amount_minor: input.total.minor,
      p_paid_by: input.paidByMemberId,
      p_shares: sharesPayload(input.shares),
      p_split_mode: input.splitMode,
      p_paid_at: (input.paidAt ?? new Date()).toISOString(),
    }),
  );
}

export async function voidExpense(expenseId: string): Promise<void> {
  unwrapVoid(await supabase.rpc('void_expense', { p_expense_id: expenseId }));
}

const EXPENSE_COLUMNS =
  'id, description, amount_minor, currency, paid_by, split_mode, paid_at, created_by, settled_at';

export async function listExpenses(
  tripId: string,
  options: { limit?: number; offset?: number } = {},
): Promise<ExpenseSummary[]> {
  const limit = options.limit ?? 50;
  const offset = options.offset ?? 0;

  const rows = unwrap(
    await supabase
      .from('expenses')
      .select(EXPENSE_COLUMNS)
      .eq('trip_id', tripId)
      .is('deleted_at', null)
      .order('paid_at', { ascending: false })
      // Khoá phụ bắt buộc cho phân trang offset: paid_at chỉ tới phút nên hay
      // trùng, thiếu thứ tự xác định thì một khoản có thể lặp hoặc mất giữa hai trang.
      .order('id', { ascending: true })
      .range(offset, offset + limit - 1),
  );

  return rows.map((row) => ({
    id: row.id,
    description: row.description,
    total: money(toSafeMinor(row.amount_minor, 'amount_minor'), parseCurrency(row.currency)),
    paidByMemberId: row.paid_by,
    splitMode: row.split_mode,
    paidAt: row.paid_at,
    createdBy: row.created_by,
    settledAt: row.settled_at,
  }));
}

/** Đánh dấu / bỏ đánh dấu "đã xong". */
export async function setExpenseSettled(expenseId: string, settled: boolean): Promise<void> {
  unwrapVoid(
    await supabase.rpc('set_expense_settled', { p_expense_id: expenseId, p_settled: settled }),
  );
}

/** Một khoản chi kèm phần chia — dùng cho màn hình sửa. */
export async function getExpenseDetail(expenseId: string): Promise<ExpenseDetail> {
  const rows = unwrap(
    await supabase
      .from('expenses')
      .select(EXPENSE_COLUMNS)
      .eq('id', expenseId)
      .is('deleted_at', null),
  );
  const row = rows[0];
  if (!row) {
    throw new DataError('Không tìm thấy khoản chi, hoặc bạn không có quyền xem.');
  }

  const currency = parseCurrency(row.currency);
  const shareRows = unwrap(
    await supabase
      .from('expense_shares')
      .select('member_id, amount_minor')
      .eq('expense_id', expenseId),
  );

  return {
    id: row.id,
    description: row.description,
    total: money(toSafeMinor(row.amount_minor, 'amount_minor'), currency),
    paidByMemberId: row.paid_by,
    splitMode: row.split_mode,
    paidAt: row.paid_at,
    createdBy: row.created_by,
    settledAt: row.settled_at,
    shares: shareRows.map((share) => ({
      participantId: share.member_id,
      amount: money(toSafeMinor(share.amount_minor, 'amount_minor'), currency),
    })),
  };
}

export interface NamedBalance extends Balance {
  readonly displayName: string;
  readonly groupId: string | null;
}

/**
 * Số dư của từng thành viên, tính ở phía DB từ dữ liệu gốc.
 *
 * Kiểm lại bất biến "tổng số dư của chuyến đi bằng 0" ngay khi nhận về. Khác 0
 * nghĩa là view sai hoặc dữ liệu hỏng — hiện số dư sai còn tệ hơn báo lỗi, vì
 * người dùng sẽ tin và đi đòi tiền nhau theo con số đó.
 */
export async function getTripBalances(tripId: string): Promise<NamedBalance[]> {
  const rows = unwrap(
    await supabase
      .from('trip_balances')
      .select('member_id, display_name, group_id, currency, net_minor')
      .eq('trip_id', tripId),
  );

  const balances: NamedBalance[] = rows.map((row) => ({
    participantId: row.member_id,
    displayName: row.display_name,
    groupId: row.group_id,
    net: money(toSafeMinor(row.net_minor, 'net_minor'), parseCurrency(row.currency)),
  }));

  const total = balances.reduce((sum, balance) => sum + balance.net.minor, 0);
  if (balances.length > 0 && total !== 0) {
    throw new DataError(
      `Dữ liệu số dư không nhất quán: tổng của chuyến đi là ${total}, đáng lẽ phải bằng 0.`,
    );
  }

  return balances;
}

export interface RecordSettlementInput {
  readonly tripId: string;
  readonly fromMemberId: string;
  readonly toMemberId: string;
  readonly amount: Money;
  readonly note?: string;
}

export async function recordSettlement(input: RecordSettlementInput): Promise<void> {
  if (input.fromMemberId === input.toMemberId) {
    throw new DataError('Không thể tự chuyển tiền cho chính mình.');
  }
  if (input.amount.minor <= 0) {
    throw new DataError('Số tiền tất toán phải lớn hơn 0.');
  }

  const { data, error } = await supabase.auth.getUser();
  if (error) {
    throw new DataError(`Lỗi xác thực: ${error.message}`);
  }
  const userId = data.user?.id;
  if (!userId) {
    throw new DataError('Bạn cần đăng nhập để ghi nhận tất toán.');
  }

  unwrapVoid(
    await supabase.from('settlements').insert({
      trip_id: input.tripId,
      currency: input.amount.currency,
      from_member: input.fromMemberId,
      to_member: input.toMemberId,
      amount_minor: input.amount.minor,
      note: input.note ?? null,
      created_by: userId,
    }),
  );
}

// ---------------------------------------------------------------------------
// Nhật ký khoản chi — ghi bởi RPC (bảng expense_events), client chỉ đọc.
// ---------------------------------------------------------------------------

export type ExpenseEventAction = 'create' | 'update' | 'void' | 'settle' | 'unsettle';

/** Trạng thái trọn một khoản chi tại một thời điểm. */
export interface ExpenseSnapshot {
  readonly description: string;
  readonly total: Money;
  readonly paidByMemberId: string;
  readonly splitMode: SplitModeDb;
  readonly paidAt: string;
  readonly settledAt: string | null;
  readonly shares: readonly SplitLine[];
}

export interface ExpenseEvent {
  readonly id: string;
  readonly expenseId: string;
  readonly action: ExpenseEventAction;
  /** trip_members.id của người thao tác; null nếu không xác định được. */
  readonly actorMemberId: string | null;
  /** ISO 8601. */
  readonly at: string;
  /** null với 'create'. */
  readonly before: ExpenseSnapshot | null;
  /** null với 'void'. */
  readonly after: ExpenseSnapshot | null;
}

const EVENT_ACTIONS: readonly ExpenseEventAction[] = [
  'create',
  'update',
  'void',
  'settle',
  'unsettle',
];

function parseEventAction(value: string): ExpenseEventAction {
  const found = EVENT_ACTIONS.find((action) => action === value);
  if (!found) {
    throw new DataError(`Nhật ký khoản chi có hành động lạ: "${value}".`);
  }
  return found;
}

/**
 * Ảnh chụp do DB dựng (expense_snapshot). Hỏng hình dạng = lỗi thật ở server,
 * nên ném lỗi chứ không lặng lẽ bỏ qua — lịch sử tiền bạc hiện thiếu còn tệ
 * hơn không hiện.
 */
function parseSnapshot(row: ExpenseSnapshotRow | null): ExpenseSnapshot | null {
  if (row === null) return null;
  if (typeof row !== 'object' || !Array.isArray(row.shares)) {
    throw new DataError('Nhật ký khoản chi có ảnh chụp không đúng định dạng.');
  }
  const currency = parseCurrency(row.currency);
  return {
    description: row.description,
    total: money(toSafeMinor(row.amount_minor, 'amount_minor'), currency),
    paidByMemberId: row.paid_by,
    splitMode: row.split_mode,
    paidAt: row.paid_at,
    settledAt: row.settled_at ?? null,
    shares: row.shares.map((share) => ({
      participantId: share.member_id,
      amount: money(toSafeMinor(share.amount_minor, 'amount_minor'), currency),
    })),
  };
}

/** Ảnh chụp từ một khoản chi đã có trong bộ nhớ — dùng cho nhánh khách. */
export function snapshotOf(expense: {
  readonly description: string;
  readonly total: Money;
  readonly paidByMemberId: string;
  readonly splitMode: SplitModeDb;
  readonly paidAt: string;
  readonly settledAt?: string | null;
  readonly shares: readonly SplitLine[];
}): ExpenseSnapshot {
  return {
    description: expense.description,
    total: expense.total,
    paidByMemberId: expense.paidByMemberId,
    splitMode: expense.splitMode,
    paidAt: expense.paidAt,
    settledAt: expense.settledAt ?? null,
    shares: expense.shares.map((share) => ({
      participantId: share.participantId,
      amount: share.amount,
    })),
  };
}

/** Lịch sử của một khoản chi, mới nhất trước. */
export async function listExpenseEvents(expenseId: string): Promise<ExpenseEvent[]> {
  const rows = unwrap(
    await supabase
      .from('expense_events')
      .select('id, expense_id, action, actor_member_id, created_at, before, after')
      .eq('expense_id', expenseId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false }),
  );

  return rows.map((row) => ({
    id: row.id,
    expenseId: row.expense_id,
    action: parseEventAction(row.action),
    actorMemberId: row.actor_member_id,
    at: row.created_at,
    before: parseSnapshot(row.before),
    after: parseSnapshot(row.after),
  }));
}

// ---------------------------------------------------------------------------
// Sổ cái — dữ liệu gốc cho src/lib/money/ledger.ts (bảng kê, nợ từng cặp).
// ---------------------------------------------------------------------------

export interface TripLedger {
  readonly expenses: LedgerExpense[];
  readonly settlements: LedgerSettlement[];
}

const LEDGER_PAGE_SIZE = 500;

/**
 * Đọc hết mọi trang của một truy vấn bằng phân trang KEYSET theo id.
 *
 * - Không dùng offset: giữa hai lần tải trang, người khác thêm/xoá một khoản
 *   là mọi dòng sau đó trượt vị trí — một khoản bị sót, khoản khác bị đọc hai
 *   lần. Keyset (`id > id cuối của trang trước`) không trượt.
 * - Dừng khi gặp trang RỖNG, không phải trang "ít hơn cỡ trang": PostgREST cắt ở
 *   max-rows mà không báo lỗi, max-rows nhỏ hơn cỡ trang thì cách dừng kia
 *   tưởng đã hết.
 * - Khử trùng theo id cho chắc.
 */
async function fetchAllById<T extends { id: string }>(
  page: (afterId: string | null) => PromiseLike<{ data: T[] | null; error: PostgrestError | null }>,
): Promise<T[]> {
  const byId = new Map<string, T>();
  let afterId: string | null = null;
  for (;;) {
    const rows: T[] = unwrap(await page(afterId));
    if (rows.length === 0) return [...byId.values()];
    for (const row of rows) byId.set(row.id, row);
    afterId = rows[rows.length - 1].id;
  }
}

/**
 * Mọi khoản chi còn hiệu lực (kèm phần chia) và mọi lần tất toán của chuyến.
 *
 * Hai luồng chạy song song, mỗi luồng tải theo trang tới khi hết. Phần chia
 * NHÚNG vào truy vấn khoản chi — không gọi riêng từng khoản (N+1). Khoản "đã
 * xong" vẫn trả về nhưng excluded = true: ledger bỏ qua khi tính số dư, cùng
 * quy tắc với view trip_balances. Thứ tự hiển thị do ledger tự sắp theo paidAt.
 */
export async function listTripLedger(tripId: string): Promise<TripLedger> {
  const [expenseRows, settlementRows] = await Promise.all([
    fetchAllById((afterId) => {
      let query = supabase
        .from('expenses')
        .select(
          'id, description, amount_minor, currency, paid_by, paid_at, settled_at, expense_shares(member_id, amount_minor)',
        )
        .eq('trip_id', tripId)
        .is('deleted_at', null);
      if (afterId) query = query.gt('id', afterId);
      return query.order('id', { ascending: true }).limit(LEDGER_PAGE_SIZE);
    }),
    fetchAllById((afterId) => {
      let query = supabase
        .from('settlements')
        .select('id, from_member, to_member, amount_minor, currency')
        .eq('trip_id', tripId)
        .is('deleted_at', null);
      if (afterId) query = query.gt('id', afterId);
      return query.order('id', { ascending: true }).limit(LEDGER_PAGE_SIZE);
    }),
  ]);

  const expenses = expenseRows.map((row): LedgerExpense => {
    const currency = parseCurrency(row.currency);
    return {
      id: row.id,
      description: row.description,
      paidAt: row.paid_at,
      payerId: row.paid_by,
      total: money(toSafeMinor(row.amount_minor, 'amount_minor'), currency),
      shares: row.expense_shares.map((share) => ({
        participantId: share.member_id,
        amount: money(toSafeMinor(share.amount_minor, 'amount_minor'), currency),
      })),
      excluded: row.settled_at !== null,
    };
  });

  const settlements = settlementRows.map((row): LedgerSettlement => ({
    id: row.id,
    fromId: row.from_member,
    toId: row.to_member,
    amount: money(toSafeMinor(row.amount_minor, 'amount_minor'), parseCurrency(row.currency)),
  }));

  return { expenses, settlements };
}
