import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  describeOAuthError,
  describeRedirectError,
  isOAuthCancellation,
  parseAuthRedirect,
} from './auth-redirect.ts';

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
      error: null,
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

describe('redirect của đăng nhập Google', () => {
  it('đọc được mã PKCE và sb_flow_id từ link quay về app', () => {
    const redirect = parseAuthRedirect('divvyup://sign-in?oauth=1&code=abc123&sb_flow_id=flow-9');
    assert.equal(redirect?.code, 'abc123');
    assert.equal(redirect?.flowId, 'flow-9');
    assert.equal(redirect?.errorCode, null);
  });

  it('bấm Huỷ ở Google → access_denied, không có mã', () => {
    const redirect = parseAuthRedirect(
      'divvyup://sign-in?oauth=1&error=access_denied&error_description=The+user+denied',
    );
    assert.equal(redirect?.errorCode, 'access_denied');
    assert.equal(redirect?.code, null);
  });

  it('không bao giờ hiện error_description do người khác soạn trên URL', () => {
    const redirect = parseAuthRedirect(
      'https://divvyup.vn/sign-in?oauth=1&error=server_error&error_description=T%C3%A0i+kho%E1%BA%A3n+b%E1%BB%8B+kho%C3%A1%2C+chuy%E1%BB%83n+50.000%C4%91',
    );
    assert.ok(redirect);
    const message = describeRedirectError(redirect);
    assert.doesNotMatch(message, /50\.000|khoá, chuyển/);
  });

  it('link Google không có mã cũng không có lỗi → coi như không có dữ liệu auth', () => {
    assert.equal(parseAuthRedirect('divvyup://sign-in?oauth=1'), null);
  });
});

describe('isOAuthCancellation / describeOAuthError', () => {
  it('Huỷ ở Google (access_denied, không mã riêng) → là huỷ', () => {
    const plain = parseAuthRedirect('divvyup://sign-in?oauth=1&error=access_denied');
    const sameCode = parseAuthRedirect('divvyup://sign-in?oauth=1&error=access_denied&error_code=access_denied');
    assert.ok(plain && sameCode);
    assert.equal(isOAuthCancellation(plain), true);
    assert.equal(isOAuthCancellation(sameCode), true);
  });

  it('GoTrue gắn mã riêng vào access_denied (vd user_banned) → là lỗi, không nuốt', () => {
    const banned = parseAuthRedirect('divvyup://sign-in?oauth=1&error=access_denied&error_code=user_banned');
    assert.ok(banned);
    assert.equal(isOAuthCancellation(banned), false);
    assert.match(describeOAuthError(banned), /Google/);
  });

  it('lỗi khác không phải huỷ; câu lỗi nói về Google, không bảo gửi lại email', () => {
    const redirect = parseAuthRedirect('divvyup://sign-in?oauth=1&error=server_error&error_description=x');
    assert.ok(redirect);
    assert.equal(isOAuthCancellation(redirect), false);
    const message = describeOAuthError(redirect);
    assert.match(message, /Google/);
    assert.doesNotMatch(message, /email mới/);
  });

  it('email Google chưa xác minh có câu riêng', () => {
    const redirect = parseAuthRedirect(
      'divvyup://sign-in?oauth=1&error=access_denied&error_code=provider_email_needs_verification',
    );
    assert.ok(redirect);
    // Không bị coi là huỷ → câu lỗi riêng tới được người dùng.
    assert.equal(isOAuthCancellation(redirect), false);
    assert.match(describeOAuthError(redirect), /chưa được xác minh/);
  });
});
