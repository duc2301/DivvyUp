/**
 * Thay cho `lib0/webcrypto` trên React Native (Metro alias trong metro.config.js).
 *
 * Bản react-native của lib0 đòi gói `isomorphic-webcrypto` (không có trong repo,
 * và kéo theo module native — đổi runtime fingerprint, buộc build APK). Hermes
 * cũng không có `crypto.getRandomValues`. Yjs chỉ dùng hàm này để sinh clientID:
 * cần KHÁC NHAU giữa các máy, không cần mạnh về mật mã — Math.random đủ, cùng lý
 * do với localId() ở src/lib/storage/local-store.ts. KHÔNG dùng hàm này cho bất
 * cứ thứ gì liên quan bảo mật.
 */

type IntegerArray = Int8Array | Uint8Array | Int16Array | Uint16Array | Int32Array | Uint32Array;

interface MaybeCrypto {
  readonly getRandomValues?: <T extends IntegerArray>(array: T) => T;
}

export function getRandomValues<T extends IntegerArray>(array: T): T {
  // Gọi như PHƯƠNG THỨC của crypto (giữ `this`): bản cài đặt thật ném "Illegal
  // invocation" nếu tách hàm ra.
  const crypto = (globalThis as { crypto?: MaybeCrypto }).crypto;
  if (crypto?.getRandomValues) return crypto.getRandomValues(array);
  const max = 2 ** (array.BYTES_PER_ELEMENT * 8);
  for (let index = 0; index < array.length; index += 1) {
    // NOSONAR — không dùng cho mật mã, xem chú thích đầu file.
    array[index] = Math.floor(Math.random() * max);
  }
  return array;
}

/** lib0 khai báo `subtle`; Yjs không dùng tới. */
export const subtle = undefined;
