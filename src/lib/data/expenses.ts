/**
 * Tầng truy cập dữ liệu — khoản chi, số dư, tất toán.
 *
 * Cầu nối giữa lõi tiền tệ (src/lib/money) và Postgres. Quy tắc: ra khỏi tầng
 * này thì mọi số tiền đều là `Money`, không còn số trần.
 *
 * Mọi id người ở đây là `trip_members.id`, KHÔNG phải id tài khoản — người
 * chưa nhận lời mời vẫn có công nợ đầy đủ.
 */

import type { Balance, Money, SplitLine } from '@/lib/money';
import { money, sumMoney } from '@/lib/money';
import { supabase } from '@/lib/supabase/client';
import type { SplitModeDb } from '@/lib/supabase/database.types';
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
function assertSharesBalance(input: SaveExpenseInput): void {
  if (input.description.trim() === '') {
    throw new DataError('Khoản chi cần có mô tả.');
  }
  if (input.total.minor <= 0) {
    throw new DataError('Khoản chi phải lớn hơn 0.');
  }
  if (input.shares.length === 0) {
    throw new DataError('Phải có ít nhất một người gánh khoản chi.');
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

function sharesPayload(shares: readonly SplitLine[]): { member_id: string; amount_minor: number }[] {
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
  'id, description, amount_minor, currency, paid_by, split_mode, paid_at, created_by';

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
  }));
}

/** Một khoản chi kèm phần chia — dùng cho màn hình sửa. */
export async function getExpenseDetail(expenseId: string): Promise<ExpenseDetail> {
  const rows = unwrap(
    await supabase.from('expenses').select(EXPENSE_COLUMNS).eq('id', expenseId).is('deleted_at', null),
  );
  const row = rows[0];
  if (!row) {
    throw new DataError('Không tìm thấy khoản chi, hoặc bạn không có quyền xem.');
  }

  const currency = parseCurrency(row.currency);
  const shareRows = unwrap(
    await supabase.from('expense_shares').select('member_id, amount_minor').eq('expense_id', expenseId),
  );

  return {
    id: row.id,
    description: row.description,
    total: money(toSafeMinor(row.amount_minor, 'amount_minor'), currency),
    paidByMemberId: row.paid_by,
    splitMode: row.split_mode,
    paidAt: row.paid_at,
    createdBy: row.created_by,
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

  const { data } = await supabase.auth.getUser();
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
