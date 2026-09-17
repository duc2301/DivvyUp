import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { IconButton } from '@/components/ui/icon-button';
import type { LucideIcon } from '@/components/ui/icons';
import {
  ChevronLeft,
  Clock,
  CloudRain,
  Droplets,
  Leaf,
  RefreshCw,
  Sun,
  Sunrise,
  Sunset,
  Thermometer,
  Wind,
} from '@/components/ui/icons';
import { Screen } from '@/components/ui/screen';
import { EmptyView, ErrorView } from '@/components/ui/state-views';
import { WeatherIcon } from '@/components/weather/weather-icon';
import { useTripForecast } from '@/features/weather/use-trip-forecast';
import { getTrip } from '@/lib/data/manager';
import { currentCover } from '@/lib/data/trips';
import { useAsync } from '@/lib/data/use-async';
import type { DailyWeather, Forecast, HourlyWeather } from '@/lib/data/weather';
import { dayName, shortDate } from '@/lib/weather/forecast-window';
import type { WeatherKind } from '@/lib/weather/weather-codes';
import { describeAqi, describeWeather } from '@/lib/weather/weather-codes';

// ---------------------------------------------------------------------------
// Tiện ích
// ---------------------------------------------------------------------------

function formatClock(ms: number): string {
  const date = new Date(ms);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function minutesOf(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

/** Sắc nền của thẻ chính khi chuyến đi CHƯA có ảnh bìa. */
function heroTint(kind: WeatherKind): string {
  switch (kind) {
    case 'clear':
    case 'partly':
      return 'bg-sun/15';
    case 'drizzle':
    case 'rain':
    case 'showers':
    case 'thunder':
      return 'bg-rain/10';
    default:
      return 'bg-muted/60';
  }
}

function uvLabel(uv: number): string {
  if (uv < 3) return 'Thấp';
  if (uv < 6) return 'Trung bình';
  if (uv < 8) return 'Cao';
  if (uv < 11) return 'Rất cao';
  return 'Cực cao';
}

function hoursOf(forecast: Forecast, date: string): HourlyWeather[] {
  const hours = forecast.hourly.filter((hour) => hour.time.startsWith(date));
  // Hôm nay: bắt đầu từ giờ hiện tại ở điểm đến, bỏ các giờ đã qua.
  return date === forecast.today ? hours.filter((hour) => hour.time >= forecast.nowHour) : hours;
}

function aqiOf(forecast: Forecast, date: string): number | null {
  if (date === forecast.today) {
    const now = forecast.aqi.find((item) => item.time === forecast.nowHour);
    if (now) return now.usAqi;
  }
  const values = forecast.aqi
    .filter((item) => item.time.startsWith(date))
    .map((item) => item.usAqi);
  return values.length === 0 ? null : Math.max(...values);
}

// ---------------------------------------------------------------------------
// Khung chung
// ---------------------------------------------------------------------------

type Tone = 'primary' | 'sun' | 'rain' | 'positive';

const TONE_BADGE: Record<Tone, string> = {
  primary: 'bg-primary/10',
  sun: 'bg-sun/15',
  rain: 'bg-rain/10',
  positive: 'bg-positive/10',
};

const TONE_ICON: Record<Tone, string> = {
  primary: 'text-primary',
  sun: 'text-sun',
  rain: 'text-rain',
  positive: 'text-positive',
};

/** Thẻ một phần: đầu thẻ có icon trong vòng tròn màu, cho mỗi phần một "gương mặt" riêng. */
function WeatherSection({
  icon: Icon,
  tone,
  title,
  subtitle,
  children,
}: {
  icon: LucideIcon;
  tone: Tone;
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <View className="rounded-3xl bg-card p-4 shadow-sm">
      <View className="mb-4 flex-row items-center gap-3">
        <View className={`h-9 w-9 items-center justify-center rounded-full ${TONE_BADGE[tone]}`}>
          <Icon size={18} className={TONE_ICON[tone]} />
        </View>
        <View className="min-w-0 flex-1">
          <Text className="text-base font-semibold text-foreground">{title}</Text>
          {subtitle ? <Text className="text-xs text-muted-foreground">{subtitle}</Text> : null}
        </View>
      </View>
      {children}
    </View>
  );
}

/**
 * Thang màu nhiều mức có vạch đánh dấu — dùng cho UV và chất lượng không khí.
 * Các màu đều là token: xanh (tốt) → vàng → đỏ (xấu).
 */
function LevelGauge({
  value,
  max,
  segments,
}: {
  value: number;
  max: number;
  segments: readonly { readonly until: number; readonly className: string }[];
}) {
  const position = Math.min(Math.max(value / max, 0), 1) * 100;
  let previous = 0;
  return (
    <View className="mt-3">
      <View className="h-2.5 flex-row overflow-hidden rounded-full">
        {segments.map((segment) => {
          const width = ((Math.min(segment.until, max) - previous) / max) * 100;
          previous = Math.min(segment.until, max);
          return (
            <View
              key={segment.until}
              style={{ width: `${width}%` }}
              className={segment.className}
            />
          );
        })}
      </View>
      <View
        style={{ left: `${position}%` }}
        className="absolute -top-1 -ml-1.5 h-[18px] w-3 rounded-full border-2 border-card bg-foreground"
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Thẻ chính
// ---------------------------------------------------------------------------

function HeroStat({
  icon: Icon,
  label,
  value,
  onImage,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  onImage: boolean;
}) {
  return (
    <View
      accessible
      accessibilityLabel={`${label} ${value}`}
      className={`min-w-0 flex-1 items-center rounded-2xl px-1 py-3 ${
        onImage ? 'bg-white/15' : 'bg-background/60'
      }`}>
      <Icon size={20} className={onImage ? 'text-white' : 'text-foreground'} />
      <Text
        numberOfLines={1}
        className={`mt-1.5 text-base font-semibold ${onImage ? 'text-white' : 'text-foreground'}`}>
        {value}
      </Text>
      <Text
        numberOfLines={1}
        className={`text-xs ${onImage ? 'text-white/75' : 'text-muted-foreground'}`}>
        {label}
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Vòng cung mặt trời
// ---------------------------------------------------------------------------

const ARC_WIDTH = 240;
const ARC_RADIUS = ARC_WIDTH / 2;
const SUN_DOT = 18;

/**
 * Vòng cung từ lúc mọc tới lúc lặn, chấm vàng là vị trí mặt trời. Chỉ hiện chấm
 * khi đang xem hôm nay và trời đang sáng; ngày khác chỉ có vòng cung.
 */
function SunArc({
  sunrise,
  sunset,
  nowTime,
}: {
  sunrise: string;
  sunset: string;
  nowTime: string | null;
}) {
  const start = minutesOf(sunrise);
  const end = minutesOf(sunset);
  const now = nowTime ? minutesOf(nowTime) : null;
  const progress = now !== null && end > start ? (now - start) / (end - start) : null;
  const visible = progress !== null && progress >= 0 && progress <= 1;

  const angle = visible ? Math.PI * (1 - progress) : 0;
  const dotLeft = ARC_RADIUS + ARC_RADIUS * Math.cos(angle) - SUN_DOT / 2;
  const dotTop = ARC_RADIUS - ARC_RADIUS * Math.sin(angle) - SUN_DOT / 2;

  const daylight = end - start;
  const daylightLabel =
    daylight > 0 ? `${Math.floor(daylight / 60)} giờ ${daylight % 60} phút có nắng` : '';

  return (
    <View className="items-center">
      <View style={{ width: ARC_WIDTH + SUN_DOT, height: ARC_RADIUS + SUN_DOT / 2 }}>
        {/* Nửa trên của một vòng tròn: khung cao bằng bán kính, cắt phần dưới. */}
        <View
          style={{ left: SUN_DOT / 2, top: SUN_DOT / 2, width: ARC_WIDTH, height: ARC_RADIUS }}
          className="absolute overflow-hidden">
          <View
            style={{ width: ARC_WIDTH, height: ARC_WIDTH, borderRadius: ARC_RADIUS }}
            className="border-2 border-sun/40 bg-sun/5"
          />
        </View>
        {visible ? (
          <View
            accessibilityLabel="Vị trí mặt trời hiện tại"
            style={{
              left: dotLeft + SUN_DOT / 2,
              top: dotTop + SUN_DOT / 2,
              width: SUN_DOT,
              height: SUN_DOT,
            }}
            className="absolute items-center justify-center rounded-full bg-sun">
            <View className="h-2 w-2 rounded-full bg-card" />
          </View>
        ) : null}
        <View
          style={{ top: ARC_RADIUS + SUN_DOT / 2 - 1 }}
          className="absolute left-0 right-0 h-px bg-border"
        />
      </View>

      <View className="mt-3 w-full flex-row justify-between">
        <View className="flex-row items-center gap-2">
          <Sunrise size={20} className="text-sun" />
          <View>
            <Text className="text-xs text-muted-foreground">Mọc</Text>
            <Text className="text-base font-semibold text-foreground">{sunrise}</Text>
          </View>
        </View>
        <View className="flex-row items-center gap-2">
          <View className="items-end">
            <Text className="text-xs text-muted-foreground">Lặn</Text>
            <Text className="text-base font-semibold text-foreground">{sunset}</Text>
          </View>
          <Sunset size={20} className="text-sun" />
        </View>
      </View>
      {daylightLabel ? (
        <Text className="mt-2 text-xs text-muted-foreground">{daylightLabel}</Text>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Nhiệt độ cả tuần
// ---------------------------------------------------------------------------

function TemperatureRange({
  days,
  today,
  tripDays,
  selected,
  onSelect,
}: {
  days: readonly DailyWeather[];
  today: string;
  tripDays: ReadonlySet<string>;
  selected: string;
  onSelect: (date: string) => void;
}) {
  const lo = Math.min(...days.map((day) => day.min));
  const hi = Math.max(...days.map((day) => day.max));
  const span = Math.max(hi - lo, 1);

  return (
    <View className="gap-1">
      {days.map((day) => {
        const isSelected = day.date === selected;
        const left = ((day.min - lo) / span) * 100;
        const width = Math.max(((day.max - day.min) / span) * 100, 6);
        return (
          <Pressable
            key={day.date}
            accessibilityRole="button"
            accessibilityState={{ selected: isSelected }}
            accessibilityLabel={`${dayName(day.date, today)} ${shortDate(day.date)}, ${describeWeather(day.code).label}, thấp ${Math.round(day.min)} độ, cao ${Math.round(day.max)} độ`}
            onPress={() => onSelect(day.date)}
            className={`min-h-12 flex-row items-center gap-3 rounded-2xl px-2.5 ${
              isSelected ? 'bg-primary/10' : 'active:bg-muted'
            }`}>
            <View className="w-[72px]">
              <Text numberOfLines={1} className="text-sm font-medium text-foreground">
                {dayName(day.date, today)}
              </Text>
              <View className="flex-row items-center gap-1">
                {tripDays.has(day.date) ? (
                  <View className="h-1.5 w-1.5 rounded-full bg-primary" />
                ) : null}
                <Text className="text-xs text-muted-foreground">{shortDate(day.date)}</Text>
              </View>
            </View>
            <WeatherIcon code={day.code} size={22} />
            <Text className="w-8 text-right text-sm text-muted-foreground">
              {Math.round(day.min)}°
            </Text>
            <View className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
              {/* Nửa mát → nửa nóng: màu mưa sang màu nắng, đọc được "mát hay nóng". */}
              <View
                style={{ marginLeft: `${left}%`, width: `${width}%` }}
                className="h-2 flex-row overflow-hidden rounded-full">
                <View className="flex-1 bg-rain/70" />
                <View className="flex-1 bg-primary" />
                <View className="flex-1 bg-sun" />
              </View>
            </View>
            <Text className="w-8 text-sm font-semibold text-foreground">
              {Math.round(day.max)}°
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Màn hình
// ---------------------------------------------------------------------------

/**
 * Dự báo thời tiết chi tiết của điểm đến.
 *
 * Màn đầu: thẻ chính (nền là ảnh bìa hiện tại của chuyến đi) và dải các ngày.
 * Cuộn xuống: theo giờ, nhiệt độ cả tuần, mặt trời, UV, không khí.
 */
export default function TripWeatherScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ tripId?: string | string[] }>();
  const tripId = Array.isArray(params.tripId) ? params.tripId[0] : params.tripId;

  const trip = useAsync(async () => {
    if (!tripId) throw new Error('Thiếu mã chuyến đi.');
    return getTrip(tripId);
  }, [tripId]);

  const weather = useTripForecast(trip.data);
  const { plan, forecast } = weather;
  const [chosenDay, setChosenDay] = useState<string | null>(null);

  const tripDays = new Set(plan?.kind === 'available' ? plan.days : []);
  const defaultDay = plan?.kind === 'available' ? plan.days[0] : (forecast?.today ?? null);
  const selectedDate =
    chosenDay && forecast?.daily.some((day) => day.date === chosenDay) ? chosenDay : defaultDay;
  const selected = forecast?.daily.find((day) => day.date === selectedDate) ?? null;
  const place = trip.data?.place ?? null;
  const cover = trip.data ? currentCover(trip.data.cover) : null;

  const goBack = (): void => {
    if (router.canGoBack()) router.back();
    else if (tripId) router.replace({ pathname: '/trip/[tripId]/overview', params: { tripId } });
  };

  const header = (
    <View className="flex-row items-center px-2 pb-1 pt-1">
      <IconButton icon={ChevronLeft} label="Quay lại" onPress={goBack} />
      <View className="min-w-0 flex-1 items-center">
        <Text numberOfLines={1} className="font-display text-xl text-foreground">
          {place?.name ?? 'Thời tiết'}
        </Text>
        {trip.data ? (
          <Text numberOfLines={1} className="text-xs text-muted-foreground">
            {trip.data.name}
          </Text>
        ) : null}
      </View>
      {plan?.kind === 'available' && forecast ? (
        <IconButton
          icon={RefreshCw}
          label="Làm mới dự báo"
          busy={weather.refreshing}
          onPress={weather.refresh}
        />
      ) : (
        <View className="h-11 w-11" />
      )}
    </View>
  );

  const body = (): ReactNode => {
    if (trip.loading && trip.data === null) return <ActivityIndicator className="mt-10" />;
    if (trip.error) return <ErrorView message={trip.error} onRetry={trip.reload} />;
    if (!place || place.latitude === null || place.longitude === null) {
      return (
        <EmptyView
          title="Chưa có địa điểm"
          hint="Chọn địa điểm cho chuyến đi để xem dự báo thời tiết."
        />
      );
    }
    if (plan?.kind === 'ended') {
      return <EmptyView title="Chuyến đi đã kết thúc" hint="Không còn dự báo cho chuyến này." />;
    }
    if (plan?.kind === 'tooEarly') {
      return (
        <EmptyView
          title={`Có dự báo từ ${shortDate(plan.availableFrom)}`}
          hint="Dự báo thời tiết chỉ đáng tin trong khoảng 7 ngày tới, nên sẽ hiện từ một tuần trước chuyến đi."
        />
      );
    }
    if (!forecast) {
      return weather.loading ? (
        <ActivityIndicator className="mt-10" />
      ) : (
        <ErrorView message={weather.error ?? 'Chưa tải được dự báo.'} onRetry={weather.refresh} />
      );
    }
    if (!selected) return <EmptyView title="Không có dữ liệu cho ngày này" />;

    const isToday = selected.date === forecast.today;
    const current = isToday ? forecast.current : null;
    const headline = describeWeather(current?.code ?? selected.code, current?.isDay ?? true);
    const hours = hoursOf(forecast, selected.date);
    const aqi = aqiOf(forecast, selected.date);
    const aqiLevel = aqi !== null ? describeAqi(aqi) : null;
    const days = forecast.daily;
    const bigTemperature = Math.round(current?.temperature ?? selected.max);
    const onImage = cover !== null;

    const textMain = onImage ? 'text-white' : 'text-foreground';
    const textSub = onImage ? 'text-white/80' : 'text-muted-foreground';

    return (
      <>
        {weather.error ? <ErrorView message={`${weather.error} Đang hiện dữ liệu cũ.`} /> : null}

        {/* ── Thẻ chính: nền là ảnh bìa hiện tại của chuyến đi ── */}
        <View className="overflow-hidden rounded-[36px] border border-border bg-card shadow-sm">
          {onImage ? (
            <>
              <Image
                source={{ uri: cover.url }}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
                transition={200}
                accessibilityIgnoresInvertColors
              />
              {/* Lớp phủ tối để chữ trắng đọc được trên mọi ảnh, sáng hay tối. */}
              <View className="absolute inset-0 bg-black/50" />
            </>
          ) : (
            <View className={`absolute inset-0 ${heroTint(headline.kind)}`} />
          )}

          <View className="items-center px-5 pb-5 pt-6">
            <Text
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                onImage ? 'bg-white/20 text-white' : 'bg-background/70 text-muted-foreground'
              }`}>
              {dayName(selected.date, forecast.today)} · {shortDate(selected.date)}
              {tripDays.has(selected.date) ? ' · trong chuyến đi' : ''}
            </Text>

            <Text
              accessibilityLabel={`${bigTemperature} độ C`}
              className={`mt-4 font-display text-7xl leading-tight ${textMain}`}>
              {bigTemperature}°C
            </Text>

            <View
              className={`mt-1 flex-row items-center gap-2 rounded-full px-3 py-1.5 ${
                onImage ? 'bg-white/90' : 'bg-background/70'
              }`}>
              <WeatherIcon
                code={current?.code ?? selected.code}
                isDay={current?.isDay ?? true}
                size={22}
              />
              <Text className="text-sm font-semibold text-foreground">{headline.label}</Text>
            </View>

            <View className={`my-3 h-px w-24 ${onImage ? 'bg-white/40' : 'bg-border'}`} />
            <Text className={`text-base ${textMain}`}>
              Cao {Math.round(selected.max)}° · Thấp {Math.round(selected.min)}°
            </Text>
            {current ? (
              <Text className={`mt-0.5 text-xs ${textSub}`}>
                Cảm giác như {Math.round(current.apparentTemperature)}°
              </Text>
            ) : null}

            <View className="mt-5 w-full flex-row gap-2">
              <HeroStat
                onImage={onImage}
                icon={Droplets}
                label="Độ ẩm"
                value={current ? `${Math.round(current.humidity)}%` : '—'}
              />
              <HeroStat
                onImage={onImage}
                icon={Wind}
                label={current ? 'Gió' : 'Gió tối đa'}
                value={
                  current
                    ? `${Math.round(current.windSpeed)} km/h`
                    : selected.windMax !== null
                      ? `${Math.round(selected.windMax)} km/h`
                      : '—'
                }
              />
              <HeroStat
                onImage={onImage}
                icon={CloudRain}
                label="Khả năng mưa"
                value={selected.rainChance !== null ? `${selected.rainChance}%` : '—'}
              />
            </View>
          </View>
        </View>

        {/* ── Dải các ngày ── */}
        <View>
          <View className="mb-2 flex-row items-baseline justify-between px-1">
            <Text className="text-base font-semibold text-foreground">
              Dự báo {days.length} ngày
            </Text>
            <View className="flex-row items-center gap-1.5">
              <View className="h-1.5 w-1.5 rounded-full bg-primary" />
              <Text className="text-xs text-muted-foreground">ngày trong chuyến</Text>
            </View>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View className="flex-row gap-2 pb-1">
              {days.map((day) => {
                const isSelected = day.date === selected.date;
                return (
                  <Pressable
                    key={day.date}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isSelected }}
                    accessibilityLabel={`${dayName(day.date, forecast.today)} ${shortDate(day.date)}${tripDays.has(day.date) ? ', trong chuyến đi' : ''}, ${describeWeather(day.code).label}, cao ${Math.round(day.max)} độ, thấp ${Math.round(day.min)} độ`}
                    onPress={() => setChosenDay(day.date)}
                    className={`w-[76px] items-center gap-1.5 rounded-2xl py-3 ${
                      isSelected
                        ? 'bg-primary'
                        : ' bg-card active:bg-muted'
                    }`}>
                    <Text
                      className={`text-sm font-semibold ${
                        isSelected ? 'text-primary-foreground' : 'text-foreground'
                      }`}>
                      {dayName(day.date, forecast.today, false)}
                    </Text>
                    <View
                      className={`h-9 w-9 items-center justify-center rounded-full ${
                        isSelected ? 'bg-card' : 'bg-muted'
                      }`}>
                      <WeatherIcon code={day.code} size={22} />
                    </View>
                    <Text
                      className={`text-base font-semibold ${
                        isSelected ? 'text-primary-foreground' : 'text-foreground'
                      }`}>
                      {Math.round(day.max)}°
                    </Text>
                    <Text
                      className={`text-xs ${
                        isSelected ? 'text-primary-foreground/80' : 'text-muted-foreground'
                      }`}>
                      {Math.round(day.min)}°
                    </Text>
                    <View className="flex-row items-center gap-1">
                      {tripDays.has(day.date) ? (
                        <View
                          className={`h-1.5 w-1.5 rounded-full ${
                            isSelected ? 'bg-primary-foreground' : 'bg-primary'
                          }`}
                        />
                      ) : null}
                      <Text
                        className={`text-[11px] ${
                          isSelected ? 'text-primary-foreground/80' : 'text-muted-foreground'
                        }`}>
                        {shortDate(day.date)}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>
        </View>

        {/* ── Theo giờ ── */}
        {hours.length > 0 ? (
          <WeatherSection
            icon={Clock}
            tone="primary"
            title="Theo giờ"
            subtitle="Cột xanh là khả năng mưa">
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View className="flex-row gap-1">
                {hours.map((hour, index) => {
                  const isNow = isToday && index === 0;
                  const label = isNow ? 'Bây giờ' : hour.time.slice(11, 16);
                  const rain = hour.rainChance ?? 0;
                  return (
                    <View
                      key={hour.time}
                      // Gộp cả ô thành MỘT điểm dừng cho trình đọc màn hình.
                      accessible
                      accessibilityLabel={`${label}, ${Math.round(hour.temperature)} độ, ${describeWeather(hour.code, hour.isDay).label}, khả năng mưa ${rain}%`}
                      className={`w-[60px] items-center gap-1.5 rounded-2xl py-2.5 ${
                        isNow ? 'bg-primary/10' : ''
                      }`}>
                      <Text
                        className={`text-xs ${isNow ? 'font-semibold text-primary' : 'text-muted-foreground'}`}>
                        {label}
                      </Text>
                      <WeatherIcon code={hour.code} isDay={hour.isDay} size={22} />
                      <Text className="text-base font-semibold text-foreground">
                        {Math.round(hour.temperature)}°
                      </Text>
                      <View className="h-10 w-2 justify-end overflow-hidden rounded-full bg-muted">
                        <View style={{ height: `${rain}%` }} className="w-2 rounded-full bg-rain" />
                      </View>
                      <Text className="text-[11px] text-muted-foreground">{rain}%</Text>
                    </View>
                  );
                })}
              </View>
            </ScrollView>
          </WeatherSection>
        ) : null}

        {/* ── Nhiệt độ cả tuần ── */}
        <WeatherSection
          icon={Thermometer}
          tone="rain"
          title="Nhiệt độ cả tuần"
          subtitle="Chạm một ngày để xem chi tiết">
          <TemperatureRange
            days={days}
            today={forecast.today}
            tripDays={tripDays}
            selected={selected.date}
            onSelect={setChosenDay}
          />
        </WeatherSection>

        {/* ── Mặt trời & UV ── */}
        {selected.sunrise && selected.sunset ? (
          <WeatherSection icon={Sun} tone="sun" title="Mặt trời">
            <SunArc
              sunrise={selected.sunrise}
              sunset={selected.sunset}
              nowTime={isToday ? forecast.nowTime.slice(11, 16) : null}
            />
            {selected.uvMax !== null ? (
              <View className="mt-5 rounded-2xl bg-muted/60 p-3">
                <View className="flex-row items-center justify-between">
                  <Text className="text-sm text-muted-foreground">Chỉ số UV cao nhất</Text>
                  <Text className="text-base font-semibold text-foreground">
                    {Math.round(selected.uvMax)} · {uvLabel(selected.uvMax)}
                  </Text>
                </View>
                <LevelGauge
                  value={selected.uvMax}
                  max={12}
                  segments={[
                    { until: 3, className: 'bg-positive' },
                    { until: 6, className: 'bg-sun' },
                    { until: 8, className: 'bg-negative/60' },
                    { until: 12, className: 'bg-negative' },
                  ]}
                />
              </View>
            ) : null}
          </WeatherSection>
        ) : null}

        {/* ── Chất lượng không khí ── */}
        {aqi !== null && aqiLevel ? (
          <WeatherSection
            icon={Leaf}
            tone="positive"
            title="Chất lượng không khí"
            subtitle={isToday ? 'Chỉ số US AQI hiện tại' : 'Chỉ số US AQI cao nhất trong ngày'}>
            <View className="flex-row items-end gap-3">
              <Text className="font-display text-5xl leading-tight text-foreground">
                {Math.round(aqi)}
              </Text>
              <View className="min-w-0 flex-1 pb-2">
                <Text className="text-base font-semibold text-foreground">{aqiLevel.label}</Text>
              </View>
            </View>
            <LevelGauge
              value={aqi}
              max={300}
              segments={[
                { until: 50, className: 'bg-positive' },
                { until: 100, className: 'bg-sun' },
                { until: 150, className: 'bg-negative/50' },
                { until: 200, className: 'bg-negative/75' },
                { until: 300, className: 'bg-negative' },
              ]}
            />
            <Text className="mt-3 text-sm leading-5 text-muted-foreground">{aqiLevel.advice}</Text>
          </WeatherSection>
        ) : null}

        <Pressable
          accessibilityRole="link"
          onPress={() => void Linking.openURL('https://open-meteo.com/').catch(() => undefined)}
          className="items-center py-2">
          {/* Open-Meteo miễn phí với điều kiện ghi nguồn (CC BY 4.0). */}
          <Text className="text-xs text-muted-foreground">
            Cập nhật lúc {formatClock(forecast.fetchedAt)} · Dữ liệu: Open-Meteo.com
          </Text>
        </Pressable>
      </>
    );
  };

  return <Screen header={header}>{body()}</Screen>;
}
