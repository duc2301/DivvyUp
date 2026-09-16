import '@/global.css';

import { InstrumentSerif_400Regular, useFonts } from '@expo-google-fonts/instrument-serif';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { SessionProvider, useSessionContext } from '@/features/auth/session-context';

SplashScreen.preventAutoHideAsync();

/**
 * Nền của navigation container. Đây là HAI giá trị duy nhất phải nhắc lại bên
 * ngoài global.css, vì react-navigation nhận màu qua đối tượng JS chứ không
 * đọc được CSS variable. Chúng chỉ lộ ra trong khoảnh khắc chuyển màn.
 * Phải khớp với --background trong src/global.css.
 */
const LIGHT_BACKGROUND = '#F7F2E9';
const DARK_BACKGROUND = '#1B1822';

function AuthGate() {
  const { session, loading, isGuest } = useSessionContext();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;

    const onSignInScreen = segments[0] === 'sign-in';
    if (!session && !isGuest && !onSignInScreen) {
      router.replace('/sign-in');
    } else if (session && onSignInScreen) {
      router.replace('/');
    }
  }, [session, loading, isGuest, segments, router]);

  // Mọi màn hình tự vẽ header bằng AppHeader để giữ màu trong một bảng token
  // duy nhất, nên tắt header mặc định của Stack.
  return <Stack screenOptions={{ headerShown: false }} />;
}

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  const [fontsLoaded, fontError] = useFonts({ InstrumentSerif_400Regular });

  // Nếu tải font lỗi thì vẫn cho app chạy với font hệ thống — mất chữ serif ở
  // tiêu đề còn hơn kẹt ở màn hình trắng vĩnh viễn.
  if (!fontsLoaded && !fontError) return null;

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
    <SafeAreaProvider>
      <ThemeProvider value={navigationTheme}>
        <SessionProvider>
          <AnimatedSplashOverlay />
          <AuthGate />
        </SessionProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
