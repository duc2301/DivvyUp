/**
 * Tầng truy cập dữ liệu — khoản chi, số dư, tất toán.
 *
 * Đây là cầu nối giữa lõi tiền tệ (src/lib/money) và Postgres. Quy tắc:
 * ra khỏi tầng này thì mọi số tiền đều là `Money`, không còn số trần.
 */

import type { Balance, Money, SplitLine } from '@/lib/money';
import { money, sumMoney } from '@/lib/money';
import { supabase } from '@/lib/supabase/client';
import { DataError, toSafeMinor, unwrap, unwrapVoid } from '@/lib/supabase/errors';

import { parseCurrency } from './groups';

export interface ExpenseSummary {
  readonly id: string;
  readonly description: string;
  readonly total: Money;
  readonly paidAt: string;
  readonly createdBy: string;
}

export interface CreateExpenseInput {
  readonly groupId: string;
  readonly description: string;
  readonly total: Money;
  /** Ai đã ứng tiền. Thường là một người, nhưng hỗ trợ nhiều người cùng trả. */
  readonly payments: readonly { participantId: string; amount: Money }[];
  /** Kết quả trả về từ splitExpense(). */
  readonly shares: readonly SplitLine[];
  readonly paidAt?: Date;
}

/**
 * Tạo khoản chi qua RPC create_expense().
 *
 * Bất biến tổng được kiểm ở ĐÂY trước khi gửi đi, và kiểm lại một lần nữa
 * trong RPC cùng constraint trigger ở DB. Ba tầng độc lập cùng canh một luật —
 * kiểm ở client là để báo lỗi tức thì cho người dùng, không phải để thay thế
 * ràng buộc ở DB (client luôn có thể bị bỏ qua).
 */
export async function createExpense(input: CreateExpenseInput): Promise<string> {
  const description = input.description.trim();
  if (description === '') {
    throw new DataError('Khoản chi cần có mô tả.');
  }
  if (input.total.minor <= 0) {
    throw new DataError('Khoản chi phải lớn hơn 0.');
  }
  if (input.payments.length === 0) {
    throw new DataError('Phải có ít nhất một người ứng tiền.');
  }
  if (input.shares.length === 0) {
    throw new DataError('Phải có ít nhất một người gánh khoản chi.');
  }

  // sumMoney tự ném lỗi nếu danh sách lẫn đơn vị tiền tệ.
  const paid = sumMoney(
    input.payments.map((payment) => payment.amount),
    input.total.currency,
  );
  const owed = sumMoney(
    input.shares.map((share) => share.amount),
    input.total.currency,
  );

  if (paid.minor !== input.total.minor) {
    throw new DataError(
      `Tổng tiền ứng lệch ${paid.minor - input.total.minor} đơn vị so với khoản chi.`,
    );
  }
  if (owed.minor !== input.total.minor) {
    throw new DataError(
      `Tổng phần chia lệch ${owed.minor - input.total.minor} đơn vị so với khoản chi.`,
    );
  }

  const expenseId = unwrap(
    await supabase.rpc('create_expense', {
      p_group_id: input.groupId,
      p_description: description,
      p_amount_minor: input.total.minor,
      p_payments: input.payments.map((payment) => ({
        user_id: payment.participantId,
        amount_minor: payment.amount.minor,
      })),
      p_shares: input.shares.map((share) => ({
        user_id: share.participantId,
        amount_minor: share.amount.minor,
      })),
      p_paid_at: (input.paidAt ?? new Date()).toISOString(),
    }),
  );

  return expenseId;
}

export async function listExpenses(
  groupId: string,
  options: { limit?: number; offset?: number } = {},
): Promise<ExpenseSummary[]> {
  const limit = options.limit ?? 50;
  const offset = options.offset ?? 0;

  const rows = unwrap(
    await supabase
      .from('expenses')
      .select('id, description, amount_minor, currency, paid_at, created_by')
      .eq('group_id', groupId)
      .is('deleted_at', null)
      .order('paid_at', { ascending: false })
      .range(offset, offset + limit - 1),
  );

  return rows.map((row) => ({
    id: row.id,
    description: row.description,
    total: money(toSafeMinor(row.amount_minor, 'amount_minor'), parseCurrency(row.currency)),
    paidAt: row.paid_at,
    createdBy: row.created_by,
  }));
}

export async function voidExpense(expenseId: string): Promise<void> {
  unwrapVoid(await supabase.rpc('void_expense', { p_expense_id: expenseId }));
}

/**
 * Số dư của từng thành viên, tính ở phía DB từ dữ liệu gốc.
 *
 * Kiểm lại bất biến "tổng số dư của nhóm bằng 0" ngay khi nhận về. Nếu khác 0
 * thì có bug ở view group_balances hoặc dữ liệu đã hỏng — hiện số dư sai còn
 * tệ hơn báo lỗi, vì người dùng sẽ tin và đi đòi tiền nhau theo con số đó.
 */
export async function getBalances(groupId: string): Promise<Balance[]> {
  const rows = unwrap(
    await supabase
      .from('group_balances')
      .select('user_id, currency, net_minor')
      .eq('group_id', groupId),
  );

  const balances: Balance[] = rows.map((row) => ({
    participantId: row.user_id,
    net: money(toSafeMinor(row.net_minor, 'net_minor'), parseCurrency(row.currency)),
  }));

  const total = balances.reduce((sum, balance) => sum + balance.net.minor, 0);
  if (balances.length > 0 && total !== 0) {
    throw new DataError(
      `Dữ liệu số dư không nhất quán: tổng của nhóm là ${total}, đáng lẽ phải bằng 0.`,
    );
  }

  return balances;
}

export interface RecordSettlementInput {
  readonly groupId: string;
  readonly fromUserId: string;
  readonly toUserId: string;
  readonly amount: Money;
  readonly note?: string;
}

/** Ghi nhận một lần trả tiền giữa hai thành viên. */
export async function recordSettlement(input: RecordSettlementInput): Promise<void> {
  if (input.fromUserId === input.toUserId) {
    throw new DataError('Không thể tự chuyển tiền cho chính mình.');
  }
  if (input.amount.minor <= 0) {
    throw new DataError('Số tiền tất toán phải lớn hơn 0.');
  }

  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) {
    throw new DataError('Bạn cần đăng nhập để ghi nhận tất toán.');
  }

  unwrapVoid(
    await supabase.from('settlements').insert({
      group_id: input.groupId,
      currency: input.amount.currency,
      from_user: input.fromUserId,
      to_user: input.toUserId,
      amount_minor: input.amount.minor,
      note: input.note ?? null,
      created_by: userId,
    }),
  );
}
