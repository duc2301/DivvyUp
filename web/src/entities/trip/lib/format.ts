import type { PlaceResult, TripPlace } from '../api';

/** 'YYYY-MM-DD' → 'dd/mm/yyyy'. Không qua Date để khỏi lệch múi giờ. */
export function formatIsoDate(value: string): string {
  const [year, month, day] = value.split('-');
  return `${day}/${month}/${year}`;
}

/** Nhãn ngày trên màn chuyến đi (giống overview.tsx). */
export function tripDateLabel(start: string | null, end: string | null): string | null {
  if (start && end)
    return start === end ? formatIsoDate(start) : `${formatIsoDate(start)} – ${formatIsoDate(end)}`;
  if (start) return `Từ ${formatIsoDate(start)}`;
  if (end) return `Đến ${formatIsoDate(end)}`;
  return null;
}

/** Nhãn ngày trên thẻ ở danh sách (giống index.tsx). */
export function tripListDateLabel(start: string | null, end: string | null): string | null {
  if (start && end) return `${formatIsoDate(start)} → ${formatIsoDate(end)}`;
  if (start) return `Từ ${formatIsoDate(start)}`;
  if (end) return `Đến ${formatIsoDate(end)}`;
  return null;
}

export function placeLabel(place: TripPlace): string {
  return place.country ? `${place.name}, ${place.country}` : place.name;
}

export function toTripPlace(place: PlaceResult): TripPlace {
  return {
    name: place.name,
    address: place.address,
    country: place.country,
    latitude: place.latitude,
    longitude: place.longitude,
    provider: place.provider,
    externalId: place.id,
  };
}
