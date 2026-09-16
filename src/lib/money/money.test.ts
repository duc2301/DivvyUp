import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  MoneyError,
  add,
  compareMoney,
  formatMoney,
  fromMajor,
  money,
  negate,
  parseAmount,
  subtract,
  sumMoney,
  zero,
} from './money.ts';

describe('money() — chặn số thực ngay từ cửa', () => {
  test('nhận số nguyên', () => {
    assert.deepEqual(money(150_000, 'VND'), { minor: 150_000, currency: 'VND' });
    assert.deepEqual(money(-4_200, 'USD'), { minor: -4_200, currency: 'USD' });
  });

  test('từ chối số thực — đây là hàng rào chính chống bug tiền tệ', () => {
    assert.throws(() => money(3333.33, 'VND'), MoneyError);
    assert.throws(() => money(0.1 + 0.2, 'USD'), MoneyError);
  });

  test('từ chối NaN và số vượt ngưỡng an toàn', () => {
    assert.throws(() => money(Number.NaN, 'VND'), MoneyError);
    assert.throws(() => money(Number.MAX_SAFE_INTEGER + 2, 'VND'), MoneyError);
  });
});

describe('phép cộng trừ', () => {
  test('cộng trừ cơ bản', () => {
    assert.equal(add(money(100, 'VND'), money(250, 'VND')).minor, 350);
    assert.equal(subtract(money(100, 'VND'), money(250, 'VND')).minor, -150);
    assert.equal(negate(money(100, 'VND')).minor, -100);
  });

  test('KHÔNG cho cộng hai đơn vị tiền tệ khác nhau', () => {
    assert.throws(() => add(money(100, 'VND'), money(100, 'USD')), MoneyError);
  });

  test('sumMoney phát hiện danh sách lẫn đơn vị tiền tệ', () => {
    assert.equal(sumMoney([money(1, 'VND'), money(2, 'VND')], 'VND').minor, 3);
    assert.equal(sumMoney([], 'VND').minor, 0);
    assert.throws(() => sumMoney([money(1, 'VND'), money(2, 'USD')], 'VND'), MoneyError);
  });

  test('cộng 0.1 + 0.2 kiểu tiền tệ ra đúng 0.3 — thứ số thực làm không được', () => {
    const result = add(fromMajor(0.1, 'USD'), fromMajor(0.2, 'USD'));
    assert.equal(result.minor, 30);
    assert.equal(formatMoney(result), '$0.30');
    // Đối chiếu: cách làm bằng số thực thì sai.
    assert.notEqual(0.1 + 0.2, 0.3);
  });
});

describe('parseAmount — đọc số người dùng gõ', () => {
  test('VND: mọi dấu chấm phẩy đều là phân cách nghìn', () => {
    assert.equal(parseAmount('150000', 'VND')?.minor, 150_000);
    assert.equal(parseAmount('150.000', 'VND')?.minor, 150_000);
    assert.equal(parseAmount('150,000', 'VND')?.minor, 150_000);
    assert.equal(parseAmount('1.250.000', 'VND')?.minor, 1_250_000);
  });

  test('USD: phân biệt được dấu thập phân với phân cách nghìn', () => {
    assert.equal(parseAmount('1234.56', 'USD')?.minor, 123_456);
    assert.equal(parseAmount('1,234.56', 'USD')?.minor, 123_456);
    assert.equal(parseAmount('1.5', 'USD')?.minor, 150);
    // 3 chữ số sau dấu → là phân cách nghìn, không phải thập phân
    assert.equal(parseAmount('1.234', 'USD')?.minor, 123_400);
  });

  test('EUR kiểu châu Âu: dấu phẩy là thập phân', () => {
    assert.equal(parseAmount('12,5', 'EUR')?.minor, 1_250);
    assert.equal(parseAmount('1.234,56', 'EUR')?.minor, 123_456);
  });

  test('chấp nhận khoảng trắng, dấu âm và ký hiệu tiền tệ', () => {
    assert.equal(parseAmount('  150 000 ', 'VND')?.minor, 150_000);
    assert.equal(parseAmount('-150000', 'VND')?.minor, -150_000);
    assert.equal(parseAmount('150000₫', 'VND')?.minor, 150_000);
    assert.equal(parseAmount('$12.34', 'USD')?.minor, 1_234);
  });

  test('không đoán bừa khi dấu phân cách sai cấu trúc', () => {
    // Mỗi dòng dưới đây từng bị đọc thành một con số lệch 10–1000 lần.
    assert.equal(parseAmount('1,5', 'VND'), null);
    assert.equal(parseAmount('12.5', 'VND'), null);
    assert.equal(parseAmount('45.00', 'VND'), null);
    assert.equal(parseAmount('1.25.000', 'VND'), null);
    assert.equal(parseAmount('0.123', 'USD'), null);
    assert.equal(parseAmount('1.2.3', 'USD'), null);
    assert.equal(parseAmount('1.234.56', 'USD'), null);
    // Các cách viết hợp lệ vẫn đọc đúng.
    assert.equal(parseAmount('.5', 'USD')?.minor, 50);
    assert.equal(parseAmount('0.05', 'USD')?.minor, 5);
    assert.equal(parseAmount('1,000.00', 'USD')?.minor, 100_000);
    assert.equal(parseAmount('1.234,56', 'EUR')?.minor, 123_456);
    assert.equal(parseAmount('1234567', 'VND')?.minor, 1_234_567);
  });

  test('trả null thay vì ném lỗi khi đầu vào sai', () => {
    assert.equal(parseAmount('', 'VND'), null);
    assert.equal(parseAmount('abc', 'VND'), null);
    assert.equal(parseAmount('12a3', 'VND'), null);
    assert.equal(parseAmount('...', 'VND'), null);
    assert.equal(parseAmount('99999999999999999999', 'VND'), null);
  });

  test('parse rồi format phải quay về đúng con số ban đầu', () => {
    for (const input of ['150000', '1', '999999999']) {
      const parsed = parseAmount(input, 'VND');
      assert.ok(parsed);
      const reparsed = parseAmount(formatMoney(parsed, { withSymbol: false }), 'VND');
      assert.equal(reparsed?.minor, parsed.minor);
    }
  });
});

describe('formatMoney — hàm định dạng duy nhất của app', () => {
  test('VND: không phần lẻ, dấu chấm phân cách nghìn, ký hiệu đứng sau', () => {
    assert.equal(formatMoney(money(150_000, 'VND')), '150.000 ₫');
    assert.equal(formatMoney(money(0, 'VND')), '0 ₫');
    assert.equal(formatMoney(money(1_250_000, 'VND')), '1.250.000 ₫');
  });

  test('USD: hai chữ số lẻ, ký hiệu đứng trước', () => {
    assert.equal(formatMoney(money(123_456, 'USD')), '$1,234.56');
    assert.equal(formatMoney(money(5, 'USD')), '$0.05');
    assert.equal(formatMoney(money(0, 'USD')), '$0.00');
  });

  test('hiển thị dấu', () => {
    assert.equal(formatMoney(money(-150_000, 'VND')), '-150.000 ₫');
    assert.equal(formatMoney(money(150_000, 'VND'), { signDisplay: 'always' }), '+150.000 ₫');
    assert.equal(formatMoney(money(-150_000, 'VND'), { signDisplay: 'never' }), '150.000 ₫');
    assert.equal(formatMoney(money(150_000, 'VND'), { withSymbol: false }), '150.000');
  });
});

describe('fromMajor', () => {
  test('đổi đúng theo số chữ số lẻ của từng đơn vị', () => {
    assert.equal(fromMajor(150_000, 'VND').minor, 150_000);
    assert.equal(fromMajor(1_234.56, 'USD').minor, 123_456);
    // 1.1 * 100 = 110.00000000000001 trong IEEE-754 — phải làm tròn đúng
    assert.equal(fromMajor(1.1, 'USD').minor, 110);
  });

  test('từ chối giá trị có nhiều chữ số lẻ hơn đơn vị cho phép', () => {
    assert.throws(() => fromMajor(1.234, 'USD'), MoneyError);
    assert.throws(() => fromMajor(0.5, 'VND'), MoneyError);
  });
});

describe('so sánh', () => {
  test('compareMoney', () => {
    assert.equal(compareMoney(money(1, 'VND'), money(2, 'VND')), -1);
    assert.equal(compareMoney(money(2, 'VND'), money(1, 'VND')), 1);
    assert.equal(compareMoney(money(1, 'VND'), money(1, 'VND')), 0);
    assert.equal(zero('VND').minor, 0);
  });
});
