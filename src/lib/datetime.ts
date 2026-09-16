/**
 * Đọc và hiển thị ngày giờ theo định dạng Việt Nam: dd/MM/yyyy HH:mm
 *
 * Tự cài đặt thay vì dùng Intl vì Hermes trên Android có bản ICU rút gọn,
 * kết quả không giống nhau giữa các nền tảng — cùng lý do với formatMoney.
 * Mọi giá trị đều theo giờ địa phương của máy.
 */

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

export function formatDateTime(date: Date): string {
  return (
    `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}/${date.getFullYear()} ` +
    `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
  );
}

export function formatDate(date: Date): string {
  return `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}/${date.getFullYear()}`;
}

/** Ngày dạng yyyy-MM-dd để lưu vào cột `date` của Postgres. */
export function toIsoDate(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/**
 * Đọc chuỗi "dd/MM/yyyy HH:mm" thành Date theo giờ địa phương.
 * Trả về null nếu không đọc được — đầu vào người dùng sai là chuyện thường,
 * không phải trường hợp ngoại lệ đáng ném lỗi.
 */
export function parseDateTime(input: string): Date | null {
  const match = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[\s,]+(\d{1,2}):(\d{2}))?\s*$/.exec(input);
  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const hour = match[4] === undefined ? 0 : Number(match[4]);
  const minute = match[5] === undefined ? 0 : Number(match[5]);

  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  if (hour > 23 || minute > 59) return null;

  const date = new Date(year, month - 1, day, hour, minute, 0, 0);

  // Bắt ngày không tồn tại: 31/02 sẽ bị Date tự trượt sang tháng 3.
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return date;
}

/** Nhãn ngắn cho danh sách: "Hôm nay 19:30", "Hôm qua 12:05", "14/09 08:00". */
export function formatRelativeDateTime(date: Date, now: Date = new Date()): string {
  const time = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  if (sameDay) return `Hôm nay ${time}`;

  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const isYesterday =
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate();

  if (isYesterday) return `Hôm qua ${time}`;

  return `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)} ${time}`;
}
