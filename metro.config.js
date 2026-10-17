const path = require('node:path');

const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);

// Yjs (đồng soạn ghi chú) → lib0/webcrypto. Bản react-native của lib0 đòi gói
// `isomorphic-webcrypto` (module native — đổi fingerprint, buộc build APK) mà
// repo không có. Trỏ về shim JS thuần; bản web giữ nguyên webcrypto của trình duyệt.
const LIB0_WEBCRYPTO_SHIM = path.resolve(__dirname, 'src/lib/polyfills/lib0-webcrypto.ts');
const defaultResolve = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'lib0/webcrypto' && platform !== 'web') {
    return { type: 'sourceFile', filePath: LIB0_WEBCRYPTO_SHIM };
  }
  return defaultResolve
    ? defaultResolve(context, moduleName, platform)
    : context.resolveRequest(context, moduleName, platform);
};

module.exports = withNativeWind(config, { input: './src/global.css' });
