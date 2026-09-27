import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Các chuyến mà người dùng đã bấm "Để sau" ở banner nhắc lưu trữ. Chỉ là tuỳ
 * chọn hiển thị trên máy này — mất đi thì banner hiện lại, không hỏng gì.
 *
 * Khoá theo tài khoản (hoặc "guest"): hai người dùng chung máy, hay chuyển qua
 * lại khách ↔ đăng nhập, không xoá "Để sau" của nhau.
 */
function keyOf(scope: string): string {
  return `divvyup_archive_reminder_dismissed:${scope}`;
}

export async function loadDismissedReminders(scope: string): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(keyOf(scope));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(
      Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [],
    );
  } catch {
    // Chuỗi hỏng hoặc kho lỗi: coi như chưa "Để sau" chuyến nào — tệ nhất là
    // banner hiện thêm một lần.
    return new Set();
  }
}

export async function saveDismissedReminders(scope: string, ids: readonly string[]): Promise<void> {
  await AsyncStorage.setItem(keyOf(scope), JSON.stringify(ids));
}
