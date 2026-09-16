/**
 * Kiểu tiền tệ của DivvyUp.
 *
 * LUẬT NỀN TẢNG: tiền LUÔN là số nguyên đơn vị nhỏ nhất.
 *   - VND: đơn vị là đồng   (decimals = 0) → 150000 nghĩa là 150.000 ₫
 *   - USD: đơn vị là cent   (decimals = 2) → 150000 nghĩa là $1,500.00
 *
 * Không bao giờ dùng số thực cho tiền. 0.1 + 0.2 !== 0.3, và với app chia tiền
 * thì sai số kiểu đó tích luỹ thành tranh cãi giữa người dùng thật.
 */

import type { CurrencyCode } from './currency.ts';
import { currencyInfo } from './currency.ts';

export interface Money {
  /** Số nguyên, đơn vị nhỏ nhất của `currency`. Âm nghĩa là nợ/hoàn tiền. */
  readonly minor: number;
  readonly currency: CurrencyCode;
}

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

/** Tạo một giá trị tiền. Ném lỗi nếu `minor` không phải số nguyên an toàn. */
export function money(minor: number, currency: CurrencyCode): Money {
  if (typeof minor !== 'number' || Number.isNaN(minor)) {
    throw new MoneyError(`Số tiền không hợp lệ: ${String(minor)}`);
  }
  if (!Number.isInteger(minor)) {
    throw new MoneyError(
      `Số tiền phải là số nguyên đơn vị nhỏ nhất, nhận được ${minor}. ` +
        `Dùng parseAmount() hoặc fromMajor() để chuyển đổi.`,
    );
  }
  if (!Number.isSafeInteger(minor)) {
    throw new MoneyError(`Số tiền vượt ngưỡng an toàn của JavaScript: ${minor}`);
  }
  currencyInfo(currency); // xác thực mã tiền tệ
  return { minor, currency };
}

export function zero(currency: CurrencyCode): Money {
  return { minor: 0, currency };
}

export function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new MoneyError(
      `Không thể cộng trừ hai đơn vị tiền tệ khác nhau: ${a.currency} và ${b.currency}`,
    );
  }
}

export function add(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.minor + b.minor, a.currency);
}

export function subtract(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.minor - b.minor, a.currency);
}

export function negate(a: Money): Money {
  return money(-a.minor, a.currency);
}

export function absMoney(a: Money): Money {
  return money(Math.abs(a.minor), a.currency);
}

/** Nhân với một số NGUYÊN. Không có phép nhân với số thực — đó là cách mất tiền. */
export function multiplyByInt(a: Money, factor: number): Money {
  if (!Number.isInteger(factor)) {
    throw new MoneyError(`Hệ số nhân phải là số nguyên, nhận được ${factor}. Dùng splitExpense() để chia theo tỷ lệ.`);
  }
  return money(a.minor * factor, a.currency);
}

export function sumMoney(items: readonly Money[], currency: CurrencyCode): Money {
  let total = 0;
  for (const item of items) {
    if (item.currency !== currency) {
      throw new MoneyError(
        `Danh sách chứa đơn vị tiền tệ lẫn lộn: mong đợi ${currency}, gặp ${item.currency}`,
      );
    }
    total += item.minor;
  }
  return money(total, currency);
}

export function isZero(a: Money): boolean {
  return a.minor === 0;
}

export function isPositive(a: Money): boolean {
  return a.minor > 0;
}

export function isNegative(a: Money): boolean {
  return a.minor < 0;
}

export function equalsMoney(a: Money, b: Money): boolean {
  return a.currency === b.currency && a.minor === b.minor;
}

export function compareMoney(a: Money, b: Money): number {
  assertSameCurrency(a, b);
  if (a.minor < b.minor) return -1;
  if (a.minor > b.minor) return 1;
  return 0;
}

export function minMoney(a: Money, b: Money): Money {
  return compareMoney(a, b) <= 0 ? a : b;
}

/**
 * Đổi từ đơn vị lớn (đồng, dollar) sang Money.
 * Chỉ dùng cho hằng số trong code và test — dữ liệu người dùng phải đi qua parseAmount().
 */
export function fromMajor(major: number, currency: CurrencyCode): Money {
  const { decimals } = currencyInfo(currency);
  const scaled = major * 10 ** decimals;
  // Làm tròn ở đây là bắt buộc: 1.1 * 100 = 110.00000000000001 trong IEEE-754.
  const rounded = Math.round(scaled);
  if (Math.abs(scaled - rounded) > 1e-6) {
    throw new MoneyError(
      `Giá trị ${major} có nhiều hơn ${decimals} chữ số thập phân, không biểu diễn được bằng ${currency}`,
    );
  }
  return money(rounded, currency);
}

/**
 * Đổi sang số thực đơn vị lớn. CHỈ dùng để hiển thị hoặc gọi Intl —
 * tuyệt đối không dùng làm đầu vào cho phép tính tiếp theo.
 */
export function toMajorNumber(a: Money): number {
  const { decimals } = currencyInfo(a.currency);
  return a.minor / 10 ** decimals;
}

/**
 * Đọc số tiền người dùng gõ.
 *
 * Chấp nhận cách viết Việt Nam lẫn quốc tế và tự suy ra dấu nào là phân cách
 * nghìn, dấu nào là thập phân:
 *   parseAmount('150.000', 'VND')  → 150000 đồng
 *   parseAmount('1,234.56', 'USD') → 123456 cent
 *   parseAmount('12,5', 'EUR')     → 1250 cent
 *   parseAmount('1.234', 'USD')    → 123400 cent  (3 chữ số sau dấu → phân cách nghìn)
 *
 * Trả về null nếu không đọc được. KHÔNG ném lỗi — đầu vào người dùng sai là chuyện thường.
 */
export function parseAmount(input: string, currency: CurrencyCode): Money | null {
  const info = currencyInfo(currency);
  if (typeof input !== 'string') return null;

  let s = input.replace(/\s| /g, '');
  if (s === '') return null;

  let negative = false;
  if (s.startsWith('-')) {
    negative = true;
    s = s.slice(1);
  } else if (s.startsWith('+')) {
    s = s.slice(1);
  }

  // Bỏ ký hiệu tiền tệ nếu người dùng gõ kèm
  s = s.split(info.symbol).join('');
  if (s === '' || !/^[0-9.,]+$/.test(s)) return null;

  let intPart: string;
  let fracPart = '';

  // Phần nguyên chỉ hợp lệ khi là dãy số trơn, hoặc nhóm ĐỦ 3 chữ số sau mỗi
  // dấu phân cách ("1.250.000"). Không kiểm cấu trúc thì "1,5" đồng bị đọc
  // thành 15 đồng và "0.123" đô thành $123 — sai lệch hàng chục, hàng nghìn lần
  // mà không báo gì. Nhóm đầu không được bắt đầu bằng 0 vì cùng lý do.
  const readInteger = (value: string): string | null => {
    if (/^[0-9]+$/.test(value)) return value;
    if (/^[1-9][0-9]{0,2}([.,][0-9]{3})+$/.test(value)) return value.replace(/[.,]/g, '');
    return null;
  };

  if (info.decimals === 0) {
    // Không có phần lẻ: dấu chấm/phẩy chỉ được là phân cách nghìn.
    const integer = readInteger(s);
    if (integer === null) return null;
    intPart = integer;
  } else {
    const lastSeparator = Math.max(s.lastIndexOf('.'), s.lastIndexOf(','));
    const tail = lastSeparator === -1 ? '' : s.slice(lastSeparator + 1);
    // Dấu cuối được coi là dấu thập phân khi phần đuôi đủ ngắn.
    // "1.234" (3 chữ số) là một nghìn hai trăm ba tư, không phải 1 đồng 234 cent.
    const isDecimalSeparator =
      lastSeparator !== -1 && tail.length > 0 && tail.length <= info.decimals;

    if (isDecimalSeparator) {
      const head = s.slice(0, lastSeparator);
      const separator = s[lastSeparator];
      // Dấu thập phân không được trùng dấu phân cách nghìn: "1.234.56" là gõ nhầm.
      if (head.includes(separator)) return null;
      const integer = head === '' ? '0' : readInteger(head);
      if (integer === null) return null;
      intPart = integer;
      fracPart = tail;
    } else {
      const integer = readInteger(s);
      if (integer === null) return null;
      intPart = integer;
    }
  }

  if (!/^[0-9]*$/.test(intPart) || !/^[0-9]*$/.test(fracPart)) return null;
  if (intPart === '' && fracPart === '') return null;

  const digits = (intPart === '' ? '0' : intPart) + fracPart.padEnd(info.decimals, '0');
  const magnitude = Number(digits);
  if (!Number.isSafeInteger(magnitude)) return null;

  return { minor: negative ? -magnitude : magnitude, currency };
}

export interface FormatOptions {
  /** Kèm ký hiệu tiền tệ. Mặc định true. */
  readonly withSymbol?: boolean;
  /** 'auto' hiện dấu trừ khi âm; 'always' hiện cả dấu cộng; 'never' bỏ dấu. */
  readonly signDisplay?: 'auto' | 'always' | 'never';
}

/**
 * HÀM ĐỊNH DẠNG TIỀN DUY NHẤT CỦA APP.
 * Mọi màn hình phải gọi hàm này. Mỗi màn tự định dạng một kiểu là lỗi
 * mà agent audit-ui sẽ báo.
 *
 * Tự cài đặt thay vì dùng Intl.NumberFormat vì Hermes trên Android
 * có bản ICU rút gọn, kết quả không giống nhau giữa các nền tảng.
 */
export function formatMoney(amount: Money, options: FormatOptions = {}): string {
  const { withSymbol = true, signDisplay = 'auto' } = options;
  const info = currencyInfo(amount.currency);

  const magnitude = Math.abs(amount.minor);
  const digits = String(magnitude).padStart(info.decimals + 1, '0');
  const cut = digits.length - info.decimals;
  const integerDigits = digits.slice(0, cut);
  const fractionDigits = digits.slice(cut);

  const grouped = integerDigits.replace(/\B(?=(\d{3})+(?!\d))/g, info.groupSeparator);
  let body = info.decimals > 0 ? grouped + info.decimalSeparator + fractionDigits : grouped;

  if (withSymbol) {
    body =
      info.symbolPosition === 'prefix' ? info.symbol + body : body + ' ' + info.symbol;
  }

  if (signDisplay === 'never') return body;
  if (amount.minor < 0) return '-' + body;
  if (signDisplay === 'always' && amount.minor > 0) return '+' + body;
  return body;
}
