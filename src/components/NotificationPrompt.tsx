import Ionicons from '@expo/vector-icons/Ionicons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { Sheet } from '@/components/Sheet';
import { notificationAccess, turnOnNotifications } from '@/lib/push';
import { useAppUI } from '@/providers/AppUIProvider';
import { colors, type } from '@/theme';

/** Set once the customer has answered, either way; the Notifications screen can still turn them on later. */
const ASKED_KEY = 'vimalnath:notifications-asked';

/**
 * Once, just after the customer first opens the installed web app logged in: asks whether to turn on phone
 * notifications, then shows the phone's own question. (An iPhone only asks after a tap, so the app can't ask by itself.)
 * The native app asks on its own as it links to the shop.
 */
export function NotificationPrompt() {
  const { showToast } = useAppUI();
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (notificationAccess() !== 'ask') return;
    let cancelled = false;
    // After the first screen settles, so it doesn't land on top of the login screen's way out.
    const timer = setTimeout(() => {
      AsyncStorage.getItem(ASKED_KEY)
        .then((asked) => !asked && !cancelled && setVisible(true))
        .catch(() => {});
    }, 1200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  const close = () => {
    setVisible(false);
    void AsyncStorage.setItem(ASKED_KEY, '1').catch(() => {});
  };

  const turnOn = async () => {
    setBusy(true);
    try {
      // Called straight from the tap: the phone's question appears now.
      const access = await turnOnNotifications();
      if (access === 'on') showToast('Notifications are on.');
      else if (access === 'off') showToast('Notifications are off. You can allow them in your phone’s Settings.');
    } catch {
      showToast('Couldn’t turn on notifications. Try again from Notifications.');
    } finally {
      setBusy(false);
      close();
    }
  };

  return (
    <Sheet visible={visible} title="Notifications" onClose={close} busy={busy}>
      <View style={styles.body}>
        <View style={styles.icon} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Ionicons name="notifications" size={34} color={colors.white} />
        </View>
        <Text style={styles.title} accessibilityRole="header">
          Turn On Notifications?
        </Text>
        <Text style={styles.text}>Get an alert, with sound, when Vimalnath confirms, dispatches or delivers your order, and when the shop has news.</Text>
        <Button label="Turn On Notifications" onPress={() => void turnOn()} loading={busy} style={styles.button} />
        <Button label="Not Now" variant="plain" onPress={close} disabled={busy} />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { alignItems: 'center', paddingHorizontal: 24, paddingTop: 12, paddingBottom: 8 },
  icon: { width: 64, height: 64, alignItems: 'center', justifyContent: 'center', borderRadius: 16, backgroundColor: colors.red },
  title: { ...type.title2, marginTop: 16, textAlign: 'center' },
  text: { ...type.body, marginTop: 8, textAlign: 'center', color: colors.secondaryLabel },
  button: { alignSelf: 'stretch', marginTop: 24, marginBottom: 4 },
});
