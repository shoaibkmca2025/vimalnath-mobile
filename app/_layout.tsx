import { SpaceGrotesk_700Bold } from '@expo-google-fonts/space-grotesk/700Bold';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as ScreenOrientation from 'expo-screen-orientation';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { startAdminSync } from '@/lib/admin-sync';
import { loadSavedContent, startContentSync } from '@/lib/content-sync';
import { AppUIProvider } from '@/providers/AppUIProvider';
import { CartProvider } from '@/providers/CartProvider';
import { OrdersProvider } from '@/providers/OrdersProvider';
import { colors } from '@/theme';

SplashScreen.preventAutoHideAsync();
// Let the device rotate freely instead of the app forcing portrait.
ScreenOrientation.unlockAsync().catch(() => {});

export default function RootLayout() {
  // Interface text uses the system font; only the brand wordmark needs a bundled typeface.
  const [fontsLoaded, fontError] = useFonts({ SpaceGrotesk_700Bold });
  // The shop's last download is read before the first screen, so it never flashes the data built into the app.
  const [contentLoaded, setContentLoaded] = useState(false);
  const ready = (fontsLoaded || Boolean(fontError)) && contentLoaded;

  useEffect(() => {
    void loadSavedContent().finally(() => setContentLoaded(true));
  }, []);
  useEffect(() => startAdminSync(), []);
  useEffect(() => startContentSync(), []);

  useEffect(() => {
    if (ready) SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) return null;

  return (
    <SafeAreaProvider>
      <CartProvider>
        <OrdersProvider>
          <AppUIProvider>
            <StatusBar style="dark" />
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: colors.background },
                // The quick iOS-style slide; Android's default fade-and-grow takes about twice as long.
                animation: 'ios_from_right',
                // Screens underneath don't re-render while another screen is on top.
                freezeOnBlur: true,
              }}
            >
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="telescopic" />
              <Stack.Screen name="synchronized" />
              <Stack.Screen name="folding" />
              <Stack.Screen name="glass-calculator" />
              <Stack.Screen name="cart" />
              <Stack.Screen name="product/[id]" />
              <Stack.Screen name="order/[id]" />
              <Stack.Screen name="shop-order/[id]" />
              <Stack.Screen name="user" />
              <Stack.Screen name="settings" />
              <Stack.Screen name="more-apps" />
              <Stack.Screen name="about" />
              <Stack.Screen name="videos" />
              <Stack.Screen name="saved-pdfs" />
              <Stack.Screen name="pdf/[id]" />
            </Stack>
          </AppUIProvider>
        </OrdersProvider>
      </CartProvider>
    </SafeAreaProvider>
  );
}
