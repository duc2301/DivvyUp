import { useEffect, useRef, useState } from 'react';

import { describeError } from '@/shared/lib/async';

import type { TripSummary } from '../api';
import { loadCoverForPlace, placeKeyOf, saveCoverIfPlaceUnchanged } from '../api';

/**
 * Địa điểm đã tải xong mà KHÔNG có ảnh nào, trong phiên này — gọi lại cũng vô
 * ích mà tốn hạn mức. Thành công hay lỗi thì không nhớ (A → B → A vẫn tải lại A,
 * lỗi mạng thì được thử lại).
 */
const noPhotos = new Set<string>();

function coverKey(trip: TripSummary): string | null {
  return trip.place ? `${trip.id}|${placeKeyOf(trip.place)}` : null;
}

export interface BackgroundCoverState {
  readonly loading: boolean;
  readonly error: string | null;
  /** Thử lại sau khi lỗi mà không cần rời màn. */
  readonly retry: () => void;
}

/**
 * Chuyến có địa điểm mà chưa có ảnh bìa → tải bộ ảnh ở nền và lưu. Bản port
 * của src/features/place/use-background-cover.ts: lưu bằng so-rồi-ghi PHÍA MÁY
 * CHỦ (RPC set_trip_cover_if_empty qua saveCoverIfPlaceUnchanged) — chỉ ghi khi
 * địa điểm vẫn là nơi vừa tìm ảnh và bộ ảnh vẫn rỗng, để không đưa chuyến quay
 * về địa điểm cũ khi ai đó vừa đổi nơi trên máy khác.
 */
export function useBackgroundCover(trip: TripSummary | null, onSaved: () => void): BackgroundCoverState {
  const [state, setState] = useState<{ loading: boolean; error: string | null }>({ loading: false, error: null });
  const [attempt, setAttempt] = useState(0);
  const latest = useRef(trip);
  const saved = useRef(onSaved);
  useEffect(() => {
    latest.current = trip;
    saved.current = onSaved;
  }, [trip, onSaved]);

  const key = trip ? coverKey(trip) : null;
  const needsCover = trip !== null && trip.place !== null && trip.cover.images.length === 0;

  useEffect(() => {
    if (!needsCover || key === null || noPhotos.has(key)) {
      // Lượt trước (nơi khác) có thể đã bị huỷ giữa chừng — đừng để cờ "đang
      // tìm" hay lỗi cũ của nơi đó treo lại cho nơi hiện tại.
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
        // false = địa điểm đã đổi / đã có ảnh — bỏ kết quả cũ; vẫn tải lại màn.
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

  return {
    loading: state.loading && needsCover,
    error: needsCover ? state.error : null,
    retry: () => setAttempt((value) => value + 1),
  };
}
