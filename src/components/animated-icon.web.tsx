/**
 * Web không có splash native để nối tiếp, nên không cần lớp phủ.
 * File tồn tại để Metro chọn bản này thay cho bản native (Reanimated keyframe +
 * expo-splash-screen) khi build web.
 */
export function AnimatedSplashOverlay() {
  return null;
}
