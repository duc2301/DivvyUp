export type ShareOutcome = 'shared' | 'copied' | 'cancelled' | 'failed';

/** Chép chữ vào bộ nhớ tạm. Trả false nếu trình duyệt không cho. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Mở bảng chia sẻ của hệ điều hành (iPhone/Android); máy không có thì chép vào
 * bộ nhớ tạm. Người dùng bấm huỷ bảng chia sẻ không phải lỗi.
 */
export async function shareOrCopy(input: {
  readonly title: string;
  readonly text: string;
  readonly url?: string;
}): Promise<ShareOutcome> {
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share(input);
      return 'shared';
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === 'AbortError') return 'cancelled';
    }
  }
  const full = input.url ? `${input.text}\n${input.url}` : input.text;
  return (await copyText(full)) ? 'copied' : 'failed';
}
