/**
 * Cấu hình fingerprint (runtimeVersion policy "fingerprint" trong app.json).
 *
 * Bỏ `version` / `versionCode` khỏi fingerprint: số phiên bản tự tăng theo mỗi
 * lần phát hành (xem .github/workflows/auto-release.yml). Nếu version nằm trong
 * fingerprint thì mỗi lần tăng số là một runtime mới — bản OTA không còn tới
 * được máy đang cài APK cũ, dù phần native không đổi gì.
 *
 * ĐỔI FILE NÀY LÀ ĐỔI FINGERPRINT: phải build và phát hành APK mới.
 */
/** @type {import('expo/fingerprint').Config} */
const config = {
  sourceSkips: ['ExpoConfigVersions'],
};
module.exports = config;
