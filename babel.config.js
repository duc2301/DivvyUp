module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      // jsxImportSource: nativewind là thứ làm cho prop className hoạt động trên
      // component React Native. Thiếu dòng này thì className bị bỏ qua im lặng.
      ['babel-preset-expo', { jsxImportSource: 'nativewind' }],
      'nativewind/babel',
    ],
    // Không khai báo react-native-worklets/plugin ở đây: babel-preset-expo đã tự
    // thêm khi phát hiện reanimated. Thêm tay sẽ thành plugin trùng.
  };
};
