/**
 * Metadata đơn vị tiền tệ.
 *
 * `decimals` là số chữ số sau dấu thập phân, tức số mũ để đổi giữa đơn vị lớn
 * (đồng, dollar) và đơn vị nhỏ nhất (đồng, cent). Mọi số tiền trong app đều lưu
 * bằng ĐƠN VỊ NHỎ NHẤT dưới dạng số nguyên — xem money.ts.
 */

export type CurrencyCode = 'VND' | 'USD' | 'EUR' | 'JPY';

export interface CurrencyInfo {
  readonly code: CurrencyCode;
  readonly decimals: number;
  readonly symbol: string;
  readonly symbolPosition: 'prefix' | 'suffix';
  readonly groupSeparator: string;
  readonly decimalSeparator: string;
}

export const CURRENCIES: Readonly<Record<CurrencyCode, CurrencyInfo>> = {
  VND: {
    code: 'VND',
    decimals: 0,
    symbol: '₫',
    symbolPosition: 'suffix',
    groupSeparator: '.',
    decimalSeparator: ',',
  },
  USD: {
    code: 'USD',
    decimals: 2,
    symbol: '$',
    symbolPosition: 'prefix',
    groupSeparator: ',',
    decimalSeparator: '.',
  },
  EUR: {
    code: 'EUR',
    decimals: 2,
    symbol: '€',
    symbolPosition: 'suffix',
    groupSeparator: '.',
    decimalSeparator: ',',
  },
  JPY: {
    code: 'JPY',
    decimals: 0,
    symbol: '¥',
    symbolPosition: 'prefix',
    groupSeparator: ',',
    decimalSeparator: '.',
  },
};

export const CURRENCY_CODES = Object.keys(CURRENCIES) as CurrencyCode[];

export const DEFAULT_CURRENCY: CurrencyCode = 'VND';

export function currencyInfo(code: CurrencyCode): CurrencyInfo {
  const info = CURRENCIES[code];
  if (!info) {
    throw new Error(`Đơn vị tiền tệ không được hỗ trợ: ${String(code)}`);
  }
  return info;
}

export function isCurrencyCode(value: unknown): value is CurrencyCode {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(CURRENCIES, value);
}
