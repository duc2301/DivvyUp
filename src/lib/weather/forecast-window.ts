/**
 * Chuyến đi nào đang xem được dự báo, và cho những ngày nào.
 *
 * Dự báo chỉ đáng tin trong khoảng một tuần tới, nên app mở dự báo từ
 * FORECAST_WINDOW_DAYS ngày trước ngày khởi hành. Mọi ngày viết dạng
 * `YYYY-MM-DD` theo giờ ĐỊA PHƯƠNG của điểm đến (Open-Meteo trả theo múi giờ
 * đó) — so sánh chuỗi là đủ, không cần Date, và không lệch ngày vì múi giờ máy.
 *
 * Hàm thuần, kiểm thử bằng `node --test`.
 */

export const FORECAST_WINDOW_DAYS = 7;

export type ForecastPlan =
  /** Chuyến đi đã kết thúc — không cần dự báo nữa. */
  | { readonly kind: 'ended' }
  /** Còn quá xa, chưa có dự báo. `availableFrom` là ngày bắt đầu xem được. */
  | { readonly kind: 'tooEarly'; readonly availableFrom: string }
  /**
   * Xem được. `days` là các ngày của chuyến nằm trong cửa sổ dự báo, theo thứ
   * tự; phần tử đầu là ngày nên tóm tắt (hôm nay nếu đang đi, không thì ngày
   * khởi hành).
   */
  | { readonly kind: 'available'; readonly days: readonly string[] };

const DAY_MS = 86_400_000;

function toUtcMs(date: string): number {
  const [year, month, day] = date.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

export function addDays(date: string, days: number): string {
  return new Date(toUtcMs(date) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Danh sách ngày từ `from` tới `to`, tính cả hai đầu. */
export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) out.push(day);
  return out;
}

export function planTripForecast(input: {
  readonly startDate: string | null;
  readonly endDate: string | null;
  /** Hôm nay theo giờ địa phương của điểm đến. */
  readonly today: string;
  readonly windowDays?: number;
}): ForecastPlan {
  const windowDays = input.windowDays ?? FORECAST_WINDOW_DAYS;
  const lastForecastDay = addDays(input.today, windowDays);

  // Chuyến chưa đặt ngày: dự báo thời tiết của điểm đến từ hôm nay.
  const start = input.startDate ?? input.endDate ?? input.today;
  const end = input.endDate ?? input.startDate ?? lastForecastDay;

  if (end < input.today) return { kind: 'ended' };
  if (start > lastForecastDay) {
    return { kind: 'tooEarly', availableFrom: addDays(start, -windowDays) };
  }

  const from = start > input.today ? start : input.today;
  const to = end < lastForecastDay ? end : lastForecastDay;
  return { kind: 'available', days: dateRange(from, to) };
}

const WEEKDAYS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
const WEEKDAYS_LONG = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];

/** "20/9" */
export function shortDate(date: string): string {
  const [, month, day] = date.split('-').map(Number);
  return `${day}/${month}`;
}

/** "Hôm nay", "Ngày mai", hoặc "Thứ 7". */
export function dayName(date: string, today: string, long = true): string {
  if (date === today) return 'Hôm nay';
  if (date === addDays(today, 1)) return 'Ngày mai';
  const weekday = new Date(toUtcMs(date)).getUTCDay();
  return (long ? WEEKDAYS_LONG : WEEKDAYS)[weekday];
}
