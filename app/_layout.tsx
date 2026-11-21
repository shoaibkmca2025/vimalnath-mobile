import { SpaceGrotesk_700Bold } from '@expo-google-fonts/space-grotesk/700Bold';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as ScreenOrientation from 'expo-screen-orientation';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { NotificationPrompt } from '@/components/NotificationPrompt';
import { getAdminSyncStatus, initializeAdminSync, startAdminSync, subscribeAdminSync } from '@/lib/admin-sync';
import { loadSavedContent, startContentSync } from '@/lib/content-sync';
import { startProfilePhotoSync } from '@/lib/profile-photo';
import { startPush } from '@/lib/push';
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
  // Unknown until the saved login is read, so a logged-in customer never sees the login screen flash.
  const [loggedIn, setLoggedIn] = useState<boolean>();
  const ready = (fontsLoaded || Boolean(fontError)) && contentLoaded && loggedIn !== undefined;

  useEffect(() => {
    void loadSavedContent().finally(() => setContentLoaded(true));
  }, []);
  useEffect(() => {
    void initializeAdminSync().then(() => setLoggedIn(getAdminSyncStatus().connection.enabled));
    return subscribeAdminSync((status) => setLoggedIn(status.connection.enabled));
  }, []);
  useEffect(() => startAdminSync(), []);
  useEffect(() => startContentSync(), []);
  // A photo from Create Account or the User screen that hasn't reached the shop yet is sent once it can be.
  useEffect(() => startProfilePhotoSync(), []);
  // Once navigation is mounted, so a tapped order update can open its order.
  useEffect(() => (ready ? startPush() : undefined), [ready]);

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
              {/* Logging in or out swaps these; the app's screens can't be opened, even by a link, while logged out. */}
              <Stack.Protected guard={!loggedIn}>
                <Stack.Screen name="account" />
              </Stack.Protected>
              <Stack.Protected guard={loggedIn === true}>
                <Stack.Screen name="(tabs)" />
                <Stack.Screen name="telescopic" />
                <Stack.Screen name="synchronized" />
                <Stack.Screen name="folding" />
                <Stack.Screen name="glass-calculator" />
                <Stack.Screen name="cart" />
                <Stack.Screen name="notifications" />
                <Stack.Screen name="product/[id]" />
                <Stack.Screen name="order/[id]" />
                <Stack.Screen name="shop-order/[id]" />
                <Stack.Screen name="user" />
                <Stack.Screen name="settings" />
                <Stack.Screen name="more-apps" />
                <Stack.Screen name="about" />
                <Stack.Screen name="feedback" />
                <Stack.Screen name="videos" />
                <Stack.Screen name="saved-pdfs" />
                <Stack.Screen name="pdf/[id]" />
              </Stack.Protected>
            </Stack>
            {loggedIn && <NotificationPrompt />}
          </AppUIProvider>
        </OrdersProvider>
      </CartProvider>
    </SafeAreaProvider>
  );
}
