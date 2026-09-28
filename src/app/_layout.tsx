import '@/global.css';
import '@/lib/nativewind-interop';

import { BeVietnamPro_600SemiBold, useFonts } from '@expo-google-fonts/be-vietnam-pro';
import {
  DarkTheme,
  DefaultTheme,
  Stack,
  ThemeProvider as NavigationThemeProvider,
  useGlobalSearchParams,
  useRouter,
  useSegments,
} from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useRef } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { SessionProvider, useSessionContext } from '@/features/auth/session-context';
import { ThemeProvider, useTheme } from '@/features/theme/theme-context';

SplashScreen.preventAutoHideAsync();

/**
 * Nền của navigation container. Đây là HAI giá trị duy nhất phải nhắc lại bên
 * ngoài global.css, vì react-navigation nhận màu qua đối tượng JS chứ không
 * đọc được CSS variable. Chúng chỉ lộ ra trong khoảnh khắc chuyển màn.
 * Phải khớp với --background trong src/global.css.
 */
const LIGHT_BACKGROUND = '#FFFFFF';
const DARK_BACKGROUND = '#0F172A';

/** Màn mở được khi chưa đăng nhập. */
const PUBLIC_SCREENS = new Set(['sign-in', 'forgot-password', 'reset-password']);

/** Cổng tài khoản mới qua Google: chưa đặt mật khẩu thì chỉ ở màn này. */
const SET_PASSWORD_SCREEN = 'set-password';

/**
 * Màn KHÔNG bị cổng đặt mật khẩu chặn: luồng "Quên mật khẩu" của tài khoản chỉ
 * có Google tạo phiên khôi phục — để nó đặt mật khẩu ở reset-password như bình
 * thường (rồi đăng xuất mọi thiết bị), không kéo sang set-password.
 */
const GATE_EXEMPT_SCREENS = new Set([SET_PASSWORD_SCREEN, 'reset-password']);

/**
 * Màn chỉ dành cho người CHƯA đăng nhập — đã vào app rồi thì đẩy về trang chủ.
 * reset-password cố ý KHÔNG nằm đây: link đặt lại mật khẩu tự tạo phiên đăng
 * nhập, đẩy đi thì người dùng không bao giờ tới được ô nhập mật khẩu mới.
 */
const SIGNED_OUT_ONLY = new Set(['sign-in', 'forgot-password']);

function AuthGate() {
  const { session, loading, isGuest, setGuestMode, needsPassword } = useSessionContext();
  const segments = useSegments();
  const router = useRouter();
  const params = useGlobalSearchParams<{ confirmed?: string; reset?: string }>();
  const fromEmailLink =
    params.confirmed === '1' || params.reset === '1' || params.reset === 'local';
  // Đã xét việc tắt chế độ khách cho lần mở từ link này chưa. Không có chốt,
  // bấm "Tiếp tục với tư cách khách" ngay trên màn đó bật cờ lên rồi bị chính
  // nhánh bên dưới tắt đi — nút trông như không làm gì.
  const guestClearedForLink = useRef(false);

  useEffect(() => {
    if (loading) return;

    const screen = segments[0] ?? '';
    const canUseApp = session !== null || isGuest;

    // Khách bấm link trong email (xác nhận đăng ký, đổi mật khẩu xong): họ đang
    // muốn dùng tài khoản. Tắt chế độ khách thay vì đá về trang chủ, không thì
    // thông báo "đăng ký thành công" không bao giờ hiện ra.
    if (!fromEmailLink) {
      guestClearedForLink.current = false;
    } else if (screen === 'sign-in' && !guestClearedForLink.current) {
      // Chỉ xét ĐÚNG MỘT LẦN, lúc màn vừa mở từ link: sau đó người dùng tự
      // bấm "Tiếp tục với tư cách khách" thì phải được tôn trọng.
      guestClearedForLink.current = true;
      if (session === null && isGuest) {
        void setGuestMode(false);
        return;
      }
    }

    // Cổng đặt mật khẩu — trước mọi màn khác, kể cả deep link /trip/... hay
    // /join. needsPassword null = đang kiểm với máy chủ: chưa điều hướng gì.
    if (session !== null) {
      if (needsPassword === null) return;
      if (needsPassword) {
        if (!GATE_EXEMPT_SCREENS.has(screen)) router.replace('/set-password');
        return;
      }
      if (screen === SET_PASSWORD_SCREEN) {
        router.replace('/');
        return;
      }
    } else if (screen === SET_PASSWORD_SCREEN) {
      // Màn đặt mật khẩu cần phiên; hết phiên (bấm Huỷ đăng xuất) thì về đăng nhập.
      router.replace('/sign-in');
      return;
    }

    if (!canUseApp && !PUBLIC_SCREENS.has(screen)) {
      router.replace('/sign-in');
    } else if (canUseApp && SIGNED_OUT_ONLY.has(screen)) {
      // isGuest PHẢI nằm trong điều kiện này. Thiếu nó, bấm "tiếp tục với tư
      // cách khách" chỉ bật được cờ mà không bao giờ rời khỏi màn đăng nhập.
      router.replace('/');
    }
    // setGuestMode cố ý không nằm trong deps: hàm được tạo lại mỗi render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, loading, isGuest, needsPassword, JSON.stringify(segments), router, fromEmailLink]);

  // Mọi màn hình tự vẽ header bằng AppHeader để giữ màu trong một bảng token
  // duy nhất, nên tắt header mặc định của Stack.
  return (
    // View flex-1 là khung định vị cho lớp che — không trông vào cấu trúc ẩn
    // mà expo-router dựng bên ngoài.
    <View className="flex-1">
      <Stack screenOptions={{ headerShown: false }} />
      {/* Che màn bên dưới khi đang hỏi máy chủ "đã có mật khẩu chưa", hoặc
          đã biết phải đặt mật khẩu mà màn hiện tại chưa phải màn đặt mật khẩu
          (effect của màn con chạy trước AuthGate — không che thì màn đích chớp
          lên). Tài khoản chỉ dùng mật khẩu qua bước kiểm không gọi mạng. */}
      {session !== null &&
      (needsPassword === null ||
        (needsPassword && !GATE_EXEMPT_SCREENS.has(segments[0] ?? ''))) ? (
        <View
          accessibilityViewIsModal
          importantForAccessibility="yes"
          accessibilityLabel="Đang kiểm tra tài khoản"
          className="absolute inset-0 items-center justify-center bg-background">
          <ActivityIndicator />
        </View>
      ) : null}
    </View>
  );
}

/**
 * Tách riêng vì phải nằm BÊN TRONG ThemeProvider mới đọc được chế độ màu đang
 * áp dụng — kể cả khi người dùng đã ghi đè bằng nút bật tắt.
 */
function ThemedApp() {
  const { effective } = useTheme();
  const isDark = effective === 'dark';

  const base = isDark ? DarkTheme : DefaultTheme;
  const navigationTheme = {
    ...base,
    colors: {
      ...base.colors,
      background: isDark ? DARK_BACKGROUND : LIGHT_BACKGROUND,
      card: isDark ? DARK_BACKGROUND : LIGHT_BACKGROUND,
    },
  };

  return (
    <NavigationThemeProvider value={navigationTheme}>
      <SessionProvider>
        <AnimatedSplashOverlay />
        <AuthGate />
      </SessionProvider>
    </NavigationThemeProvider>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({ BeVietnamPro_600SemiBold });

  // Tải font lỗi thì vẫn cho app chạy với font hệ thống — mất kiểu chữ ở tiêu
  // đề còn hơn kẹt ở màn hình trắng vĩnh viễn.
  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <ThemedApp />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
