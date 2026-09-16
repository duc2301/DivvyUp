/**
 * Đăng ký className cho component bên thứ ba mà NativeWind không tự biết.
 *
 * NativeWind chỉ tự chuyển className → style cho component lõi của React Native
 * (View, Text, Image của RN…). `Image` của expo-image là component native riêng:
 * không đăng ký thì trên web vẫn chạy (react-native-web nhận class), nhưng trên
 * Android/iOS className bị bỏ qua IM LẶNG — ảnh không có kích thước và biến mất.
 *
 * File được import MỘT lần ở src/app/_layout.tsx, trước khi màn nào render.
 * Icon lucide đăng ký riêng trong src/components/ui/icons.ts.
 */

import { Image } from 'expo-image';
import { cssInterop } from 'nativewind';

cssInterop(Image, { className: 'style' });
