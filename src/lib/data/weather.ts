/**
 * Dự báo thời tiết cho điểm đến của chuyến đi — nguồn Open-Meteo.
 *
 * Vì sao Open-Meteo: miễn phí, KHÔNG cần khoá API (nên gọi thẳng từ app, không
 * phải qua Edge Function như Mapbox), có dự báo theo giờ, theo ngày và chỉ số
 * chất lượng không khí. Điều kiện dùng: ghi nguồn (CC BY 4.0) và dưới 10.000
 * lượt gọi/ngày cho mục đích phi thương mại — màn chi tiết có dòng ghi nguồn,
 * còn bộ nhớ đệm bên dưới giữ số lượt gọi rất thấp.
 *
 * Bộ nhớ đệm: mỗi toạ độ lưu trong AsyncStorage CACHE_TTL_MS. Mở lại màn trong
 * khoảng đó không gọi mạng; hết hạn thì tự tải lại; bấm "Làm mới" thì tải ngay.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { DataError } from '@/lib/supabase/errors';

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const AIR_QUALITY_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality';

/** Dữ liệu mô hình dự báo chỉ cập nhật vài giờ một lần — tải dày hơn là phí. */
export const CACHE_TTL_MS = 3 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 20_000;
/** Hôm nay + 7 ngày: đủ cho cửa sổ dự báo một tuần trước chuyến đi. */
const FORECAST_DAYS = 8;
const AQI_FORECAST_DAYS = 5;
// v2: thêm utcOffsetSeconds — bản lưu v1 thiếu trường này nên bỏ qua.
const CACHE_PREFIX = 'divvyup_weather_v2_';
/** Quá chừng này thì số liệu "hiện tại" không còn đáng gọi là hiện tại. */
const CURRENT_MAX_AGE_MS = 90 * 60 * 1000;

export interface CurrentWeather {
  /** Giờ địa phương của điểm đến, `YYYY-MM-DDTHH:mm`. */
  readonly time: string;
  readonly temperature: number;
  readonly apparentTemperature: number;
  readonly humidity: number;
  readonly code: number;
  readonly isDay: boolean;
  readonly windSpeed: number;
}

export interface DailyWeather {
  /** `YYYY-MM-DD` theo giờ địa phương. */
  readonly date: string;
  readonly code: number;
  readonly max: number;
  readonly min: number;
  /** % khả năng mưa cao nhất trong ngày; null nếu mô hình không có. */
  readonly rainChance: number | null;
  readonly uvMax: number | null;
  readonly windMax: number | null;
  /** `HH:mm` */
  readonly sunrise: string | null;
  readonly sunset: string | null;
}

export interface HourlyWeather {
  readonly time: string;
  readonly temperature: number;
  readonly code: number;
  readonly rainChance: number | null;
  readonly isDay: boolean;
}

export interface HourlyAqi {
  readonly time: string;
  readonly usAqi: number;
}

export interface Forecast {
  readonly timezone: string;
  /** Lệch giờ của điểm đến so với UTC — để tính "bây giờ" ở đó bất cứ lúc nào. */
  readonly utcOffsetSeconds: number;
  /**
   * Hôm nay theo giờ địa phương của điểm đến. Bản trả về từ getForecast là lúc
   * TẢI; màn hình phải dùng atLocalTime() để có giá trị đúng lúc hiện.
   */
  readonly today: string;
  /** Giờ tròn hiện tại ở điểm đến, `YYYY-MM-DDTHH:00`. */
  readonly nowHour: string;
  /** Giờ phút hiện tại ở điểm đến, `YYYY-MM-DDTHH:mm` — vd để đặt vị trí mặt trời. */
  readonly nowTime: string;
  /** Mốc tải về (ms), để hiện "cập nhật lúc…" và biết khi nào hết hạn. */
  readonly fetchedAt: number;
  readonly current: CurrentWeather | null;
  readonly daily: readonly DailyWeather[];
  readonly hourly: readonly HourlyWeather[];
  /** Có thể rỗng: dịch vụ AQI lỗi không được làm hỏng cả dự báo. */
  readonly aqi: readonly HourlyAqi[];
}

// ---------------------------------------------------------------------------
// Kiểu phản hồi thô — chỉ khai những trường app đọc.
// ---------------------------------------------------------------------------

interface ForecastResponse {
  readonly timezone: string;
  readonly utc_offset_seconds: number;
  readonly current?: {
    readonly time: string;
    readonly temperature_2m: number;
    readonly apparent_temperature: number;
    readonly relative_humidity_2m: number;
    readonly weather_code: number;
    readonly is_day: number;
    readonly wind_speed_10m: number;
  };
  readonly daily: {
    readonly time: string[];
    readonly weather_code: number[];
    readonly temperature_2m_max: number[];
    readonly temperature_2m_min: number[];
    readonly precipitation_probability_max: (number | null)[];
    readonly uv_index_max: (number | null)[];
    readonly wind_speed_10m_max: (number | null)[];
    readonly sunrise: (string | null)[];
    readonly sunset: (string | null)[];
  };
  readonly hourly: {
    readonly time: string[];
    readonly temperature_2m: (number | null)[];
    readonly weather_code: (number | null)[];
    readonly precipitation_probability: (number | null)[];
    readonly is_day: (number | null)[];
  };
}

interface AirQualityResponse {
  readonly hourly?: { readonly time: string[]; readonly us_aqi: (number | null)[] };
}

/** Mạng di động chập chờn: thử lại MỘT lần trước khi báo lỗi cho người dùng. */
async function getJson<T>(url: string): Promise<T> {
  try {
    return await getJsonOnce<T>(url);
  } catch (caught) {
    // Lỗi 4xx là do request sai, thử lại vô ích.
    if (caught instanceof DataError && /lỗi 4\d\d/.test(caught.message)) throw caught;
    return getJsonOnce<T>(url);
  }
}

async function getJsonOnce<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new DataError(`Dịch vụ thời tiết trả lỗi ${response.status}.`);
    }
    return (await response.json()) as T;
  } catch (caught) {
    if (caught instanceof DataError) throw caught;
    throw new DataError('Không tải được dự báo thời tiết. Kiểm tra mạng rồi thử lại.');
  } finally {
    clearTimeout(timer);
  }
}

function query(params: Record<string, string | number>): string {
  return Object.entries(params)
    .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`)
    .join('&');
}

const timeOf = (iso: string | null): string | null => (iso ? iso.slice(11, 16) : null);

async function download(latitude: number, longitude: number): Promise<Forecast> {
  const common = { latitude, longitude, timezone: 'auto', forecast_days: FORECAST_DAYS };

  const forecastUrl = `${FORECAST_URL}?${query({
    ...common,
    current:
      'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,is_day,wind_speed_10m',
    hourly: 'temperature_2m,weather_code,precipitation_probability,is_day',
    daily:
      'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,uv_index_max,wind_speed_10m_max,sunrise,sunset',
  })}`;
  // API chất lượng không khí chỉ dự báo ngắn hơn (từ chối forecast_days=8), nên
  // gọi riêng số ngày nhỏ hơn. Những ngày sau đó chỉ đơn giản là không có AQI.
  const aqiUrl = `${AIR_QUALITY_URL}?${query({ ...common, forecast_days: AQI_FORECAST_DAYS, hourly: 'us_aqi' })}`;

  const [forecast, air] = await Promise.all([
    getJson<ForecastResponse>(forecastUrl),
    getJson<AirQualityResponse>(aqiUrl).catch(() => null),
  ]);

  // Bỏ ngày thiếu nhiệt độ: Math.round(null) ra 0, hiện "0°" là sai im lặng.
  const daily: DailyWeather[] = [];
  forecast.daily.time.forEach((date, index) => {
    const max = forecast.daily.temperature_2m_max[index] as number | null;
    const min = forecast.daily.temperature_2m_min[index] as number | null;
    const code = forecast.daily.weather_code[index] as number | null;
    if (max === null || min === null || code === null) return;
    daily.push({
      date,
      code,
      max,
      min,
      rainChance: forecast.daily.precipitation_probability_max[index] ?? null,
      uvMax: forecast.daily.uv_index_max[index] ?? null,
      windMax: forecast.daily.wind_speed_10m_max[index] ?? null,
      sunrise: timeOf(forecast.daily.sunrise[index] ?? null),
      sunset: timeOf(forecast.daily.sunset[index] ?? null),
    });
  });

  // Bỏ các giờ thiếu nhiệt độ hoặc mã thời tiết (cuối chuỗi dự báo hay có null)
  // thay vì hiện "null°".
  const hourly: HourlyWeather[] = [];
  forecast.hourly.time.forEach((time, index) => {
    const temperature = forecast.hourly.temperature_2m[index];
    const code = forecast.hourly.weather_code[index];
    if (temperature === null || code === null) return;
    hourly.push({
      time,
      temperature,
      code,
      rainChance: forecast.hourly.precipitation_probability[index] ?? null,
      isDay: forecast.hourly.is_day[index] === 1,
    });
  });

  const aqi: HourlyAqi[] = [];
  air?.hourly?.time.forEach((time, index) => {
    const value = air.hourly?.us_aqi[index];
    if (typeof value === 'number') aqi.push({ time, usAqi: value });
  });

  const current = forecast.current
    ? {
        time: forecast.current.time,
        temperature: forecast.current.temperature_2m,
        apparentTemperature: forecast.current.apparent_temperature,
        humidity: forecast.current.relative_humidity_2m,
        code: forecast.current.weather_code,
        isDay: forecast.current.is_day === 1,
        windSpeed: forecast.current.wind_speed_10m,
      }
    : null;

  const today = current?.time.slice(0, 10) ?? daily[0]?.date;
  if (!today || daily.length === 0) {
    throw new DataError('Dịch vụ thời tiết không có dữ liệu cho địa điểm này.');
  }

  return {
    timezone: forecast.timezone,
    utcOffsetSeconds: forecast.utc_offset_seconds,
    today,
    nowHour: `${(current?.time ?? `${today}T00:00`).slice(0, 13)}:00`,
    nowTime: (current?.time ?? `${today}T00:00`).slice(0, 16),
    fetchedAt: Date.now(),
    current,
    daily,
    hourly,
    aqi,
  };
}

/**
 * Toạ độ làm tròn 2 chữ số (~1km): hai chuyến cùng thành phố dùng chung một bản
 * lưu, và toạ độ lệch vài mét không thành một lượt gọi mạng mới.
 */
function cacheKey(latitude: number, longitude: number): string {
  return `${CACHE_PREFIX}${latitude.toFixed(2)}_${longitude.toFixed(2)}`;
}

export function isStale(forecast: Forecast, now = Date.now()): boolean {
  return now - forecast.fetchedAt > CACHE_TTL_MS;
}

/**
 * Dự báo "nhìn tại thời điểm `nowMs`": tính lại hôm nay và giờ hiện tại ở điểm
 * đến, bỏ số liệu "hiện tại" đã cũ.
 *
 * Bộ nhớ đệm giữ dự báo tới 3 tiếng (lâu hơn nếu app ngủ nền). Dùng thẳng giá trị
 * lúc tải thì qua nửa đêm vẫn ghi "Hôm nay" cho ngày hôm qua, và hàng theo giờ
 * bắt đầu bằng "Bây giờ" của hai tiếng trước.
 */
export function atLocalTime(forecast: Forecast, nowMs = Date.now()): Forecast {
  const local = new Date(nowMs + forecast.utcOffsetSeconds * 1000).toISOString();
  const today = local.slice(0, 10);
  const nowHour = `${local.slice(0, 13)}:00`;
  const nowTime = local.slice(0, 16);
  const currentFresh =
    forecast.current !== null &&
    forecast.current.time.slice(0, 10) === today &&
    nowMs - forecast.fetchedAt <= CURRENT_MAX_AGE_MS;
  return { ...forecast, today, nowHour, nowTime, current: currentFresh ? forecast.current : null };
}

// ---------------------------------------------------------------------------
// Bộ nhớ dùng chung giữa các màn
//
// Màn chuyến đi và màn thời tiết chi tiết cùng mở một dự báo. Không dùng chung:
// bấm "Làm mới" ở màn chi tiết thì màn chuyến đi (vẫn nằm trong stack) giữ bản
// cũ tới 3 tiếng, hai màn hiện hai dự báo khác nhau; và hai màn cùng tải một lúc
// thành hai lượt gọi mạng.
// ---------------------------------------------------------------------------

const memory = new Map<string, Forecast>();
const inflight = new Map<string, Promise<Forecast>>();
const listeners = new Map<string, Set<(forecast: Forecast) => void>>();

/** Nhận dự báo mới mỗi khi bất kỳ màn nào tải xong cho toạ độ này. */
export function subscribeForecast(
  latitude: number,
  longitude: number,
  listener: (forecast: Forecast) => void,
): () => void {
  const key = cacheKey(latitude, longitude);
  const set = listeners.get(key) ?? new Set();
  set.add(listener);
  listeners.set(key, set);
  return () => {
    set.delete(listener);
  };
}

export async function getForecast(
  latitude: number,
  longitude: number,
  options: { readonly force?: boolean } = {},
): Promise<Forecast> {
  const key = cacheKey(latitude, longitude);

  // Đang có lượt tải cho toạ độ này (kể cả khi bấm làm mới): dùng chung kết quả.
  const running = inflight.get(key);
  if (running) return running;

  if (!options.force) {
    const inMemory = memory.get(key);
    if (inMemory && !isStale(inMemory)) return inMemory;
    try {
      const raw = await AsyncStorage.getItem(key);
      if (raw) {
        const cached = JSON.parse(raw) as Forecast;
        if (Array.isArray(cached.daily) && !isStale(cached)) {
          memory.set(key, cached);
          return cached;
        }
      }
    } catch {
      // Bản lưu hỏng thì tải lại, không báo lỗi.
    }
  }

  const task = (async () => {
    const fresh = await download(latitude, longitude);
    memory.set(key, fresh);
    await AsyncStorage.setItem(key, JSON.stringify(fresh)).catch(() => undefined);
    listeners.get(key)?.forEach((listener) => listener(fresh));
    return fresh;
  })();
  inflight.set(key, task);
  try {
    return await task;
  } finally {
    inflight.delete(key);
  }
}
