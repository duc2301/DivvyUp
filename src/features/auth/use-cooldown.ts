import { useCallback, useEffect, useState } from 'react';

/**
 * Đếm ngược tính bằng giây — khoá nút gửi email sau mỗi lần gửi.
 *
 * Lưu MỐC KẾT THÚC chứ không lưu số giây còn lại rồi trừ dần: setInterval bị
 * hệ điều hành tạm dừng khi app xuống nền, đếm kiểu trừ dần sẽ chậm hơn đồng hồ
 * thật và mở khoá trễ.
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
