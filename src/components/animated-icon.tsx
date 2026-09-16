import { Image } from 'expo-image';
import * as SplashScreen from 'expo-splash-screen';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, Keyframe, runOnJS } from 'react-native-reanimated';


const DURATION = 450;

/**
 * PHẢI khớp với cấu hình plugin expo-splash-screen trong app.json
 * (backgroundColor, image, imageWidth). Lớp phủ này nối tiếp splash native:
 * lệch một pixel hay một sắc trắng là người dùng thấy logo "giật" lúc app mở.
 * Đây là ngoại lệ hợp lệ của luật token — splash native không đọc được CSS.
 */
const SPLASH_BACKGROUND = '#FFFFFF';
const SPLASH_IMAGE_WIDTH = 140;

const fadeOut = new Keyframe({
  0: { opacity: 1, transform: [{ scale: 1 }] },
  100: { opacity: 0, transform: [{ scale: 1.08 }], easing: Easing.out(Easing.quad) },
});

/**
 * Làm mờ dần splash thay vì tắt phụt.
 *
 * Splash native biến mất ngay khi gọi hideAsync; nếu React chưa vẽ xong màn đầu
 * thì sẽ chớp một khung trắng. Lớp phủ giống hệt splash được vẽ trước, rồi mới
 * ẩn splash native và mờ dần lớp phủ.
 */
export function AnimatedSplashOverlay() {
  const [animate, setAnimate] = useState(false);
  const [visible, setVisible] = useState(true);

  if (!visible) return null;

  const image = (
    <Image
      style={styles.image}
      source={require('@/assets/images/splash-icon.png')}
      contentFit="contain"
      accessibilityIgnoresInvertColors
    />
  );

  return animate ? (
    <Animated.View
      pointerEvents="none"
      entering={fadeOut.duration(DURATION).withCallback((finished) => {
        'worklet';
        if (finished) {
          runOnJS(setVisible)(false);
        }
      })}
      style={styles.splashOverlay}>
      {image}
    </Animated.View>
  ) : (
    <View
      onLayout={() => {
        SplashScreen.hideAsync().finally(() => {
          setAnimate(true);
        });
      }}
      style={styles.splashOverlay}>
      {image}
    </View>
  );
}

const styles = StyleSheet.create({
  image: {
    width: SPLASH_IMAGE_WIDTH,
    height: SPLASH_IMAGE_WIDTH,
  },
  splashOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: SPLASH_BACKGROUND,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
});
