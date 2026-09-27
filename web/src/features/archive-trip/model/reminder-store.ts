/**
 * Các chuyến người dùng đã bấm "Để sau" ở banner nhắc lưu trữ — chỉ trên trình
 * duyệt này. Mất đi (chế độ ẩn danh, xoá dữ liệu trang) thì banner hiện lại,
 * không hỏng gì. Mọi lần đọc/ghi bọc try: trình duyệt chặn lưu trữ thì
 * localStorage ném lỗi ngay khi chạm vào.
 */
function keyOf(userId: string): string {
  // Theo tài khoản: hai người dùng chung trình duyệt không xoá "Để sau" của nhau.
  return `divvyup_archive_reminder_dismissed:${userId}`;
}

export function loadDismissedReminders(userId: string): Set<string> {
  try {
    const raw = window.localStorage.getItem(keyOf(userId));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(
      Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [],
    );
  } catch {
    return new Set();
  }
}

/** true nếu đã lưu. Không lưu được thì banner chỉ hiện lại lần sau — không báo lỗi. */
export function saveDismissedReminders(userId: string, ids: readonly string[]): boolean {
  try {
    window.localStorage.setItem(keyOf(userId), JSON.stringify(ids));
    return true;
  } catch {
    return false;
  }
}
