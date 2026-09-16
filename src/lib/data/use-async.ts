import { useCallback, useEffect, useState } from 'react';

import { DataError } from '@/lib/supabase/errors';

export interface AsyncState<T> {
  readonly data: T | null;
  readonly error: string | null;
  readonly loading: boolean;
  readonly reload: () => void;
}

export function describeError(error: unknown): string {
  if (error instanceof DataError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Có lỗi không xác định.';
}

/**
 * Gọi một hàm bất đồng bộ và theo dõi ba trạng thái tải/lỗi/dữ liệu.
 *
 * Hai điều quan trọng:
 *  - Cờ `cancelled` chặn setState sau khi component đã unmount, và chặn cả kết
 *    quả của lần gọi cũ ghi đè lần gọi mới khi người dùng chuyển màn thật nhanh.
 *  - Lỗi được bắt và đưa vào state thay vì để văng ra: một lỗi mạng không được
 *    phép làm trắng cả màn hình.
 *
 * `deps` là danh sách phụ thuộc của `run`, giống useEffect. Truyền đúng thì
 * màn hình tự tải lại khi tham số đổi.
 */
export function useAsync<T>(run: () => Promise<T>, deps: readonly unknown[]): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    run()
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setLoading(false);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setError(describeError(caught));
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // run được tạo mới mỗi lần render nên cố ý không đưa vào deps; danh sách
    // phụ thuộc thật do màn hình truyền xuống.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  return { data, error, loading, reload };
}
