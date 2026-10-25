import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { TextField } from '@/components/TextField';
import { useAppUI } from '@/providers/AppUIProvider';
import { colors, type } from '@/theme';

const PROFILE_KEY = 'vimalnath:profile';

type Profile = { name: string; business: string; phone: string; email: string; city: string };
const EMPTY: Profile = { name: '', business: '', phone: '', email: '', city: '' };

/** The person using the app; kept on this phone only. */
export default function UserScreen() {
  const { showToast } = useAppUI();
  const [profile, setProfile] = useState<Profile>(EMPTY);

  useEffect(() => {
    AsyncStorage.getItem(PROFILE_KEY)
      .then((raw) => raw && setProfile({ ...EMPTY, ...JSON.parse(raw) }))
      .catch(() => {});
  }, []);

  const set = (key: keyof Profile) => (value: string) => setProfile((current) => ({ ...current, [key]: value }));

  const save = async () => {
    try {
      await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
      showToast('Your details are saved.');
    } catch {
      showToast('Couldn’t save your details. Try again.');
    }
  };

  const initials = profile.name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]!.toUpperCase()).join('');

  return (
    <Screen title="User" subtitle="Your details, kept on this phone" back={{ fallback: '/', label: 'Back' }} grouped>
      <View style={styles.avatarRow}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initials || '?'}</Text>
        </View>
        <View style={styles.flex}>
          <Text style={type.headline}>{profile.name.trim() || 'Your name'}</Text>
          <Text style={styles.muted}>{profile.business.trim() || 'Business name'}</Text>
        </View>
      </View>

      <View style={styles.fields}>
        <TextField label="Name" value={profile.name} onChangeText={set('name')} placeholder="Full name" autoComplete="name" textContentType="name" />
        <TextField label="Business" value={profile.business} onChangeText={set('business')} placeholder="Business or firm name" textContentType="organizationName" />
        <TextField label="Phone" value={profile.phone} onChangeText={set('phone')} placeholder="Mobile number" keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber" />
        <TextField
          label="Email"
          value={profile.email}
          onChangeText={set('email')}
          placeholder="name@example.com"
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          textContentType="emailAddress"
        />
        <TextField label="City" value={profile.city} onChangeText={set('city')} placeholder="City" textContentType="addressCity" />
      </View>

      <Button label="Save" onPress={save} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  avatarRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 24 },
  avatar: { width: 60, height: 60, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.tint, borderRadius: 30 },
  avatarText: { ...type.title3, color: colors.white },
  muted: { ...type.subheadline, marginTop: 2, color: colors.secondaryLabel },
  fields: { gap: 16, marginBottom: 28 },
});
