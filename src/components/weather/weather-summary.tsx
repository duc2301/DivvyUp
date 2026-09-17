import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { ChevronRight, Cloud } from '@/components/ui/icons';
import type { TripForecastState } from '@/features/weather/use-trip-forecast';
import { dayName, shortDate } from '@/lib/weather/forecast-window';
import { describeWeather } from '@/lib/weather/weather-codes';

import { WeatherIcon } from './weather-icon';

interface WeatherSummaryProps {
  readonly state: TripForecastState;
  readonly onOpen: () => void;
}

/**
 * Một dòng tóm tắt thời tiết ngay dưới địa điểm của chuyến đi.
 *
 * Cố ý chỉ một dòng: màn chuyến đi là để quản lý tiền, thời tiết là thông tin
 * phụ. Chi tiết nằm ở màn riêng, mở bằng cách chạm vào dòng này.
 */
export function WeatherSummary({ state, onOpen }: WeatherSummaryProps) {
  const { plan, forecast, loading, error } = state;

  // Chưa có địa điểm (hoặc địa điểm không có toạ độ) hay chuyến đã xong: không hiện gì.
  if (plan === null || plan.kind === 'ended') return null;

  if (plan.kind === 'tooEarly') {
    return (
      <Row onOpen={onOpen} label="Xem thời tiết">
        <Cloud size={18} className="text-muted-foreground" />
        <Text numberOfLines={1} className="min-w-0 flex-1 text-sm text-muted-foreground">
          Dự báo thời tiết có từ {shortDate(plan.availableFrom)} (7 ngày trước chuyến đi)
        </Text>
      </Row>
    );
  }

  if (forecast === null) {
    return (
      <Row onOpen={onOpen} label="Xem thời tiết">
        {loading ? (
          <ActivityIndicator size="small" />
        ) : (
          <Cloud size={18} className="text-muted-foreground" />
        )}
        <Text numberOfLines={1} className="min-w-0 flex-1 text-sm text-muted-foreground">
          {loading ? 'Đang tải thời tiết…' : (error ?? 'Chưa tải được thời tiết')}
        </Text>
      </Row>
    );
  }

  const date = plan.days[0];
  const day = forecast.daily.find((item) => item.date === date);
  if (!day) return null;

  const isToday = date === forecast.today;
  const current = isToday ? forecast.current : null;
  const description = describeWeather(current?.code ?? day.code, current?.isDay ?? true);

  const parts = [
    description.label,
    current
      ? `${Math.round(current.temperature)}° (${Math.round(day.min)}–${Math.round(day.max)}°)`
      : `${Math.round(day.min)}–${Math.round(day.max)}°`,
    day.rainChance !== null && day.rainChance >= 20 ? `${day.rainChance}% mưa` : null,
  ].filter(Boolean);

  const when = isToday ? 'Hôm nay' : `${dayName(date, forecast.today)} ${shortDate(date)}`;

  return (
    <Row onOpen={onOpen} label={`Thời tiết ${when}: ${parts.join(', ')}. Xem chi tiết`}>
      <WeatherIcon code={current?.code ?? day.code} isDay={current?.isDay ?? true} size={20} />
      <Text numberOfLines={1} className="min-w-0 flex-1 text-sm text-foreground">
        <Text className="font-semibold">{when}</Text>
        <Text className="text-muted-foreground"> · {parts.join(' · ')}</Text>
      </Text>
    </Row>
  );
}

function Row({
  children,
  onOpen,
  label,
}: {
  readonly children: ReactNode;
  readonly onOpen: () => void;
  readonly label: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onOpen}
      className="mt-2 min-h-11 flex-row items-center gap-2 self-stretch rounded-xl bg-muted px-3 active:opacity-70">
      <View className="min-w-0 flex-1 flex-row items-center gap-2">{children}</View>
      <ChevronRight size={18} className="text-muted-foreground" />
    </Pressable>
  );
}
