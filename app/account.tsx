import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BrandLockup } from '@/components/BrandLockup';
import { Button } from '@/components/Button';
import { SegmentedControl } from '@/components/SegmentedControl';
import { TextField } from '@/components/TextField';
import { getAdminSyncStatus, logIn, registerAccount } from '@/lib/admin-sync';
import { useAppContent } from '@/lib/content-sync';
import { pickProfilePhoto, saveProfilePhoto, type ProfilePhoto } from '@/lib/profile-photo';
import { colors, space, type } from '@/theme';

type Mode = 'login' | 'register';
type Form = { name: string; business: string; city: string; phone: string; password: string };
type Errors = Partial<Record<keyof Form | 'form' | 'photo', string>>;

const MODES: { value: Mode; label: string }[] = [
  { value: 'login', label: 'Log In' },
  { value: 'register', label: 'Create Account' },
];

/** The same checks the shop makes, so most mistakes show next to their field before anything is sent. */
function check(mode: Mode, form: Form, photo: ProfilePhoto | null): Errors {
  const errors: Errors = {};
  if (mode === 'register' && !photo) errors.photo = 'Add your photo, so the shop knows who you are.';
  if (mode === 'register' && !form.name.trim()) errors.name = 'Enter your name.';
  if (form.phone.replace(/\D/g, '').length < 10) errors.phone = 'Enter your 10-digit mobile number.';
  if (mode === 'register' && form.password.length < 8) errors.password = 'Use at least 8 characters.';
  if (mode === 'login' && !form.password) errors.password = 'Enter your password.';
  return errors;
}

/** Shown instead of the app until the customer logs in; the root layout switches over once they have. */
export default function AccountScreen() {
  const insets = useSafeAreaInsets();
  const { settings } = useAppContent();
  const [mode, setMode] = useState<Mode>('login');
  const [form, setForm] = useState<Form>({ name: '', business: '', city: '', phone: '', password: '' });
  // e.g. "You were logged out. Log in again." when the shop ended this phone's session.
  const [errors, setErrors] = useState<Errors>(() => ({ form: getAdminSyncStatus().error }));
  const [busy, setBusy] = useState(false);
  // Required to create an account: taken with the front camera or chosen from the gallery, cropped square.
  const [photo, setPhoto] = useState<ProfilePhoto | null>(null);
  const register = mode === 'register';

  const choosePhoto = async (source: 'camera' | 'library') => {
    try {
      const picked = await pickProfilePhoto(source);
      if (!picked) return;
      setPhoto(picked);
      setErrors((current) => ({ ...current, photo: undefined }));
    } catch (error) {
      setErrors((current) => ({ ...current, photo: error instanceof Error ? error.message : 'Couldn’t open the camera.' }));
    }
  };

  const set = (key: keyof Form) => (value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  const switchMode = (next: Mode) => {
    setMode(next);
    setErrors({});
  };

  const submit = async () => {
    const found = check(mode, form, photo);
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    try {
      if (register) {
        await registerAccount({ name: form.name, business: form.business, city: form.city, email: '', phone: form.phone, password: form.password });
        // Kept on the phone and sent to the shop; if the send fails it's retried on the next link to the shop.
        if (photo) void saveProfilePhoto(photo).catch(() => {});
      } else await logIn(form.phone, form.password);
    } catch (error) {
      setErrors({ form: error instanceof Error ? error.message : 'Something went wrong. Try again.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.root}>
      {/* Android is edge-to-edge, so the window no longer resizes for the keyboard; iOS uses scroll insets instead. */}
      <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'android' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={[styles.content, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 24 }]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          automaticallyAdjustKeyboardInsets
        >
          <View style={styles.column}>
            <BrandLockup />
            <View style={styles.titleBlock}>
              <Text style={type.largeTitle} accessibilityRole="header">
                {register ? 'Create Account' : 'Welcome'}
              </Text>
              <Text style={styles.subtitle}>
                {register ? 'Order from Vimalnath and follow every order here.' : 'Log in with your mobile number to see prices and order.'}
              </Text>
            </View>

            <SegmentedControl options={MODES} value={mode} onChange={switchMode} accessibilityLabel="Log in or create an account" />

            <View style={styles.fields}>
              {register && (
                <>
                  <View style={styles.photoBlock}>
                    <View style={[styles.photoCircle, errors.photo ? styles.photoCircleError : null]} accessible accessibilityLabel={photo ? 'Your photo' : 'No photo yet'}>
                      {photo ? (
                        <Image source={{ uri: photo.uri }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="none" />
                      ) : (
                        <Ionicons name="person" size={44} color={colors.tertiaryLabel} />
                      )}
                    </View>
                    <View style={styles.photoButtons}>
                      <Button label={photo ? 'Retake Photo' : 'Take Photo'} icon="camera-outline" size="medium" variant="tinted" onPress={() => void choosePhoto('camera')} disabled={busy} style={styles.flex} />
                      <Button label="Choose Photo" icon="images-outline" size="medium" variant="gray" onPress={() => void choosePhoto('library')} disabled={busy} style={styles.flex} />
                    </View>
                    {errors.photo ? (
                      <Text style={styles.photoError} accessibilityRole="alert" accessibilityLiveRegion="polite">
                        {errors.photo}
                      </Text>
                    ) : null}
                  </View>
                  <TextField label="Name" value={form.name} onChangeText={set('name')} error={errors.name} placeholder="Full name" autoComplete="name" textContentType="name" autoCapitalize="words" editable={!busy} />
                  <TextField label="Business (optional)" value={form.business} onChangeText={set('business')} placeholder="Business or firm name" textContentType="organizationName" editable={!busy} />
                  <TextField label="City (optional)" value={form.city} onChangeText={set('city')} placeholder="City" textContentType="addressCity" editable={!busy} />
                </>
              )}
              <TextField label="Mobile number" value={form.phone} onChangeText={set('phone')} error={errors.phone} placeholder="10-digit mobile number" keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber" editable={!busy} />
              <TextField
                label="Password"
                value={form.password}
                onChangeText={set('password')}
                error={errors.password}
                placeholder={register ? 'At least 8 characters' : 'Your password'}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete={register ? 'new-password' : 'current-password'}
                textContentType={register ? 'newPassword' : 'password'}
                returnKeyType="go"
                onSubmitEditing={() => void submit()}
                editable={!busy}
              />
            </View>

            <Button label={register ? 'Create Account' : 'Log In'} onPress={() => void submit()} loading={busy} />
            {errors.form ? (
              <Text style={styles.formError} accessibilityRole="alert" accessibilityLiveRegion="polite">
                {errors.form}
              </Text>
            ) : null}

            <Text style={styles.footnote}>
              {register
                ? 'Your photo, name and business go to Vimalnath, so the shop knows who is ordering.'
                : `Forgot your password? ${settings.phone ? `Call the shop on ${settings.phone}` : 'Call the shop'} and they’ll set a new one.`}
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.groupedBackground },
  // Centred on tall screens and tablets; scrolls when the keyboard takes the space.
  content: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: space.gutter },
  column: { width: '100%', maxWidth: 440, alignSelf: 'center' },
  titleBlock: { marginTop: 28, marginBottom: 20 },
  subtitle: { ...type.subheadline, marginTop: 4, color: colors.secondaryLabel },
  fields: { gap: 14, marginTop: 20, marginBottom: 24 },
  formError: { ...type.footnote, marginTop: 12, color: colors.red, textAlign: 'center' },
  flex: { flex: 1 },
  photoBlock: { alignItems: 'center', gap: 12, marginBottom: 4 },
  photoCircle: { width: 104, height: 104, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', borderRadius: 52, backgroundColor: colors.tertiaryFill, borderWidth: 2, borderColor: colors.card },
  photoCircleError: { borderColor: colors.red },
  photoButtons: { flexDirection: 'row', gap: 10, alignSelf: 'stretch' },
  photoError: { ...type.footnote, color: colors.red, textAlign: 'center' },
  footnote: { ...type.footnote, marginTop: 20, color: colors.secondaryLabel, textAlign: 'center' },
});
