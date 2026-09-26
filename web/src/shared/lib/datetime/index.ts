/** Định dạng ngày giờ dd/MM/yyyy HH:mm — dùng chung với mobile. */
export {
  formatDate,
  formatDateTime,
  formatRelativeDateTime,
  parseDateTime,
  toIsoDate,
} from '@core/lib/datetime';

/** 'dd/MM/yyyy HH:mm' → giá trị cho <input type="datetime-local"> (yyyy-MM-ddTHH:mm). */
export function toDateTimeLocalValue(date: Date): string {
  const pad = (value: number): string => (value < 10 ? `0${value}` : String(value));
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/** Giá trị <input type="datetime-local"> → Date theo giờ máy; null nếu rỗng/sai. */
export function fromDateTimeLocalValue(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!match) return null;
  const date = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
  );
  return Number.isNaN(date.getTime()) ? null : date;
}
