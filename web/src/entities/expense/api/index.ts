import type { ExpenseSummary } from '@core/lib/data/expenses';
import { listExpenses } from '@core/lib/data/expenses';

/** Khoản chi — tầng dữ liệu dùng chung với mobile (nhánh remote). */
export type {
  ExpenseDetail,
  ExpenseEvent,
  ExpenseEventAction,
  ExpenseSnapshot,
  ExpenseSummary,
  SaveExpenseInput,
} from '@core/lib/data/expenses';
export {
  createExpense,
  getExpenseDetail,
  listExpenseEvents,
  listExpenses,
  setExpenseSettled,
  updateExpense,
  voidExpense,
} from '@core/lib/data/expenses';

const EXPENSE_PAGE_SIZE = 200;

/**
 * Mọi khoản chi của chuyến — phân trang tới hết, cùng cách với listAllExpenses
 * trong manager.ts. Tổng chi cả chuyến PHẢI cộng đủ, không dừng ở trang đầu.
 */
export async function listAllExpenses(tripId: string): Promise<ExpenseSummary[]> {
  const all: ExpenseSummary[] = [];
  for (;;) {
    const page = await listExpenses(tripId, { limit: EXPENSE_PAGE_SIZE, offset: all.length });
    all.push(...page);
    if (page.length < EXPENSE_PAGE_SIZE) return all;
  }
}
