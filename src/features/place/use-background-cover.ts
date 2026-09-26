import { saveCoverIfPlaceUnchanged } from '@/lib/data/manager';
import type { TripSummary } from '@/lib/data/trips';

import type { BackgroundCoverState } from './background-cover';
import { useBackgroundCoverWith } from './background-cover';

export type { BackgroundCoverState } from './background-cover';

/**
 * Tải ảnh bìa ở nền cho app mobile. Logic nằm ở background-cover.ts (dùng chung
 * với web); ở đây chỉ chọn hàm lưu đi qua manager.ts để chế độ khách cũng chạy.
 */
export function useBackgroundCover(
  trip: TripSummary | null,
  onSaved: () => void,
): BackgroundCoverState {
  return useBackgroundCoverWith(trip, onSaved, saveCoverIfPlaceUnchanged);
}
