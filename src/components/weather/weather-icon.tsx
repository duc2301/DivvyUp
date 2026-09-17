import {
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudMoon,
  CloudRain,
  CloudSnow,
  CloudSun,
  Cloudy,
  Moon,
  Sun,
} from '@/components/ui/icons';
import type { LucideIcon } from '@/components/ui/icons';
import { describeWeather } from '@/lib/weather/weather-codes';

interface WeatherIconProps {
  readonly code: number;
  readonly isDay?: boolean;
  readonly size?: number;
}

/** Nắng vàng, mưa xanh, mây theo màu chữ phụ — đều là token, tự đổi theo theme. */
export function WeatherIcon({ code, isDay = true, size = 24 }: WeatherIconProps) {
  const { kind, label } = describeWeather(code, isDay);

  let Icon: LucideIcon = Cloud;
  let tone = 'text-muted-foreground';

  switch (kind) {
    case 'clear':
      Icon = isDay ? Sun : Moon;
      tone = isDay ? 'text-sun' : tone;
      break;
    case 'partly':
      Icon = isDay ? CloudSun : CloudMoon;
      tone = isDay ? 'text-sun' : tone;
      break;
    case 'cloudy':
      Icon = Cloudy;
      break;
    case 'fog':
      Icon = CloudFog;
      break;
    case 'drizzle':
      Icon = CloudDrizzle;
      tone = 'text-rain';
      break;
    case 'rain':
    case 'showers':
      Icon = CloudRain;
      tone = 'text-rain';
      break;
    case 'snow':
      Icon = CloudSnow;
      break;
    case 'thunder':
      Icon = CloudLightning;
      tone = 'text-rain';
      break;
    default:
      Icon = Cloud;
  }

  return <Icon size={size} className={tone} accessibilityLabel={label} />;
}
