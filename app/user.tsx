import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { Image } from 'expo-image';
import { StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { TextField } from '@/components/TextField';
import { useLogOut } from '@/hooks/useLogOut';
import { enqueueAdminProfile } from '@/lib/admin-sync';
import { formatPhone, isFullPhone } from '@/lib/format';
import { pickProfilePhoto, saveProfilePhoto, useProfilePhoto } from '@/lib/profile-photo';
import { useAppUI } from '@/providers/AppUIProvider';
import { colors, type } from '@/theme';

const PROFILE_KEY = 'vimalnath:profile';

type Profile = { name: string; business: string; phone: string; email: string; city: string };
const EMPTY: Profile = { name: '', business: '', phone: '', email: '', city: '' };

/** The person using the app; shared with the shop so it knows who is ordering. */
export default function UserScreen() {
  const { showToast } = useAppUI();
  const [profile, setProfile] = useState<Profile>(EMPTY);
  const [phoneDone, setPhoneDone] = useState(false);
  const phoneOk = !profile.phone || isFullPhone(profile.phone);

  useEffect(() => {
    AsyncStorage.getItem(PROFILE_KEY)
      // A number saved before phones were checked is shown the new way, e.g. +91 98220-12345 → 98220 12345.
      .then((raw) => {
        if (!raw) return;
        const saved = { ...EMPTY, ...JSON.parse(raw) } as Profile;
        setProfile({ ...saved, phone: formatPhone(saved.phone) });
      })
      .catch(() => {});
  }, []);

  const set = (key: keyof Profile) => (value: string) => setProfile((current) => ({ ...current, [key]: value }));

  const save = async () => {
    if (!phoneOk) {
      setPhoneDone(true);
      showToast('Enter all 10 digits of the mobile number.');
      return;
    }
    try {
      await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
      void enqueueAdminProfile(profile);
      showToast('Your details are saved.');
    } catch {
      showToast('Couldn’t save your details. Try again.');
    }
  };

  const initials = profile.name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]!.toUpperCase()).join('');
  const photo = useProfilePhoto();
  const { confirmLogOut, loggingOut } = useLogOut();

  const changePhoto = async (source: 'camera' | 'library') => {
    try {
      const picked = await pickProfilePhoto(source);
      if (!picked) return;
      await saveProfilePhoto(picked);
      showToast('Your photo is saved.');
    } catch (error) {
      showToast(error instanceof Error && error.message ? error.message : 'Couldn’t change your photo. Try again.');
    }
  };

  return (
    <Screen title="User" subtitle="Shared with Vimalnath, so the shop knows who is ordering" back={{ fallback: '/', label: 'Back' }} grouped>
      <View style={styles.avatarRow}>
        <View style={styles.avatar} accessible accessibilityLabel={photo ? 'Your photo' : `Initials ${initials || 'not set'}`}>
          {photo ? <Image source={{ uri: photo }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="none" /> : <Text style={styles.avatarText}>{initials || '?'}</Text>}
        </View>
        <View style={styles.flex}>
          <Text style={type.headline}>{profile.name.trim() || 'Your name'}</Text>
          <Text style={styles.muted}>{profile.business.trim() || 'Business name'}</Text>
        </View>
      </View>

      <View style={styles.photoButtons}>
        <Button label={photo ? 'Retake Photo' : 'Take Photo'} icon="camera-outline" size="medium" variant="tinted" onPress={() => void changePhoto('camera')} style={styles.flex} />
        <Button label="Choose Photo" icon="images-outline" size="medium" variant="gray" onPress={() => void changePhoto('library')} style={styles.flex} />
      </View>

      <View style={styles.fields}>
        <TextField label="Name" value={profile.name} onChangeText={set('name')} placeholder="Full name" autoComplete="name" textContentType="name" />
        <TextField label="Business" value={profile.business} onChangeText={set('business')} placeholder="Business or firm name" textContentType="organizationName" />
        <TextField
          label="Phone"
          value={profile.phone}
          onChangeText={(text) => set('phone')(formatPhone(text))}
          onBlur={() => setPhoneDone(true)}
          error={phoneDone && !phoneOk ? 'Enter all 10 digits of the mobile number.' : undefined}
          placeholder="98220 12345"
          keyboardType="number-pad"
          autoComplete="tel"
          textContentType="telephoneNumber"
        />
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
      <Button label="Log Out" icon="log-out-outline" variant="gray" destructive loading={loggingOut} loadingLabel="Logging out…" onPress={confirmLogOut} style={styles.logOut} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  avatarRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 24 },
  avatar: { width: 60, height: 60, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: colors.tint, borderRadius: 30 },
  logOut: { marginTop: 12 },
  photoButtons: { flexDirection: 'row', gap: 10, marginBottom: 24 },
  avatarText: { ...type.title3, color: colors.white },
  muted: { ...type.subheadline, marginTop: 2, color: colors.secondaryLabel },
  fields: { gap: 16, marginBottom: 28 },
});
