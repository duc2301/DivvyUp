import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { addDays, dateRange, dayName, planTripForecast, shortDate } from './forecast-window.ts';
import { describeAqi, describeWeather } from './weather-codes.ts';

describe('planTripForecast', () => {
  const today = '2026-09-17';

  it('chuyến còn xa hơn 7 ngày: chưa có dự báo, báo ngày bắt đầu xem được', () => {
    assert.deepEqual(planTripForecast({ startDate: '2026-09-30', endDate: '2026-10-02', today }), {
      kind: 'tooEarly',
      availableFrom: '2026-09-23',
    });
  });

  it('khởi hành đúng 7 ngày nữa: xem được ngày đầu', () => {
    assert.deepEqual(planTripForecast({ startDate: '2026-09-24', endDate: '2026-09-26', today }), {
      kind: 'available',
      days: ['2026-09-24'],
    });
  });

  it('chuyến sắp tới trong tuần: chỉ các ngày nằm trong cửa sổ dự báo', () => {
    assert.deepEqual(planTripForecast({ startDate: '2026-09-20', endDate: '2026-09-23', today }), {
      kind: 'available',
      days: ['2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23'],
    });
  });

  it('đang trong chuyến: bắt đầu từ hôm nay, không lấy ngày đã qua', () => {
    const plan = planTripForecast({ startDate: '2026-09-15', endDate: '2026-09-18', today });
    assert.deepEqual(plan, { kind: 'available', days: ['2026-09-17', '2026-09-18'] });
  });

  it('chuyến đã kết thúc', () => {
    assert.deepEqual(planTripForecast({ startDate: '2026-09-10', endDate: '2026-09-16', today }), {
      kind: 'ended',
    });
  });

  it('chuyến chưa đặt ngày: dự báo từ hôm nay trong cả cửa sổ', () => {
    const plan = planTripForecast({ startDate: null, endDate: null, today });
    assert.equal(plan.kind, 'available');
    if (plan.kind === 'available') {
      assert.equal(plan.days[0], today);
      assert.equal(plan.days.length, 8);
    }
  });

  it('chỉ có ngày bắt đầu: coi như chuyến một ngày', () => {
    assert.deepEqual(planTripForecast({ startDate: '2026-09-19', endDate: null, today }), {
      kind: 'available',
      days: ['2026-09-19'],
    });
  });
});

describe('tiện ích ngày', () => {
  it('cộng ngày qua tháng và năm', () => {
    assert.equal(addDays('2026-09-28', 5), '2026-10-03');
    assert.equal(addDays('2026-12-31', 1), '2027-01-01');
    assert.deepEqual(dateRange('2026-02-27', '2026-03-01'), [
      '2026-02-27',
      '2026-02-28',
      '2026-03-01',
    ]);
  });

  it('tên ngày', () => {
    assert.equal(dayName('2026-09-17', '2026-09-17'), 'Hôm nay');
    assert.equal(dayName('2026-09-18', '2026-09-17'), 'Ngày mai');
    assert.equal(dayName('2026-09-19', '2026-09-17'), 'Thứ 7');
    assert.equal(dayName('2026-09-20', '2026-09-17', false), 'CN');
    assert.equal(shortDate('2026-09-05'), '5/9');
  });
});

describe('mô tả thời tiết', () => {
  it('trời quang ban ngày là nắng, ban đêm thì không', () => {
    assert.equal(describeWeather(0, true).label, 'Nắng');
    assert.equal(describeWeather(0, false).label, 'Trời quang');
  });

  it('mã mưa, dông và mã lạ', () => {
    assert.deepEqual(describeWeather(61), { label: 'Mưa nhẹ', kind: 'rain' });
    assert.equal(describeWeather(95).kind, 'thunder');
    assert.equal(describeWeather(1234).kind, 'unknown');
    assert.equal(describeWeather(null).kind, 'unknown');
  });

  it('ngưỡng AQI', () => {
    assert.equal(describeAqi(50).tone, 'good');
    assert.equal(describeAqi(51).tone, 'moderate');
    assert.equal(describeAqi(151).tone, 'unhealthy');
    assert.equal(describeAqi(301).tone, 'hazardous');
  });
});
