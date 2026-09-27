import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

// Bên GHI dấu runtime (workflow auto-release). Test giữ hai bên cùng định dạng.
import { runtimeMarker } from '../../../scripts/release/semver.mjs';

import {
  activeSnooze,
  APK_PENDING_INTERVAL_MS,
  APK_SNOOZE_MS,
  compareVersions,
  decideNativeUpdate,
  isCheckDue,
  isTrustedApkUrl,
  NATIVE_CHECK_INTERVAL_MS,
  parseLatestRelease,
  readRuntimeMarker,
  revalidateRelease,
  runningVersionLabel,
} from './release-check.ts';

const BASE = 'https://github.com/duc2301/DivvyUp/releases/download';
const APK = `${BASE}/v1.2.0/DivvyUp-v1.2.0.apk`;

function releaseJson(overrides: Record<string, unknown> = {}) {
  return {
    tag_name: 'v1.2.0',
    draft: false,
    prerelease: false,
    body: `### Tính năng mới\n- Lưu trữ chuyến đi\n\n${runtimeMarker('abc123')}\n`,
    assets: [{ name: 'DivvyUp-v1.2.0.apk', browser_download_url: APK }],
    ...overrides,
  };
}

describe('readRuntimeMarker', () => {
  test('đọc được đúng dấu do workflow ghi', () => {
    assert.equal(readRuntimeMarker(`ghi chú\n${runtimeMarker('319c7312')}`), '319c7312');
  });

  test('nhiều dấu → lấy dấu cuối (dấu thật ở cuối, dấu đầu có thể từ commit)', () => {
    assert.equal(readRuntimeMarker(`${runtimeMarker('cu')}\n...\n${runtimeMarker('moi')}`), 'moi');
  });

  test('không có dấu / rỗng → null', () => {
    assert.equal(readRuntimeMarker('không có gì'), null);
    assert.equal(readRuntimeMarker(null), null);
  });
});

describe('isTrustedApkUrl', () => {
  test('đúng khuôn workflow tạo ra', () => {
    assert.equal(isTrustedApkUrl(APK, 'v1.2.0'), true);
  });

  test('Release gắn lại APK của bản trước (không đổi native) — tên file mang tag cũ', () => {
    assert.equal(isTrustedApkUrl(`${BASE}/v1.1.2/DivvyUp-v1.1.1.apk`, 'v1.1.2'), true);
  });

  test('chặn đường vòng sang repo/host khác', () => {
    const bad = [
      `${BASE}/../../../../attacker/x/releases/download/v1.2.0/DivvyUp-v1.2.0.apk`,
      `${BASE}/v1.2.0/../../../../attacker/DivvyUp-v1.2.0.apk`,
      `${BASE}/%2e%2e/%2e%2e/v1.2.0/DivvyUp-v1.2.0.apk`,
      'https://github.com/attacker/DivvyUp/releases/download/v1.2.0/DivvyUp-v1.2.0.apk',
      'https://github.com/duc2301/DivvyUpX/releases/download/v1.2.0/DivvyUp-v1.2.0.apk',
      'https://evil.example/duc2301/DivvyUp/releases/download/v1.2.0/DivvyUp-v1.2.0.apk',
      'http://github.com/duc2301/DivvyUp/releases/download/v1.2.0/DivvyUp-v1.2.0.apk',
      `${APK}?x=1`,
      `${APK}#frag`,
      `intent://${APK.slice(8)}`,
    ];
    for (const url of bad) assert.equal(isTrustedApkUrl(url, 'v1.2.0'), false, url);
  });

  test('tag trong URL phải trùng tag Release; tag sai khuôn bị từ chối', () => {
    assert.equal(isTrustedApkUrl(APK, 'v1.2.1'), false);
    assert.equal(isTrustedApkUrl(APK, '1.2.0'), false);
    assert.equal(isTrustedApkUrl(123, 'v1.2.0'), false);
  });
});

describe('parseLatestRelease', () => {
  test('Release đủ thông tin', () => {
    assert.deepEqual(parseLatestRelease(releaseJson()), { tag: 'v1.2.0', runtime: 'abc123', apkUrl: APK });
  });

  test('chưa có APK (đang build) → apkUrl null', () => {
    assert.equal(parseLatestRelease(releaseJson({ assets: [] }))?.apkUrl, null);
  });

  test('APK không đúng khuôn → bỏ; lấy asset đúng khuôn đầu tiên', () => {
    const json = releaseJson({
      assets: [
        { name: 'DivvyUp.apk', browser_download_url: 'https://evil.example/DivvyUp.apk' },
        { name: 'source.zip', browser_download_url: `${BASE}/v1.2.0/source.zip` },
        { name: 'DivvyUp-v1.2.0.apk', browser_download_url: APK },
      ],
    });
    assert.equal(parseLatestRelease(json)?.apkUrl, APK);
  });

  test('draft / prerelease / tag sai khuôn / hình dạng lạ → null', () => {
    assert.equal(parseLatestRelease(releaseJson({ draft: true })), null);
    assert.equal(parseLatestRelease(releaseJson({ prerelease: true })), null);
    assert.equal(parseLatestRelease(releaseJson({ tag_name: 'Cài ngay bản vá!' })), null);
    assert.equal(parseLatestRelease({ message: 'API rate limit exceeded' }), null);
    assert.equal(parseLatestRelease(null), null);
    assert.equal(parseLatestRelease('x'), null);
  });

  test('assets hỏng không làm văng lỗi', () => {
    assert.equal(parseLatestRelease(releaseJson({ assets: [null, 1, {}] }))?.apkUrl, null);
  });
});

describe('revalidateRelease — dữ liệu cache trên máy', () => {
  test('cache hợp lệ giữ nguyên', () => {
    const release = { tag: 'v1.2.0', runtime: 'abc123', apkUrl: APK };
    assert.deepEqual(revalidateRelease(release), release);
  });

  test('cache bị sửa URL / runtime lạ / hình dạng cũ → gỡ phần đáng ngờ', () => {
    assert.equal(revalidateRelease({ tag: 'v1.2.0', runtime: 'abc', apkUrl: 'intent://x' })?.apkUrl, null);
    assert.equal(revalidateRelease({ tag: 'v1.2.0', runtime: '<script>', apkUrl: APK })?.runtime, null);
    assert.equal(revalidateRelease({ tag: 'latest', runtime: 'abc', apkUrl: APK }), null);
    assert.equal(revalidateRelease('chuỗi'), null);
  });
});

describe('compareVersions', () => {
  test('so từng phần theo số, không theo chuỗi', () => {
    assert.equal(compareVersions('v1.10.0', '1.9.9'), 1);
    assert.equal(compareVersions('1.2.0', 'v1.2.0'), 0);
    assert.equal(compareVersions('1.1.2', '1.2.0'), -1);
  });

  test('không đọc được → null', () => {
    assert.equal(compareVersions('abc', '1.0.0'), null);
  });
});

describe('decideNativeUpdate', () => {
  const release = parseLatestRelease(releaseJson());

  test('runtime khác + có APK + mới hơn → báo cài APK', () => {
    assert.deepEqual(decideNativeUpdate('319c7312', '1.1.2', release, null), {
      kind: 'apk',
      tag: 'v1.2.0',
      apkUrl: APK,
    });
  });

  test('cùng runtime → OTA lo được, không báo', () => {
    assert.equal(decideNativeUpdate('abc123', '1.1.2', release, null).kind, 'none');
  });

  test('Release "latest" cũ hơn hoặc bằng bản đang chạy → không mời cài APK cũ', () => {
    assert.equal(decideNativeUpdate('319c7312', '1.2.0', release, null).kind, 'none');
    assert.equal(decideNativeUpdate('319c7312', '1.3.0', release, null).kind, 'none');
  });

  test('đang "Để sau" đúng bản này → không báo; bản khác → báo', () => {
    assert.equal(decideNativeUpdate('319c7312', '1.1.2', release, 'v1.2.0').kind, 'none');
    assert.equal(decideNativeUpdate('319c7312', '1.1.2', release, 'v1.1.9').kind, 'apk');
  });

  test('thiếu thông tin → không báo', () => {
    assert.equal(decideNativeUpdate(null, '1.1.2', release, null).kind, 'none');
    assert.equal(decideNativeUpdate('319c7312', null, release, null).kind, 'none');
    assert.equal(decideNativeUpdate('319c7312', '1.1.2', null, null).kind, 'none');
    const noMarker = parseLatestRelease(releaseJson({ body: 'không dấu' }));
    assert.equal(decideNativeUpdate('319c7312', '1.1.2', noMarker, null).kind, 'none');
    const noApk = parseLatestRelease(releaseJson({ assets: [] }));
    assert.equal(decideNativeUpdate('319c7312', '1.1.2', noApk, null).kind, 'none');
  });
});

describe('isCheckDue', () => {
  const now = 1_800_000_000_000;
  const withApk = { tag: 'v1.2.0', runtime: 'moi', apkUrl: APK };
  const apkBuilding = { tag: 'v1.2.0', runtime: 'moi', apkUrl: null };

  test('chưa kiểm lần nào → đến hạn', () => {
    assert.equal(isCheckDue(null, now, null, 'cu'), true);
  });

  test('bình thường: 24 giờ một lần', () => {
    assert.equal(isCheckDue(now - NATIVE_CHECK_INTERVAL_MS + 1, now, withApk, 'cu'), false);
    assert.equal(isCheckDue(now - NATIVE_CHECK_INTERVAL_MS, now, withApk, 'cu'), true);
  });

  test('Release đổi runtime mà APK còn đang build → hỏi lại sau 1 giờ', () => {
    assert.equal(isCheckDue(now - APK_PENDING_INTERVAL_MS, now, apkBuilding, 'cu'), true);
    assert.equal(isCheckDue(now - APK_PENDING_INTERVAL_MS + 1, now, apkBuilding, 'cu'), false);
  });

  test('chưa có APK nhưng CÙNG runtime (không cần APK) → vẫn 24 giờ', () => {
    assert.equal(isCheckDue(now - APK_PENDING_INTERVAL_MS, now, apkBuilding, 'moi'), false);
  });

  test('đồng hồ bị chỉnh lùi hoặc giá trị hỏng → đến hạn', () => {
    assert.equal(isCheckDue(now + 60_000, now, null, 'cu'), true);
    assert.equal(isCheckDue(Number.NaN, now, null, 'cu'), true);
  });
});

describe('activeSnooze', () => {
  const now = 1_800_000_000_000;

  test('trong hạn → trả tag; hết hạn → null', () => {
    assert.equal(activeSnooze({ tag: 'v1.2.0', at: now - 1000 }, now), 'v1.2.0');
    assert.equal(activeSnooze({ tag: 'v1.2.0', at: now - APK_SNOOZE_MS }, now), null);
  });

  test('dữ liệu hỏng / của bản app cũ (chuỗi trần) → null', () => {
    assert.equal(activeSnooze('v1.2.0', now), null);
    assert.equal(activeSnooze({ tag: 'v1.2.0', at: now + 1000 }, now), null);
    assert.equal(activeSnooze(null, now), null);
  });
});

describe('runningVersionLabel', () => {
  const formatDate = (date: Date) => date.toISOString().slice(0, 10);

  test('đang chạy bản OTA → ghi ngày cập nhật, không ghi số (số OTA chậm một bản)', () => {
    assert.equal(
      runningVersionLabel({
        version: '1.1.2',
        updateCreatedAt: new Date('2026-09-26T09:17:51Z'),
        isEmbeddedLaunch: false,
        formatDate,
      }),
      'Bản cập nhật 2026-09-26',
    );
  });

  test('đang chạy bản gốc trong APK → số phiên bản của APK', () => {
    assert.equal(
      runningVersionLabel({ version: '1.1.1', updateCreatedAt: null, isEmbeddedLaunch: true, formatDate }),
      'Phiên bản 1.1.1 (bản gốc của APK)',
    );
  });

  test('không đọc được số phiên bản', () => {
    assert.equal(
      runningVersionLabel({ version: null, updateCreatedAt: null, isEmbeddedLaunch: true, formatDate }),
      'Phiên bản không rõ',
    );
  });
});
