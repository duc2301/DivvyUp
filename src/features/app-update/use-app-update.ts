import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { useEffect, useRef, useState } from 'react';
import { AppState, Linking, Platform } from 'react-native';

import type { NativeUpdate, ReleaseInfo } from '@/lib/app-update/release-check';
import {
  activeSnooze,
  decideNativeUpdate,
  isCheckDue,
  isTrustedApkUrl,
  LATEST_RELEASE_API,
  parseLatestRelease,
  revalidateRelease,
} from '@/lib/app-update/release-check';

/**
 * Cập nhật app, hai tầng:
 *
 * 1. OTA (chỉ JavaScript): expo-updates tự tải bản mới lúc mở app nhưng chỉ áp
 *    dụng ở lần mở SAU — người dùng mở app thấy bản cũ và tưởng không cập
 *    nhật. Ở đây kiểm thêm mỗi khi app quay lại foreground; tải xong thì cho
 *    người dùng bấm "Khởi động lại" để áp dụng ngay. Không bao giờ tự khởi động
 *    lại, và thẻ chỉ hiện ở màn danh sách chuyến (không có form đang nhập).
 *
 * 2. APK (phần native đổi): OTA không tới được APK cũ. Hỏi GitHub Release mới
 *    nhất (mỗi ngày một lần, cả khi quay lại foreground), runtime khác app đang
 *    chạy → báo cài APK mới.
 *
 * Chỉ chạy trong APK thật: Updates.isEnabled (tắt ở Expo Go), không __DEV__,
 * không web (bản web của expo-updates đặt isEnabled = true nhưng web không có
 * APK — web thật là bản React/Vite ở web/), chỉ kênh preview.
 */
export const APP_UPDATE_ENABLED =
  Platform.OS === 'android' &&
  Updates.isEnabled &&
  !__DEV__ &&
  // Chỉ kênh `preview` — đúng kênh của APK phát qua GitHub Release
  // (build-apk-release.yml build --profile preview). Bản kênh khác (production
  // qua Play) KHÔNG được mời cài đè APK preview: khác chữ ký, người dùng dễ gỡ
  // app để cài và mất dữ liệu khách. Liệt kê kênh được phép, không loại trừ.
  Updates.channel === 'preview';

const OTA_CHECK_INTERVAL_MS = 15 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8000;
const KEY_RELEASE = 'divvyup_update_release';
const KEY_SNOOZE = 'divvyup_update_snooze';

interface CachedRelease {
  readonly checkedAt: number | null;
  readonly release: ReleaseInfo | null;
}

async function readJson(key: string): Promise<unknown> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    // Kho lỗi / chuỗi hỏng → như chưa có gì; tệ nhất là hỏi GitHub thêm một lần
    // hoặc thẻ "Để sau" hiện lại.
    return null;
  }
}

async function readCache(): Promise<CachedRelease> {
  const value = await readJson(KEY_RELEASE);
  if (typeof value !== 'object' || value === null) return { checkedAt: null, release: null };
  const { checkedAt, release } = value as Record<string, unknown>;
  return {
    checkedAt: typeof checkedAt === 'number' ? checkedAt : null,
    // Dữ liệu trên máy không đáng tin hơn JSON từ mạng: kiểm lại như mới.
    release: revalidateRelease(release),
  };
}

async function fetchLatestRelease(): Promise<ReleaseInfo | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(LATEST_RELEASE_API, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`GitHub trả ${response.status}`);
    return parseLatestRelease(await response.json());
  } finally {
    clearTimeout(timer);
  }
}

/** Kiểm APK: đọc cache, tới hạn thì hỏi GitHub, trả quyết định. */
async function checkNativeUpdate(): Promise<NativeUpdate> {
  const [cache, snooze] = await Promise.all([readCache(), readJson(KEY_SNOOZE)]);
  let release = cache.release;
  const now = Date.now();
  if (isCheckDue(cache.checkedAt, now, cache.release, Updates.runtimeVersion)) {
    try {
      release = await fetchLatestRelease();
      await AsyncStorage.setItem(
        KEY_RELEASE,
        JSON.stringify({ checkedAt: now, release } satisfies CachedRelease),
      );
    } catch {
      // GitHub không trả lời / hết lượt API (mạng di động dùng chung IP): dùng
      // kết quả lần trước, KHÔNG ghi checkedAt — lần sau hỏi lại. Không có gì
      // người dùng cần biết hay làm được.
    }
  }
  return decideNativeUpdate(
    Updates.runtimeVersion,
    Constants.expoConfig?.version ?? null,
    release,
    activeSnooze(snooze, now),
  );
}

export interface AppUpdateState {
  /** Bản OTA mới đã tải xong, khởi động lại là chạy. */
  readonly otaReady: boolean;
  readonly restart: () => void;
  readonly nativeUpdate: NativeUpdate;
  /** Mở link tải APK (trình duyệt tải, Android hỏi cài đè). */
  readonly openApk: () => void;
  /** Ẩn thẻ APK của bản này trong vài ngày (APK_SNOOZE_MS). */
  readonly snoozeNative: () => void;
  /** Lỗi mở link tải APK, để hiện trên thẻ. */
  readonly openError: string | null;
}

export function useAppUpdate(): AppUpdateState {
  const { isUpdatePending } = Updates.useUpdates();
  const [nativeUpdate, setNativeUpdate] = useState<NativeUpdate>({ kind: 'none' });
  const [openError, setOpenError] = useState<string | null>(null);
  const lastOtaCheck = useRef(0);
  // Một lượt kiểm APK một lúc: quay lại foreground trong lúc đang chờ GitHub
  // (tới 8 giây) không sinh thêm lượt gọi API.
  const nativeInFlight = useRef(false);
  // Tag vừa "Để sau" trong phiên này — thắng kết quả của lượt kiểm đã đọc kho
  // TRƯỚC khi người dùng bấm, và thắng cả khi lưu xuống máy bị lỗi.
  const snoozedNow = useRef<string | null>(null);

  useEffect(() => {
    if (!APP_UPDATE_ENABLED) return;
    let cancelled = false;

    const refreshNative = (): void => {
      if (nativeInFlight.current) return;
      nativeInFlight.current = true;
      void checkNativeUpdate()
        .then((next) => {
          if (cancelled) return;
          if (next.kind === 'apk' && next.tag === snoozedNow.current) return;
          setNativeUpdate(next);
        })
        .finally(() => {
          nativeInFlight.current = false;
        });
    };

    const checkOta = async (): Promise<void> => {
      const now = Date.now();
      if (now - lastOtaCheck.current < OTA_CHECK_INTERVAL_MS) return;
      lastOtaCheck.current = now;
      try {
        const result = await Updates.checkForUpdateAsync();
        // Tải xong, useUpdates() tự chuyển isUpdatePending = true.
        if (result.isAvailable) await Updates.fetchUpdateAsync();
      } catch {
        // Mất mạng / máy chủ Expo lỗi: bỏ qua có chủ đích. Lần mở sau
        // expo-updates tự kiểm lại; không có gì người dùng cần làm.
      }
    };

    // Lúc mở app expo-updates đã tự kiểm OTA (ON_LOAD) — chỉ đánh dấu thời
    // điểm; lần kiểm thêm đầu tiên là khi quay lại foreground.
    lastOtaCheck.current = Date.now();
    refreshNative();
    const subscription = AppState.addEventListener('change', (next) => {
      if (next !== 'active') return;
      void checkOta();
      // isCheckDue trong checkNativeUpdate giữ nhịp mỗi ngày một lần.
      refreshNative();
    });
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  const restart = (): void => {
    Updates.reloadAsync().catch(() => {
      // Không nạp lại được (hiếm): bản mới vẫn được áp dụng ở lần mở sau.
    });
  };

  const openApk = (): void => {
    if (nativeUpdate.kind !== 'apk') return;
    const { apkUrl, tag } = nativeUpdate;
    // Kiểm lại ngay trước khi mở — đây là chỗ duy nhất URL rời khỏi app.
    if (!isTrustedApkUrl(apkUrl, tag)) return;
    setOpenError(null);
    // Không mở được link (máy không có trình duyệt) → nói cho người dùng biết
    // và đưa link để tự mở, đừng để nút bấm như không có tác dụng.
    Linking.openURL(apkUrl).catch(() =>
      setOpenError(`Không mở được liên kết. Mở trình duyệt và vào: ${apkUrl}`),
    );
  };

  const snoozeNative = (): void => {
    if (nativeUpdate.kind !== 'apk') return;
    const { tag } = nativeUpdate;
    snoozedNow.current = tag;
    setNativeUpdate({ kind: 'none' });
    AsyncStorage.setItem(KEY_SNOOZE, JSON.stringify({ tag, at: Date.now() })).catch(() => {
      // Không lưu được: trong phiên này snoozedNow vẫn giữ thẻ ẩn; lần mở app
      // sau thẻ hiện lại — chấp nhận được.
    });
  };

  return {
    otaReady: APP_UPDATE_ENABLED && isUpdatePending,
    restart,
    nativeUpdate,
    openApk,
    snoozeNative,
    openError,
  };
}
