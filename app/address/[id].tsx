import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Switch, Text, View } from 'react-native';

import { ADDRESS_TYPE, AddressFields, addressErrors, type AddressDraft } from '@/components/AddressFields';
import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { SegmentedControl } from '@/components/SegmentedControl';
import { TextField } from '@/components/TextField';
import { fetchAccount, saveAddress, type AddressType, type SavedAddress } from '@/lib/admin-sync';
import { formatPhone, isFullPhone } from '@/lib/format';
import { HOME_STATE } from '@/lib/india';
import { useAppUI } from '@/providers/AppUIProvider';
import { colors, type } from '@/theme';

type Draft = AddressDraft & { type: AddressType; label: string; receiverName: string; contactNumber: string; alternateContact: string; siteName: string; isDefault: boolean };

/** One saved address, new (id "new") or to change. The shop checks it; a refusal shows under the field. */
export default function AddressScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';
  const { showToast } = useAppUI();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [tried, setTried] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string>();

  useEffect(() => {
    let active = true;
    fetchAccount().then(
      ({ profile, addresses }) => {
        if (!active) return;
        const found = addresses.find((one: SavedAddress) => String(one.id) === id);
        setDraft(
          found
            ? { ...found, contactNumber: formatPhone(found.contactNumber), alternateContact: formatPhone(found.alternateContact) }
            : { type: addresses.length ? 'site' : 'shop', label: '', receiverName: profile.name ?? '', contactNumber: formatPhone(profile.phone ?? ''), alternateContact: '', siteName: '', addressLine: '', area: '', landmark: '', city: profile.city ?? '', state: profile.state || HOME_STATE, pincode: '', isDefault: !addresses.length },
        );
      },
      (problem: unknown) => active && setFailure(problem instanceof Error ? problem.message : 'Couldn’t load the address.'),
    );
    return () => {
      active = false;
    };
  }, [id]);

  if (!draft)
    return (
      <Screen title={isNew ? 'New Address' : 'Edit Address'} back={{ fallback: '/addresses', label: 'Addresses' }} grouped>
        {failure ? <Text style={styles.failure}>{failure}</Text> : <ActivityIndicator style={styles.loading} color={colors.secondaryLabel} />}
      </Screen>
    );

  const errors = {
    ...addressErrors(draft),
    receiverName: draft.receiverName.trim() ? undefined : 'Enter who receives the goods.',
    contactNumber: isFullPhone(draft.contactNumber) ? undefined : 'Enter the 10-digit contact number.',
    alternateContact: !draft.alternateContact || isFullPhone(draft.alternateContact) ? undefined : 'Enter all 10 digits, or leave it empty.',
  };
  const save = async () => {
    setTried(true);
    setFailure(undefined);
    if (Object.values(errors).some(Boolean)) return;
    setSaving(true);
    try {
      await saveAddress(
        {
          type: draft.type,
          label: draft.label.trim(),
          receiverName: draft.receiverName.trim(),
          contactNumber: draft.contactNumber.replace(/\D/g, ''),
          alternateContact: draft.alternateContact.replace(/\D/g, ''),
          siteName: draft.siteName.trim(),
          addressLine: draft.addressLine.trim(),
          area: draft.area.trim(),
          landmark: draft.landmark.trim(),
          city: draft.city.trim(),
          state: draft.state,
          pincode: draft.pincode.trim(),
          isDefault: draft.isDefault,
        },
        isNew ? undefined : Number(id),
      );
      showToast(isNew ? 'Address saved.' : 'Address updated.');
      router.back();
    } catch (problem) {
      setFailure(problem instanceof Error ? problem.message : 'Couldn’t save the address.');
    } finally {
      setSaving(false);
    }
  };
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft({ ...draft, [key]: value });

  return (
    <Screen title={isNew ? 'New Address' : 'Edit Address'} back={{ fallback: '/addresses', label: 'Addresses' }} grouped>
      <View style={styles.form}>
        <SegmentedControl options={(Object.keys(ADDRESS_TYPE) as AddressType[]).map((value) => ({ value, label: ADDRESS_TYPE[value].label }))} value={draft.type} onChange={(value) => set('type', value)} accessibilityLabel="Address type" />
        <TextField label={draft.type === 'other' ? 'Name it' : 'Name it (optional)'} value={draft.label} onChangeText={(text) => set('label', text)} placeholder={draft.type === 'site' ? 'e.g. Gangapur Road site' : draft.type === 'other' ? 'e.g. Godown' : 'e.g. Main shop'} />
        <TextField label="Receiver’s name" value={draft.receiverName} onChangeText={(text) => set('receiverName', text)} error={tried ? errors.receiverName : undefined} autoCapitalize="words" />
        <View style={styles.row}>
          <View style={styles.flex}>
            <TextField label="Contact number" value={draft.contactNumber} onChangeText={(text) => set('contactNumber', formatPhone(text))} error={tried ? errors.contactNumber : undefined} keyboardType="number-pad" />
          </View>
          <View style={styles.flex}>
            <TextField label="Alternate (optional)" value={draft.alternateContact} onChangeText={(text) => set('alternateContact', formatPhone(text))} error={tried ? errors.alternateContact : undefined} keyboardType="number-pad" />
          </View>
        </View>
        {draft.type === 'site' && <TextField label="Site or project name (optional)" value={draft.siteName} onChangeText={(text) => set('siteName', text)} placeholder="e.g. Kulkarni Bungalow" autoCapitalize="words" />}
        <AddressFields value={draft} onChange={(next) => setDraft({ ...draft, ...next })} errors={tried ? errors : {}} />
        <View style={styles.defaultRow}>
          <Text style={styles.defaultLabel}>Default delivery address</Text>
          <Switch value={draft.isDefault} onValueChange={(on) => set('isDefault', on)} accessibilityLabel="Default delivery address" trackColor={{ true: colors.green, false: colors.fill }} thumbColor={colors.white} />
        </View>
        {failure && (
          <Text style={styles.failure} accessibilityRole="alert">
            {failure}
          </Text>
        )}
        <Button label={isNew ? 'Save Address' : 'Save Changes'} onPress={() => void save()} loading={saving} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  loading: { marginTop: 32 },
  form: { gap: 12, marginBottom: 24, paddingHorizontal: 16 },
  row: { flexDirection: 'row', gap: 12 },
  flex: { flex: 1, minWidth: 0 },
  defaultRow: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, borderRadius: 12, backgroundColor: colors.card },
  defaultLabel: { ...type.body, flex: 1 },
  failure: { ...type.subheadline, color: colors.red },
});
