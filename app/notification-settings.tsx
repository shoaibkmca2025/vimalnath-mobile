import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { EmptyState } from '@/components/EmptyState';
import { InsetGroup } from '@/components/InsetGroup';
import { Screen } from '@/components/Screen';
import { fetchNotificationPreferences, saveNotificationPreferences, type NotificationPreferences } from '@/lib/admin-sync';
import { applyChannels, phoneAlertAccess, turnOnNotifications, type NotificationAccess } from '@/lib/push';
import { useAppUI } from '@/providers/AppUIProvider';
import { colors, type } from '@/theme';

type Key = keyof NotificationPreferences;
const KINDS: { key: Key; label: string; detail: string }[] = [
  { key: 'orders_enabled', label: 'Orders', detail: 'Received, confirmed, dispatched, delivered or cancelled.' },
  { key: 'payments_enabled', label: 'Payments', detail: 'Payments received, and bills due or overdue.' },
  { key: 'billing_enabled', label: 'Invoices', detail: 'Tax invoices and credit notes.' },
  { key: 'returns_enabled', label: 'Returns & Replacements', detail: 'Recorded, approved or not, and complete.' },
  { key: 'announcements_enabled', label: 'Shop News', detail: 'Offers, new price lists and messages from Vimalnath.' },
];

/**
 * Settings → Notifications: which kinds of message alert this account (on all its phones), and how. A kind turned off
 * still appears in the Notification Center, already read: no alert, no badge. Important account alerts always come.
 */
export default function NotificationSettingsScreen() {
  const { showToast } = useAppUI();
  const [choices, setChoices] = useState<NotificationPreferences>();
  const [error, setError] = useState<string>();
  const [access, setAccess] = useState<NotificationAccess>('on');
  const [saving, setSaving] = useState<Key | null>(null);

  const load = useCallback(async () => {
    setError(undefined);
    void phoneAlertAccess().then(setAccess).catch(() => {});
    try {
      setChoices(await fetchNotificationPreferences());
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Couldn’t load your choices.');
    }
  }, []);
  // Every visit: the person may have changed notifications in the phone's Settings meanwhile.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const change = async (key: Key, value: boolean) => {
    if (!choices) return;
    const before = choices;
    const next = { ...choices, [key]: value };
    setChoices(next);
    setSaving(key);
    try {
      const saved = await saveNotificationPreferences({ [key]: value });
      setChoices(saved);
      // Sound and vibration are the phone's channels: remade for the new choice.
      if (key === 'sound_enabled' || key === 'vibration_enabled') await applyChannels(saved);
    } catch (failure) {
      setChoices(before);
      showToast(failure instanceof Error ? failure.message : 'Couldn’t save that. Try again.');
    } finally {
      setSaving(null);
    }
  };

  const allow = async () => {
    const result = await turnOnNotifications();
    setAccess(result);
    if (result === 'off' && Platform.OS !== 'web') void Linking.openSettings();
  };

  return (
    <Screen title="Notifications" back={{ fallback: '/settings', label: 'Settings' }} grouped>
      <InsetGroup
        header="This phone"
        footer={
          access === 'on'
            ? 'Alerts can also be tuned for each kind of message in your phone’s Settings.'
            : 'Without permission, updates still appear in the Notification Center, but the phone doesn’t alert you.'
        }
      >
        <Pressable
          onPress={access === 'on' ? () => void Linking.openSettings() : () => void allow()}
          accessibilityRole="button"
          style={({ pressed }) => [styles.row, pressed && styles.pressed]}
        >
          <Ionicons name={access === 'on' ? 'notifications' : 'notifications-off'} size={20} color={access === 'on' ? colors.green : colors.red} />
          <View style={styles.copy}>
            <Text style={styles.label}>{access === 'on' ? 'Alerts Allowed' : access === 'ask' ? 'Allow Alerts' : 'Alerts Are Off'}</Text>
            <Text style={styles.detail}>{access === 'on' ? 'Open phone settings for Vimalnath' : access === 'ask' ? 'Tap to allow notifications' : 'Tap to open your phone’s Settings'}</Text>
          </View>
          <Ionicons name={Platform.OS === 'web' ? 'chevron-forward' : 'open-outline'} size={18} color={colors.tertiaryLabel} />
        </Pressable>
      </InsetGroup>

      {error && !choices ? (
        <EmptyState icon="cloud-offline-outline" title="Couldn’t Load Your Choices" message={error} action={{ label: 'Try Again', onPress: () => void load() }} />
      ) : !choices ? (
        <ActivityIndicator style={styles.loading} color={colors.secondaryLabel} accessibilityLabel="Loading" />
      ) : (
        <>
          <InsetGroup header="Alert me about" footer="A kind turned off still shows in the Notification Center, already read. Important account alerts always come." separatorInset={16}>
            {KINDS.map((kind) => (
              <Toggle key={kind.key} label={kind.label} detail={kind.detail} value={choices[kind.key]} busy={saving === kind.key} onChange={(value) => void change(kind.key, value)} />
            ))}
          </InsetGroup>
          <InsetGroup header="How" separatorInset={16}>
            <Toggle label="Sound" value={choices.sound_enabled} busy={saving === 'sound_enabled'} onChange={(value) => void change('sound_enabled', value)} />
            <Toggle label="Vibration" value={choices.vibration_enabled} busy={saving === 'vibration_enabled'} onChange={(value) => void change('vibration_enabled', value)} />
          </InsetGroup>
        </>
      )}
    </Screen>
  );
}

function Toggle({ label, detail, value, busy, onChange }: { label: string; detail?: string; value: boolean; busy: boolean; onChange: (value: boolean) => void }) {
  return (
    <View style={styles.row}>
      <View style={styles.copy}>
        <Text style={styles.label}>{label}</Text>
        {detail && <Text style={styles.detail}>{detail}</Text>}
      </View>
      <Switch value={value} onValueChange={onChange} disabled={busy} accessibilityLabel={label} trackColor={{ true: colors.green, false: colors.fill }} thumbColor={colors.white} />
    </View>
  );
}

const styles = StyleSheet.create({
  loading: { marginTop: 32 },
  row: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 16 },
  pressed: { backgroundColor: colors.fill },
  copy: { flex: 1, gap: 2 },
  label: { ...type.body },
  detail: { ...type.footnote, color: colors.secondaryLabel },
});
