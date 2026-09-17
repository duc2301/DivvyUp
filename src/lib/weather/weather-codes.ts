/**
 * Mã thời tiết WMO (Open-Meteo trả về) → nhãn tiếng Việt + nhóm icon.
 *
 * Hàm thuần, không đụng React Native, để kiểm thử được bằng `node --test`.
 * Bảng mã: https://open-meteo.com/en/docs (mục "WMO Weather interpretation codes").
 */

export type WeatherKind =
  | 'clear'
  | 'partly'
  | 'cloudy'
  | 'fog'
  | 'drizzle'
  | 'rain'
  | 'showers'
  | 'snow'
  | 'thunder'
  | 'unknown';

export interface WeatherDescription {
  readonly label: string;
  readonly kind: WeatherKind;
}

const TABLE: Readonly<Record<number, WeatherDescription>> = {
  0: { label: 'Trời quang', kind: 'clear' },
  1: { label: 'Ít mây', kind: 'partly' },
  2: { label: 'Có mây', kind: 'partly' },
  3: { label: 'Nhiều mây', kind: 'cloudy' },
  45: { label: 'Sương mù', kind: 'fog' },
  48: { label: 'Sương mù đóng băng', kind: 'fog' },
  51: { label: 'Mưa phùn nhẹ', kind: 'drizzle' },
  53: { label: 'Mưa phùn', kind: 'drizzle' },
  55: { label: 'Mưa phùn dày', kind: 'drizzle' },
  56: { label: 'Mưa phùn lạnh', kind: 'drizzle' },
  57: { label: 'Mưa phùn lạnh', kind: 'drizzle' },
  61: { label: 'Mưa nhẹ', kind: 'rain' },
  63: { label: 'Mưa vừa', kind: 'rain' },
  65: { label: 'Mưa to', kind: 'rain' },
  66: { label: 'Mưa lạnh', kind: 'rain' },
  67: { label: 'Mưa lạnh to', kind: 'rain' },
  71: { label: 'Tuyết nhẹ', kind: 'snow' },
  73: { label: 'Tuyết rơi', kind: 'snow' },
  75: { label: 'Tuyết dày', kind: 'snow' },
  77: { label: 'Hạt tuyết', kind: 'snow' },
  80: { label: 'Mưa rào nhẹ', kind: 'showers' },
  81: { label: 'Mưa rào', kind: 'showers' },
  82: { label: 'Mưa rào rất to', kind: 'showers' },
  85: { label: 'Mưa tuyết', kind: 'snow' },
  86: { label: 'Mưa tuyết dày', kind: 'snow' },
  95: { label: 'Dông', kind: 'thunder' },
  96: { label: 'Dông kèm mưa đá', kind: 'thunder' },
  99: { label: 'Dông kèm mưa đá', kind: 'thunder' },
};

export function describeWeather(code: number | null | undefined, isDay = true): WeatherDescription {
  const found = code === null || code === undefined ? undefined : TABLE[code];
  if (!found) return { label: 'Không rõ', kind: 'unknown' };
  // Ban ngày trời quang thì người Việt nói "Nắng", ban đêm thì không.
  if (found.kind === 'clear' && isDay) return { label: 'Nắng', kind: 'clear' };
  return found;
}

export type AqiTone = 'good' | 'moderate' | 'sensitive' | 'unhealthy' | 'very' | 'hazardous';

export interface AqiLevel {
  readonly label: string;
  readonly advice: string;
  readonly tone: AqiTone;
}

/** Thang US AQI của EPA — thang Open-Meteo trả về ở trường `us_aqi`. */
export function describeAqi(aqi: number): AqiLevel {
  if (aqi <= 50) {
    return {
      label: 'Tốt',
      advice: 'Không khí trong lành, thoải mái hoạt động ngoài trời.',
      tone: 'good',
    };
  }
  if (aqi <= 100) {
    return {
      label: 'Trung bình',
      advice: 'Chấp nhận được. Người rất nhạy cảm nên hạn chế ở ngoài lâu.',
      tone: 'moderate',
    };
  }
  if (aqi <= 150) {
    return {
      label: 'Kém với nhóm nhạy cảm',
      advice: 'Trẻ nhỏ, người già, người có bệnh hô hấp nên đeo khẩu trang.',
      tone: 'sensitive',
    };
  }
  if (aqi <= 200) {
    return {
      label: 'Kém',
      advice: 'Nên đeo khẩu trang và giảm hoạt động ngoài trời.',
      tone: 'unhealthy',
    };
  }
  if (aqi <= 300) {
    return { label: 'Rất kém', advice: 'Hạn chế ra ngoài, đóng cửa sổ.', tone: 'very' };
  }
  return { label: 'Nguy hại', advice: 'Ở trong nhà nếu có thể.', tone: 'hazardous' };
}
