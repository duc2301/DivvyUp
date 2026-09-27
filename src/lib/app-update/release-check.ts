/**
 * Kiểm "có APK mới cần cài không" — phần thuần: đọc GitHub Release mới nhất,
 * so runtime của nó với runtime của app đang chạy. Không import React Native,
 * để test bằng node --test.
 *
 * Vì sao cần: OTA (expo-updates) chỉ thay được JavaScript. Khi phần native đổi
 * (thêm plugin, nâng SDK), bản OTA mới mang runtime khác và APK cũ KHÔNG nhận
 * được nữa — app cũ đứng yên mãi mà người dùng không biết. Workflow
 * auto-release đã ghi dấu runtime vào ghi chú mỗi Release và đính APK; ở đây
 * chỉ việc đọc lại.
 *
 * Máy đã tụt lại runtime cũ — đúng nhóm code này nhắm tới — không nhận OTA
 * nào nữa, nên bản code này trên máy họ KHÔNG vá được: mọi kiểm tra ở đây phải
 * chặt ngay từ đầu.
 */

/**
 * Gọi theo ID SỐ của repo duc2301/DivvyUp, không theo tên: tên tài khoản/repo
 * đổi thì người khác đăng ký lại được tên cũ (repo-jacking) và mọi APK đã phát
 * sẽ hỏi repo của họ. ID số không bao giờ trỏ sang repo khác. Repo đổi tên thì
 * URL tải mang tên mới, không khớp APK_URL bên dưới → app im lặng, không báo.
 */
export const LATEST_RELEASE_API = 'https://api.github.com/repositories/1370980477/releases/latest';

const TAG = /^v\d{1,4}\.\d{1,4}\.\d{1,4}$/;

/**
 * Link tải APK phải khớp ĐÚNG khuôn workflow build-apk-release tạo ra — khớp cả
 * chuỗi, không dùng startsWith (`.../download/../../attacker/...` qua được
 * startsWith rồi được trình duyệt chuẩn hoá sang repo khác). Tên file có thể
 * mang tag cũ hơn tag Release: bản không đổi native được gắn lại APK cũ.
 */
const APK_URL =
  /^https:\/\/github\.com\/duc2301\/DivvyUp\/releases\/download\/(v\d{1,4}\.\d{1,4}\.\d{1,4})\/DivvyUp-v\d{1,4}\.\d{1,4}\.\d{1,4}\.apk$/;

const RUNTIME = /^[A-Za-z0-9._-]{1,128}$/;

/** Link tải APK đáng tin cho Release `tag`. Dùng lúc parse, lúc đọc cache và ngay trước khi mở. */
export function isTrustedApkUrl(url: unknown, tag: string): url is string {
  if (typeof url !== 'string' || !TAG.test(tag)) return false;
  const match = APK_URL.exec(url);
  return match !== null && match[1] === tag;
}

/** So hai phiên bản dạng 1.2.3 (bỏ tiền tố v): 1 / 0 / -1, không đọc được → null. */
export function compareVersions(a: string, b: string): number | null {
  const parse = (value: string): number[] | null => {
    const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(value.trim());
    return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
  };
  const left = parse(a);
  const right = parse(b);
  if (!left || !right) return null;
  for (let i = 0; i < 3; i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

/**
 * Cùng định dạng với runtimeMarker() trong scripts/release/semver.mjs (bên
 * GHI). Hai bên lệch nhau thì app không bao giờ báo APK mới — test
 * release-check.test.ts ghi bằng bên kia rồi đọc bằng bên này để giữ khớp.
 * Lấy dấu CUỐI CÙNG: dấu thật do workflow ghi ở cuối ghi chú.
 */
export function readRuntimeMarker(notes: string | null | undefined): string | null {
  const pattern = /<!--\s*divvyup-runtime:\s*([A-Za-z0-9._-]+)\s*-->/g;
  let last: string | null = null;
  for (const match of (notes ?? '').matchAll(pattern)) last = match[1] ?? null;
  return last;
}

export interface ReleaseInfo {
  readonly tag: string;
  /** Runtime của code trong Release này; null nếu Release không có dấu. */
  readonly runtime: string | null;
  /** Link tải APK đính kèm; null nếu chưa có (đang build) hoặc URL lạ. */
  readonly apkUrl: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Đọc JSON của GitHub `releases/latest`. Hình dạng lạ → null (coi như không biết). */
export function parseLatestRelease(json: unknown): ReleaseInfo | null {
  if (!isRecord(json) || typeof json.tag_name !== 'string' || !TAG.test(json.tag_name)) return null;
  if (json.draft === true || json.prerelease === true) return null;
  const tag = json.tag_name;

  let apkUrl: string | null = null;
  if (Array.isArray(json.assets)) {
    for (const asset of json.assets) {
      if (isRecord(asset) && isTrustedApkUrl(asset.browser_download_url, tag)) {
        apkUrl = asset.browser_download_url;
        break;
      }
    }
  }

  return {
    tag,
    runtime: readRuntimeMarker(typeof json.body === 'string' ? json.body : null),
    apkUrl,
  };
}

/**
 * Kiểm lại một ReleaseInfo đọc từ cache (AsyncStorage): dữ liệu trên máy không
 * đáng tin hơn JSON từ mạng, và hình dạng có thể là của bản app cũ. Sai → null.
 */
export function revalidateRelease(value: unknown): ReleaseInfo | null {
  if (!isRecord(value) || typeof value.tag !== 'string' || !TAG.test(value.tag)) return null;
  const runtime = typeof value.runtime === 'string' && RUNTIME.test(value.runtime) ? value.runtime : null;
  const apkUrl = isTrustedApkUrl(value.apkUrl, value.tag) ? value.apkUrl : null;
  return { tag: value.tag, runtime, apkUrl };
}

export type NativeUpdate =
  | { readonly kind: 'none' }
  | { readonly kind: 'apk'; readonly tag: string; readonly apkUrl: string };

/**
 * Có cần cài APK mới không: Release mới nhất mang runtime KHÁC app đang chạy,
 * có APK để tải, và MỚI HƠN phiên bản đang chạy. Thiếu bất cứ thông tin nào →
 * không báo (thà im còn hơn đòi người dùng cài lại vô cớ).
 *
 * `runningVersion`: phiên bản của code đang chạy (Constants.expoConfig.version
 * — bản OTA mới nhất máy nhận được, hoặc bản gốc của APK). Runtime là hash,
 * không có thứ tự; so phiên bản để không bao giờ mời cài APK CŨ HƠN (Release
 * "latest" bị trỏ nhầm về bản cũ): Android từ chối vì versionCode thấp hơn,
 * người dùng dễ gỡ app để cài và mất dữ liệu khách.
 */
export function decideNativeUpdate(
  currentRuntime: string | null,
  runningVersion: string | null,
  release: ReleaseInfo | null,
  dismissedTag: string | null,
): NativeUpdate {
  if (!currentRuntime || !runningVersion || !release || !release.runtime || !release.apkUrl) {
    return { kind: 'none' };
  }
  if (release.runtime === currentRuntime) return { kind: 'none' };
  if (compareVersions(release.tag, runningVersion) !== 1) return { kind: 'none' };
  if (dismissedTag === release.tag) return { kind: 'none' };
  return { kind: 'apk', tag: release.tag, apkUrl: release.apkUrl };
}

export const NATIVE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** Release đã đổi runtime nhưng APK còn đang build (15–30 phút): hỏi lại sớm. */
export const APK_PENDING_INTERVAL_MS = 60 * 60 * 1000;
/** "Để sau" ở thẻ APK: nhắc lại sau chừng này — kẹt runtime cũ là không nhận OTA nào nữa. */
export const APK_SNOOZE_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * Tới lúc hỏi GitHub chưa: tối đa mỗi ngày một lần (API không token: 60
 * lượt/giờ mỗi IP) — trừ khi lần trước thấy Release đổi runtime mà chưa có APK.
 */
export function isCheckDue(
  lastCheckedAt: number | null,
  now: number,
  cached: ReleaseInfo | null,
  currentRuntime: string | null,
): boolean {
  if (lastCheckedAt === null || !Number.isFinite(lastCheckedAt)) return true;
  // Đồng hồ máy bị chỉnh lùi → coi như đến hạn, đừng khoá việc kiểm mãi.
  if (now < lastCheckedAt) return true;
  const apkPending =
    cached !== null && cached.runtime !== null && cached.runtime !== currentRuntime && cached.apkUrl === null;
  return now - lastCheckedAt >= (apkPending ? APK_PENDING_INTERVAL_MS : NATIVE_CHECK_INTERVAL_MS);
}

/** Tag đang được "Để sau" (còn hạn), hoặc null. `value` đọc từ kho máy — kiểm hình dạng. */
export function activeSnooze(value: unknown, now: number): string | null {
  if (!isRecord(value) || typeof value.tag !== 'string' || typeof value.at !== 'number') return null;
  if (!Number.isFinite(value.at) || now < value.at || now - value.at >= APK_SNOOZE_MS) return null;
  return value.tag;
}

/**
 * Dòng phiên bản cho người dùng. Số trong Cài đặt Android là của APK và không
 * đổi qua OTA. Bản OTA thì KHÔNG ghi số: manifest OTA được dựng trước khi
 * workflow tăng số phiên bản, nên số của nó chậm một bản — ghi ngày thay vì số
 * sai.
 */
export function runningVersionLabel(input: {
  readonly version: string | null;
  readonly updateCreatedAt: Date | null;
  readonly isEmbeddedLaunch: boolean;
  readonly formatDate: (date: Date) => string;
}): string {
  if (!input.isEmbeddedLaunch && input.updateCreatedAt) {
    return `Bản cập nhật ${input.formatDate(input.updateCreatedAt)}`;
  }
  return input.version ? `Phiên bản ${input.version} (bản gốc của APK)` : 'Phiên bản không rõ';
}
