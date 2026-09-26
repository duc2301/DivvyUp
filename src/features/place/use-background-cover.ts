import { useEffect, useRef, useState } from 'react';

import { placeKeyOf, saveCoverIfPlaceUnchanged } from '@/lib/data/manager';
import type { TripSummary } from '@/lib/data/trips';
import { describeError } from '@/lib/data/use-async';

import { loadCoverForPlace } from './load-cover';

/**
 * Địa điểm đã tải xong mà KHÔNG có ảnh nào, trong phiên này. Chỉ nhớ đúng
 * trường hợp đó: gọi lại cũng vô ích, và mỗi lần focus lại gọi API là tốn hạn
 * mức. Tải thành công hay lỗi thì không nhớ — chọn lại nơi cũ (A → B → A) vẫn
 * phải tải ảnh cho A, và lỗi mạng thì được thử lại.
 */
const noPhotos = new Set<string>();

function coverKey(trip: TripSummary): string | null {
  return trip.place ? `${trip.id}|${placeKeyOf(trip.place)}` : null;
}

export interface BackgroundCoverState {
  readonly loading: boolean;
  readonly error: string | null;
  /** Thử lại sau khi lỗi (mạng chập chờn) mà không cần rời màn. */
  readonly retry: () => void;
}

/**
 * Chuyến đi có địa điểm mà chưa có ảnh bìa (vừa đổi địa điểm ở màn chọn) →
 * tải bộ ảnh ở nền và lưu lại, người dùng lướt ngay trên ảnh bìa.
 *
 * Lưu bằng so-rồi-ghi PHÍA MÁY CHỦ (RPC set_trip_cover_if_empty): chỉ ghi khi
 * địa điểm vẫn là nơi vừa tìm ảnh và bộ ảnh vẫn rỗng. So ở client không đủ —
 * trong lúc chờ 30 ảnh, người dùng (hoặc bạn đồng hành trên máy khác) có thể đã
 * đổi sang nơi khác, và ghi đè sẽ đưa chuyến đi quay về địa điểm cũ.
 */
export function useBackgroundCover(
  trip: TripSummary | null,
  onSaved: () => void,
): BackgroundCoverState {
  const [state, setState] = useState<{ loading: boolean; error: string | null }>({
    loading: false,
    error: null,
  });
  const [attempt, setAttempt] = useState(0);
  const latest = useRef(trip);
  // Giữ hàm gọi lại mới nhất mà không đưa nó vào deps: lượt tải đang chờ không
  // được huỷ chỉ vì màn cha truyền một hàm mới.
  const saved = useRef(onSaved);
  useEffect(() => {
    latest.current = trip;
    saved.current = onSaved;
  }, [trip, onSaved]);

  const key = trip ? coverKey(trip) : null;
  const needsCover = trip !== null && trip.place !== null && trip.cover.images.length === 0;

  useEffect(() => {
    if (!needsCover || key === null || noPhotos.has(key)) {
      // Lượt trước (nơi khác) có thể đã bị huỷ giữa chừng — đừng để cờ "đang tìm"
      // hay lỗi cũ của nơi đó treo lại cho nơi hiện tại.
      setState({ loading: false, error: null });
      return;
    }
    const target = latest.current;
    if (!target?.place) return;
    const place = target.place;

    let active = true;
    setState({ loading: true, error: null });
    loadCoverForPlace(place)
      .then(async (cover) => {
        if (cover.images.length === 0) {
          noPhotos.add(key);
          return;
        }
        // Trả false khi địa điểm đã đổi hoặc đã có ảnh — bỏ kết quả cũ. Cả hai
        // trường hợp đều tải lại màn để thấy trạng thái mới nhất.
        await saveCoverIfPlaceUnchanged(target.id, placeKeyOf(place), cover);
        saved.current();
      })
      .then(() => {
        if (active) setState({ loading: false, error: null });
      })
      .catch((caught: unknown) => {
        if (active) setState({ loading: false, error: describeError(caught) });
      });

    return () => {
      active = false;
    };
  }, [key, needsCover, attempt]);

  // Ảnh đã về (màn cha tải lại) thì effect bị huỷ trước khi kịp tắt cờ — suy ra
  // từ dữ liệu thay vì tin cờ.
  return {
    loading: state.loading && needsCover,
    error: needsCover ? state.error : null,
    retry: () => setAttempt((value) => value + 1),
  };
}
