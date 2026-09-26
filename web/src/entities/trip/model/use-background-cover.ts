import type { BackgroundCoverState } from '@core/features/place/background-cover';
import { useBackgroundCoverWith } from '@core/features/place/background-cover';

import type { TripSummary } from '../api';
import { saveCoverIfPlaceUnchanged } from '../api';

export type { BackgroundCoverState } from '@core/features/place/background-cover';

/**
 * Tải ảnh bìa ở nền cho bản web. Logic dùng chung với mobile
 * (src/features/place/background-cover.ts); web không có chế độ khách nên lưu
 * thẳng qua tầng remote (RPC set_trip_cover_if_empty).
 */
export function useBackgroundCover(
  trip: TripSummary | null,
  onSaved: () => void,
): BackgroundCoverState {
  return useBackgroundCoverWith(trip, onSaved, saveCoverIfPlaceUnchanged);
}
