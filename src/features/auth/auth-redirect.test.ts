import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { describeRedirectError, parseAuthRedirect } from './auth-redirect.ts';

describe('parseAuthRedirect', () => {
  it('trả null với URL không mang dữ liệu auth', () => {
    assert.equal(parseAuthRedirect(null), null);
    assert.equal(parseAuthRedirect('divvyup://sign-in'), null);
    assert.equal(parseAuthRedirect('divvyup://sign-in?confirmed=1'), null);
  });

  it('đọc token khôi phục mật khẩu nằm trong hash', () => {
    const result = parseAuthRedirect(
      'divvyup://reset-password#access_token=abc&expires_in=3600&refresh_token=def&token_type=bearer&type=recovery',
    );
    assert.deepEqual(result, {
      code: null,
      flowId: null,
      accessToken: 'abc',
      refreshToken: 'def',
      type: 'recovery',
      errorCode: null,
      errorDescription: null,
    });
  });

  it('giữ nguyên query của app khi có cả hash (link xác nhận đăng ký)', () => {
    const result = parseAuthRedirect(
      'exp://192.168.1.5:8081/--/sign-in?confirmed=1#access_token=a&refresh_token=b&type=signup',
    );
    assert.equal(result?.type, 'signup');
    assert.equal(result?.accessToken, 'a');
  });

  it('đọc lỗi link hết hạn ở hash', () => {
    const result = parseAuthRedirect(
      'http://localhost:8081/reset-password#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired',
    );
    assert.equal(result?.errorCode, 'otp_expired');
    assert.equal(result?.errorDescription, 'Email link is invalid or has expired');
    assert.match(describeRedirectError(result!), /hết hạn/);
  });

  it('đọc lỗi nằm ở query', () => {
    const result = parseAuthRedirect('divvyup://sign-in?error=access_denied&error_description=x');
    assert.equal(result?.errorCode, 'access_denied');
  });

  it('đọc mã PKCE và flow id ở query', () => {
    const result = parseAuthRedirect(
      'divvyup://reset-password?code=9f1c2a&sb_flow_id=0b8e7d3c-1111-4222-8333-444455556666',
    );
    assert.equal(result?.code, '9f1c2a');
    assert.equal(result?.flowId, '0b8e7d3c-1111-4222-8333-444455556666');
    assert.equal(result?.accessToken, null);
  });

  it('coi giá trị rỗng là không có', () => {
    assert.equal(parseAuthRedirect('divvyup://sign-in#access_token=&error='), null);
  });
});
