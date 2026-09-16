import '@/global.css';

import { Poppins_600SemiBold, Poppins_700Bold, useFonts } from '@expo-google-fonts/poppins';
import {
  DarkTheme,
  DefaultTheme,
  Stack,
  ThemeProvider as NavigationThemeProvider,
  useRouter,
  useSegments,
} from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
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

function AuthGate() {
  const { session, loading, isGuest } = useSessionContext();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;

    const onSignInScreen = segments[0] === 'sign-in';
    const canUseApp = session !== null || isGuest;

    if (!canUseApp && !onSignInScreen) {
      router.replace('/sign-in');
    } else if (canUseApp && onSignInScreen) {
      // isGuest PHẢI nằm trong điều kiện này. Thiếu nó, bấm "tiếp tục với tư
      // cách khách" chỉ bật được cờ mà không bao giờ rời khỏi màn đăng nhập.
      router.replace('/');
    }
  }, [session, loading, isGuest, segments, router]);

  // Mọi màn hình tự vẽ header bằng AppHeader để giữ màu trong một bảng token
  // duy nhất, nên tắt header mặc định của Stack.
  return <Stack screenOptions={{ headerShown: false }} />;
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
  const [fontsLoaded, fontError] = useFonts({ Poppins_600SemiBold, Poppins_700Bold });

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
