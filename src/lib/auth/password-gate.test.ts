import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  currentNeedsPassword,
  gateFromServer,
  isExistingAccountSignUp,
  gateProviders,
  mayNeedPassword,
  providersMayNeedPassword,
} from './password-gate.ts';

describe('mayNeedPassword — có cần hỏi máy chủ không', () => {
  test('chỉ email/mật khẩu → không hỏi, không bao giờ tới cổng', () => {
    assert.equal(mayNeedPassword({ identities: [{ provider: 'email' }] }), false);
  });

  test('chỉ Google (người mới) → hỏi', () => {
    assert.equal(mayNeedPassword({ identities: [{ provider: 'google' }] }), true);
  });

  test('email + Google (đã liên kết) → hỏi (máy chủ sẽ trả false vì đã có mật khẩu)', () => {
    assert.equal(mayNeedPassword({ identities: [{ provider: 'email' }, { provider: 'google' }] }), true);
  });

  test('thiếu identities → dùng app_metadata.providers', () => {
    assert.equal(mayNeedPassword({ app_metadata: { providers: ['google'] } }), true);
    assert.equal(mayNeedPassword({ identities: null, app_metadata: { providers: ['email'] } }), false);
  });

  test('không có user / không đọc được gì → không hỏi (không chặn nhầm)', () => {
    assert.equal(mayNeedPassword(null), false);
    assert.equal(mayNeedPassword({}), false);
    assert.equal(mayNeedPassword({ identities: [], app_metadata: { providers: 'google' } }), false);
  });
});

describe('gateFromServer — chặn ở cổng khi nào', () => {
  test('máy chủ trả true → chặn', () => {
    assert.equal(gateFromServer({ ok: true, value: true }), true);
  });

  test('máy chủ trả false → cho vào', () => {
    assert.equal(gateFromServer({ ok: true, value: false }), false);
  });

  test('lỗi mạng / RPC chưa có → cho vào (không ghi đè mật khẩu cũ vì chặn nhầm)', () => {
    assert.equal(gateFromServer({ ok: false }), false);
  });

  test('giá trị lạ (null, "true") → cho vào; chỉ đúng boolean true mới chặn', () => {
    assert.equal(gateFromServer({ ok: true, value: null }), false);
    assert.equal(gateFromServer({ ok: true, value: 'true' }), false);
  });
});

describe('isExistingAccountSignUp — "Tạo tài khoản" trùng email đã có', () => {
  test('identities rỗng → email đã có tài khoản', () => {
    assert.equal(isExistingAccountSignUp({ identities: [] }), true);
  });

  test('đăng ký mới thật → có identity email', () => {
    assert.equal(isExistingAccountSignUp({ identities: [{ provider: 'email' }] }), false);
  });

  test('không có user / thiếu identities → không kết luận', () => {
    assert.equal(isExistingAccountSignUp(null), false);
    assert.equal(isExistingAccountSignUp({}), false);
  });
});

describe('gateProviders — khoá "khi nào kiểm lại"', () => {
  test('sắp xếp và khử trùng: đổi thứ tự trả về không đổi khoá', () => {
    assert.deepEqual(gateProviders({ identities: [{ provider: 'google' }, { provider: 'email' }] }), ['email', 'google']);
    assert.deepEqual(gateProviders({ identities: [{ provider: 'email' }, { provider: 'google' }, { provider: 'google' }] }), ['email', 'google']);
  });

  test('vừa liên kết thêm Google → danh sách khác (kiểm lại)', () => {
    assert.notDeepEqual(gateProviders({ identities: [{ provider: 'email' }] }), gateProviders({ identities: [{ provider: 'email' }, { provider: 'google' }] }));
  });

  test('không có người dùng → rỗng; thiếu identities → app_metadata', () => {
    assert.deepEqual(gateProviders(null), []);
    assert.deepEqual(gateProviders({ app_metadata: { providers: ['google'] } }), ['google']);
  });

  test('providersMayNeedPassword khớp mayNeedPassword', () => {
    assert.equal(providersMayNeedPassword(['email']), false);
    assert.equal(providersMayNeedPassword(['email', 'google']), true);
    assert.equal(providersMayNeedPassword([]), false);
  });
});

describe('currentNeedsPassword — giá trị cổng cho người hiện tại', () => {
  test('không có người dùng → không chặn', () => {
    assert.equal(currentNeedsPassword(null, { userId: 'u1', value: true, certain: true }), false);
  });

  test('chưa kiểm xong → null (đang kiểm, che màn)', () => {
    assert.equal(currentNeedsPassword('u1', null), null);
  });

  test('kết quả của NGƯỜI KHÁC (vừa đổi tài khoản) không được dùng', () => {
    assert.equal(currentNeedsPassword('u2', { userId: 'u1', value: false, certain: true }), null);
  });

  test('kết quả đúng người → dùng', () => {
    assert.equal(currentNeedsPassword('u1', { userId: 'u1', value: true, certain: true }), true);
    assert.equal(currentNeedsPassword('u1', { userId: 'u1', value: false, certain: true }), false);
  });
});

describe('currentNeedsPassword — tài khoản chỉ dùng mật khẩu', () => {
  test('chỉ email → false ngay, không chờ kết quả kiểm (không chớp lớp che)', () => {
    assert.equal(currentNeedsPassword('u1', null, ['email']), false);
  });

  test('có Google mà chưa kiểm → null (đang kiểm)', () => {
    assert.equal(currentNeedsPassword('u1', null, ['email', 'google']), null);
  });
});
