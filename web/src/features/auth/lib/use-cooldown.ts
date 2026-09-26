import { useCallback, useEffect, useState } from 'react';

/**
 * Đếm ngược tính bằng giây — khoá nút gửi email. Lưu MỐC KẾT THÚC chứ không trừ
 * dần: tab ở nền bị trình duyệt giảm nhịp setInterval (giống mobile).
 */
export function useCooldown(): readonly [secondsLeft: number, start: (seconds: number) => void] {
  const [endsAt, setEndsAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (endsAt === null) return;
    const timer = setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= endsAt) setEndsAt(null);
    }, 500);
    return () => clearInterval(timer);
  }, [endsAt]);

  const start = useCallback((seconds: number) => {
    const current = Date.now();
    setNow(current);
    setEndsAt(current + seconds * 1000);
  }, []);

  const secondsLeft = endsAt === null ? 0 : Math.max(0, Math.ceil((endsAt - now) / 1000));
  return [secondsLeft, start] as const;
}
