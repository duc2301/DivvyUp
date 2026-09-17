import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import type { TripSummary } from '@/lib/data/trips';
import { describeError } from '@/lib/data/use-async';
import type { Forecast } from '@/lib/data/weather';
import { atLocalTime, getForecast, isStale, subscribeForecast } from '@/lib/data/weather';
import { toIsoDate } from '@/lib/datetime';
import type { ForecastPlan } from '@/lib/weather/forecast-window';
import { planTripForecast } from '@/lib/weather/forecast-window';

/**
 * Nhịp tính lại "bây giờ" khi màn đang mở: qua nửa đêm thì "Hôm nay" đổi ngày,
 * qua giờ thì hàng theo giờ bỏ giờ vừa qua, dự báo quá 3 tiếng thì tải lại.
 */
const TICK_MS = 5 * 60 * 1000;

export interface TripForecastState {
  /** null khi chuyến chưa có địa điểm kèm toạ độ — không có gì để dự báo. */
  readonly plan: ForecastPlan | null;
  /** Đã quy về giờ địa phương hiện tại của điểm đến (xem atLocalTime). */
  readonly forecast: Forecast | null;
  /** Đang tải lần đầu (chưa có dữ liệu nào để hiện). */
  readonly loading: boolean;
  /** Đang tải lại (bấm làm mới hoặc bấm thử lại). */
  readonly refreshing: boolean;
  readonly error: string | null;
  /** Bỏ qua bộ nhớ đệm, tải lại ngay. */
  readonly refresh: () => void;
}

/**
 * Dự báo cho điểm đến của một chuyến đi, kèm "kế hoạch" ngày nào xem được.
 *
 * Không gọi mạng khi chuyến đã kết thúc hoặc còn quá xa (tính theo ngày của
 * máy — lệch múi giờ tối đa một ngày, chấp nhận được cho quyết định này). Khi
 * đã có dữ liệu, kế hoạch tính theo "hôm nay" ở chính điểm đến.
 */
export function useTripForecast(trip: TripSummary | null): TripForecastState {
  const latitude = trip?.place?.latitude ?? null;
  const longitude = trip?.place?.longitude ?? null;
  const startDate = trip?.startDate ?? null;
  const endDate = trip?.endDate ?? null;
  const hasCoordinates = latitude !== null && longitude !== null;

  const [raw, setRaw] = useState<Forecast | null>(null);
  const [inProgress, setInProgress] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // `nowMs` là STATE chứ không gọi Date.now() thẳng trong render: React Compiler
  // có thể nhớ kết quả một phép tính không phụ thuộc giá trị reactive nào, và
  // "hôm nay" sẽ đứng yên mãi. Nhịp đồng hồ làm nó thành giá trị reactive.
  const [nowMs, setNowMs] = useState(() => Date.now());
  const requestId = useRef(0);

  const devicePlan = hasCoordinates
    ? planTripForecast({ startDate, endDate, today: toIsoDate(new Date(nowMs)) })
    : null;
  const shouldFetch = devicePlan?.kind === 'available';

  const load = useCallback(
    async (force: boolean): Promise<void> => {
      if (latitude === null || longitude === null) return;
      // Chỉ kết quả của lượt gọi MỚI NHẤT được ghi vào state: đổi địa điểm rồi
      // quay lại nhanh thì dự báo chỗ cũ về sau không đè lên chỗ mới.
      requestId.current += 1;
      const id = requestId.current;
      setInProgress(true);
      setError(null);
      try {
        const next = await getForecast(latitude, longitude, { force });
        if (id === requestId.current) setRaw(next);
      } catch (caught) {
        if (id === requestId.current) setError(describeError(caught));
      } finally {
        if (id === requestId.current) setInProgress(false);
      }
    },
    [latitude, longitude],
  );

  useEffect(() => {
    setRaw(null);
    setError(null);
    if (shouldFetch) void load(false);
  }, [shouldFetch, load]);

  // Màn khác (vd màn chi tiết bấm "Làm mới") tải xong thì màn này cũng thấy ngay.
  useEffect(() => {
    if (latitude === null || longitude === null) return;
    return subscribeForecast(latitude, longitude, setRaw);
  }, [latitude, longitude]);

  // Nhịp đồng hồ + quay lại từ nền: timer JS dừng khi app ở nền, nên phải bắt
  // sự kiện app hoạt động trở lại chứ không trông vào mỗi setInterval.
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), TICK_MS);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') setNowMs(Date.now());
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      setNowMs(Date.now());
    }, []),
  );

  // Mỗi khi đồng hồ nhích: dự báo đã cũ thì tải lại (dùng chung bộ nhớ nên
  // nhiều màn cùng phát hiện cũ cũng chỉ thành một lượt gọi mạng).
  useEffect(() => {
    if (shouldFetch && raw && isStale(raw, nowMs)) void load(false);
  }, [nowMs, shouldFetch, raw, load]);

  const forecast = raw ? atLocalTime(raw, nowMs) : null;

  const plan =
    devicePlan === null
      ? null
      : forecast
        ? planTripForecast({ startDate, endDate, today: forecast.today })
        : devicePlan;

  return {
    plan,
    forecast,
    // Suy từ dữ liệu, không chỉ từ cờ: ở lần vẽ đầu tiên effect chưa kịp bật cờ
    // tải, và màn hình loé "Chưa tải được" dù chưa có lỗi nào.
    loading: forecast === null && ((shouldFetch && error === null) || inProgress),
    refreshing: forecast !== null && inProgress,
    error,
    refresh: () => {
      if (!inProgress) void load(true);
    },
  };
}
