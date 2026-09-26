import type { ExpenseEventAction } from '../api';

/** So hai ảnh chụp khoản chi — dùng NGUYÊN bản thuần TS của mobile (có test node --test). */
export type { SnapshotChange } from '@core/lib/expenses/diff-snapshot';
export { diffSnapshots, SPLIT_LABEL } from '@core/lib/expenses/diff-snapshot';

export const ACTION_LABEL: Record<ExpenseEventAction, string> = {
  create: 'đã tạo khoản chi',
  update: 'đã sửa',
  void: 'đã xoá khoản chi',
  settle: 'đã đánh dấu xong',
  unsettle: 'đã bỏ đánh dấu xong',
};

/** Tên người thao tác khi không tra được thành viên (đã rời chuyến / không xác định). */
export const UNKNOWN_ACTOR_NAME = 'Người đã rời chuyến';
