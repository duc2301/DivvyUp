/**
 * Chia một khoản chi cho nhiều người.
 *
 * BẤT BIẾN KHÔNG BAO GIỜ ĐƯỢC PHÁ:
 *   sum(mọi phần chia) === tổng khoản chi, chính xác tới từng đơn vị nhỏ nhất.
 *
 * Cách làm: chia phần nguyên trước, rồi rải phần dư bằng thuật toán
 * largest remainder (Hamilton). Người có phần dư lớn nhất nhận thêm 1 đơn vị.
 * Thứ tự rải là tất định — cùng đầu vào luôn ra cùng kết quả.
 */

import type { CurrencyCode } from './currency.ts';
import type { Money } from './money.ts';
import { formatMoney, money, sumMoney } from './money.ts';

export type SplitMode = 'equal' | 'shares' | 'percent' | 'exact';

/** 100% = 10000 điểm cơ bản. Dùng số nguyên để không phải đụng tới số thực. */
export const PERCENT_SCALE = 10_000;

export interface SplitLine {
  readonly participantId: string;
  readonly amount: Money;
}

export interface SplitRequest {
  readonly total: Money;
  readonly participantIds: readonly string[];
  readonly mode: SplitMode;
  /** mode 'shares': số phần của mỗi người, số nguyên >= 0. */
  readonly shares?: Readonly<Record<string, number>>;
  /** mode 'percent': điểm cơ bản của mỗi người, tổng phải đúng bằng PERCENT_SCALE. */
  readonly percentBps?: Readonly<Record<string, number>>;
  /** mode 'exact': số tiền cụ thể (đơn vị nhỏ nhất), tổng phải đúng bằng total. */
  readonly exactMinor?: Readonly<Record<string, number>>;
  /**
   * Ai được ưu tiên nhận phần dư khi hoà điểm.
   * Mặc định nên truyền id người ứng tiền vào đây: người bỏ tiền ra nhận phần
   * lẻ là quy ước công bằng và dễ giải thích nhất với người dùng.
   */
  readonly remainderPriority?: readonly string[];
}

export type SplitResult =
  | { readonly ok: true; readonly lines: readonly SplitLine[] }
  | { readonly ok: false; readonly error: string };

function fail(error: string): SplitResult {
  return { ok: false, error };
}

function validateCommon(request: SplitRequest): string | null {
  const { total, participantIds } = request;

  if (participantIds.length === 0) {
    return 'Cần ít nhất một người để chia.';
  }
  if (new Set(participantIds).size !== participantIds.length) {
    return 'Danh sách người tham gia bị trùng.';
  }
  if (!Number.isSafeInteger(total.minor)) {
    return 'Tổng khoản chi không phải số nguyên hợp lệ.';
  }
  if (total.minor <= 0) {
    return 'Tổng khoản chi phải lớn hơn 0.';
  }
  return null;
}

/**
 * Chia `totalMinor` theo trọng số, đảm bảo tổng các phần bằng đúng totalMinor.
 * Trả về mảng cùng thứ tự với `ids`, hoặc chuỗi mô tả lỗi.
 */
function allocateByWeights(
  totalMinor: number,
  ids: readonly string[],
  weightOf: (id: string) => number,
  weightTotal: number,
  remainderPriority: readonly string[],
): number[] | string {
  if (weightTotal <= 0) {
    return 'Tổng trọng số phải lớn hơn 0.';
  }

  let maxWeight = 0;
  for (const id of ids) {
    const w = weightOf(id);
    if (w > maxWeight) maxWeight = w;
  }
  // totalMinor * weight là phép nhân lớn nhất trong thuật toán. Chặn tràn số
  // trước khi nó âm thầm làm sai kết quả.
  if (!Number.isSafeInteger(totalMinor * maxWeight)) {
    return 'Số tiền quá lớn để chia chính xác. Hãy giảm số tiền hoặc số phần.';
  }

  const base: number[] = [];
  const remainder: number[] = [];
  let allocated = 0;

  for (const id of ids) {
    const numerator = totalMinor * weightOf(id);
    const share = Math.floor(numerator / weightTotal);
    base.push(share);
    remainder.push(numerator % weightTotal);
    allocated += share;
  }

  let leftover = totalMinor - allocated;
  if (leftover < 0) {
    return 'Lỗi nội bộ: phân bổ vượt quá tổng khoản chi.';
  }

  // Thứ tự nhận phần dư: phần dư lớn hơn trước; hoà thì theo remainderPriority;
  // hoà tiếp thì theo thứ tự đầu vào. Không có chỗ nào phụ thuộc thứ tự ngẫu nhiên.
  const priorityOf = (id: string): number => {
    const index = remainderPriority.indexOf(id);
    return index === -1 ? Number.MAX_SAFE_INTEGER : index;
  };

  const order = ids.map((_, index) => index).sort((a, b) => {
    if (remainder[b] !== remainder[a]) return remainder[b] - remainder[a];
    const priorityDiff = priorityOf(ids[a]) - priorityOf(ids[b]);
    if (priorityDiff !== 0) return priorityDiff;
    return a - b;
  });

  let cursor = 0;
  while (leftover > 0) {
    base[order[cursor % order.length]] += 1;
    cursor += 1;
    leftover -= 1;
  }

  return base;
}

function toLines(
  ids: readonly string[],
  amounts: readonly number[],
  currency: CurrencyCode,
): SplitLine[] {
  return ids.map((participantId, index) => ({
    participantId,
    amount: money(amounts[index], currency),
  }));
}

export function splitExpense(request: SplitRequest): SplitResult {
  const commonError = validateCommon(request);
  if (commonError) return fail(commonError);

  const { total, participantIds, mode } = request;
  const priority = request.remainderPriority ?? [];

  if (mode === 'equal') {
    const amounts = allocateByWeights(
      total.minor,
      participantIds,
      () => 1,
      participantIds.length,
      priority,
    );
    if (typeof amounts === 'string') return fail(amounts);
    return { ok: true, lines: toLines(participantIds, amounts, total.currency) };
  }

  if (mode === 'shares') {
    const shares = request.shares;
    if (!shares) return fail('Thiếu số phần cho chế độ chia theo phần.');

    let weightTotal = 0;
    for (const id of participantIds) {
      const value = shares[id];
      if (value === undefined) return fail(`Thiếu số phần của "${id}".`);
      if (!Number.isInteger(value) || value < 0) {
        return fail(`Số phần của "${id}" phải là số nguyên không âm.`);
      }
      weightTotal += value;
    }
    if (weightTotal === 0) return fail('Tổng số phần phải lớn hơn 0.');

    const amounts = allocateByWeights(
      total.minor,
      participantIds,
      (id) => shares[id],
      weightTotal,
      priority,
    );
    if (typeof amounts === 'string') return fail(amounts);
    return { ok: true, lines: toLines(participantIds, amounts, total.currency) };
  }

  if (mode === 'percent') {
    const percentBps = request.percentBps;
    if (!percentBps) return fail('Thiếu tỷ lệ phần trăm.');

    let bpsTotal = 0;
    for (const id of participantIds) {
      const value = percentBps[id];
      if (value === undefined) return fail(`Thiếu tỷ lệ của "${id}".`);
      if (!Number.isInteger(value) || value < 0) {
        return fail(`Tỷ lệ của "${id}" phải là số nguyên không âm (đơn vị: phần vạn).`);
      }
      bpsTotal += value;
    }
    if (bpsTotal !== PERCENT_SCALE) {
      const percent = (bpsTotal / 100).toFixed(2).replace(/\.?0+$/, '');
      return fail(`Tổng tỷ lệ đang là ${percent}%, phải đúng 100%.`);
    }

    const amounts = allocateByWeights(
      total.minor,
      participantIds,
      (id) => percentBps[id],
      PERCENT_SCALE,
      priority,
    );
    if (typeof amounts === 'string') return fail(amounts);
    return { ok: true, lines: toLines(participantIds, amounts, total.currency) };
  }

  // mode === 'exact': không chia gì cả, chỉ xác thực bất biến tổng.
  const exactMinor = request.exactMinor;
  if (!exactMinor) return fail('Thiếu số tiền cụ thể của từng người.');

  const amounts: number[] = [];
  let sum = 0;
  for (const id of participantIds) {
    const value = exactMinor[id];
    if (value === undefined) return fail(`Thiếu số tiền của "${id}".`);
    if (!Number.isSafeInteger(value) || value < 0) {
      return fail(`Số tiền của "${id}" phải là số nguyên không âm.`);
    }
    amounts.push(value);
    sum += value;
  }

  if (sum !== total.minor) {
    const difference = money(Math.abs(sum - total.minor), total.currency);
    const direction = sum > total.minor ? 'thừa' : 'thiếu';
    return fail(`Tổng các phần đang ${direction} ${formatMoney(difference)} so với khoản chi.`);
  }

  return { ok: true, lines: toLines(participantIds, amounts, total.currency) };
}

/**
 * Kiểm chứng bất biến tổng. Dùng trong test và ở màn hình để hiển thị dấu ✓.
 * Nếu hàm này trả về false ở production thì có bug trong splitExpense.
 */
export function linesBalanceTotal(total: Money, lines: readonly SplitLine[]): boolean {
  const sum = sumMoney(
    lines.map((line) => line.amount),
    total.currency,
  );
  return sum.minor === total.minor;
}
