/**
 * So hai ảnh chụp của cùng một khoản chi → danh sách thay đổi dễ đọc. Thuần
 * TypeScript (không React Native) để test được bằng node --test và để bản web
 * dùng lại.
 */

import type { ExpenseSnapshot } from '../data/expenses.ts';
import { formatDateTime } from '../datetime.ts';
import { formatMoney } from '../money/index.ts';
import type { SplitModeDb } from '../supabase/database.types.ts';

export const SPLIT_LABEL: Record<SplitModeDb, string> = {
  equal: 'Chia đều',
  exact: 'Tính riêng từng người',
};

export interface SnapshotChange {
  readonly label: string;
  readonly before: string;
  readonly after: string;
}

/**
 * So hai ảnh chụp khoản chi, trả về từng dòng thay đổi dễ đọc. Phần chia so
 * theo từng người: thêm người, bỏ người, đổi số tiền.
 */
export function diffSnapshots(
  before: ExpenseSnapshot,
  after: ExpenseSnapshot,
  nameOf: (memberId: string) => string,
): SnapshotChange[] {
  const changes: SnapshotChange[] = [];
  if (before.description !== after.description) {
    changes.push({ label: 'Nội dung', before: before.description, after: after.description });
  }
  if (before.total.minor !== after.total.minor) {
    changes.push({
      label: 'Tổng tiền',
      before: formatMoney(before.total),
      after: formatMoney(after.total),
    });
  }
  if (before.paidByMemberId !== after.paidByMemberId) {
    changes.push({
      label: 'Người trả',
      before: nameOf(before.paidByMemberId),
      after: nameOf(after.paidByMemberId),
    });
  }
  if (before.paidAt !== after.paidAt) {
    changes.push({
      label: 'Thời điểm',
      before: formatDateTime(new Date(before.paidAt)),
      after: formatDateTime(new Date(after.paidAt)),
    });
  }
  if (before.splitMode !== after.splitMode) {
    changes.push({
      label: 'Cách chia',
      before: SPLIT_LABEL[before.splitMode],
      after: SPLIT_LABEL[after.splitMode],
    });
  }

  const beforeShares = new Map(before.shares.map((share) => [share.participantId, share.amount]));
  const afterShares = new Map(after.shares.map((share) => [share.participantId, share.amount]));
  const ids = [...new Set([...beforeShares.keys(), ...afterShares.keys()])];
  for (const id of ids) {
    const was = beforeShares.get(id);
    const now = afterShares.get(id);
    if (was?.minor === now?.minor) continue;
    changes.push({
      label: `Phần của ${nameOf(id)}`,
      before: was ? formatMoney(was) : 'không chịu',
      after: now ? formatMoney(now) : 'không chịu',
    });
  }
  return changes;
}
