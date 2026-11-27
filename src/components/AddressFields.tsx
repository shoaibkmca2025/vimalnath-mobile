import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Sheet } from '@/components/Sheet';
import { TextField } from '@/components/TextField';
import type { AddressType, SavedAddress } from '@/lib/admin-sync';
import { STATES } from '@/lib/india';
import { colors, radius, type } from '@/theme';

export const ADDRESS_TYPE: Record<AddressType, { label: string; icon: 'storefront' | 'home' | 'construct' | 'location' }> = {
  shop: { label: 'Shop', icon: 'storefront' },
  home: { label: 'Home', icon: 'home' },
  site: { label: 'Site', icon: 'construct' },
  other: { label: 'Other', icon: 'location' },
};

/** "Shop 4, Mahatma Nagar, Trimbak Road, near ABB Circle, Nashik, Maharashtra 422007": an address on one line. */
export const addressLine = (address: { addressLine: string; area?: string; landmark?: string; city: string; state: string; pincode: string }) =>
  [address.addressLine, address.area, address.landmark ? `near ${address.landmark}` : '', address.city, [address.state, address.pincode].filter(Boolean).join(' ')].filter(Boolean).join(', ');

/** A field that opens the list of states, Maharashtra first. */
export function StateField({ value, onChange, error, label = 'State' }: { value: string; onChange: (state: string) => void; error?: string; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <View>
      <Text style={styles.label}>{label}</Text>
      <Pressable onPress={() => setOpen(true)} accessibilityRole="button" accessibilityLabel={`${label}, ${value || 'not chosen'}`} style={({ pressed }) => [styles.picker, pressed && styles.pressed]}>
        <Text style={[styles.pickerText, !value && styles.placeholder]}>{value || 'Choose the state'}</Text>
        <Ionicons name="chevron-down" size={18} color={colors.secondaryLabel} />
      </Pressable>
      {error && <Text style={styles.error}>{error}</Text>}
      <Sheet visible={open} title={label} onClose={() => setOpen(false)}>
        <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
          {STATES.map((state) => (
            <Pressable
              key={state}
              onPress={() => {
                onChange(state);
                setOpen(false);
              }}
              accessibilityRole="radio"
              accessibilityState={{ selected: state === value }}
              style={({ pressed }) => [styles.option, pressed && styles.pressed]}
            >
              <Text style={styles.optionText}>{state}</Text>
              {state === value && <Ionicons name="checkmark" size={20} color={colors.tint} />}
            </Pressable>
          ))}
        </ScrollView>
      </Sheet>
    </View>
  );
}

export type AddressDraft = { addressLine: string; area: string; landmark: string; city: string; state: string; pincode: string };
export type AddressErrors = Partial<Record<keyof AddressDraft, string>>;

/** The address part of a form: building and street, area, landmark, city, state, PIN code. */
export function AddressFields({ value, onChange, errors = {}, lineLabel = 'Address' }: { value: AddressDraft; onChange: (next: AddressDraft) => void; errors?: AddressErrors; lineLabel?: string }) {
  const set = (key: keyof AddressDraft) => (text: string) => onChange({ ...value, [key]: key === 'pincode' ? text.replace(/\D/g, '').slice(0, 6) : text });
  return (
    <View style={styles.fields}>
      <TextField label={lineLabel} value={value.addressLine} onChangeText={set('addressLine')} error={errors.addressLine} placeholder="Shop / building, street" textContentType="streetAddressLine1" autoCapitalize="words" multiline />
      <TextField label="Area / locality" value={value.area} onChangeText={set('area')} placeholder="e.g. MIDC Satpur" textContentType="sublocality" autoCapitalize="words" />
      <TextField label="Landmark (optional)" value={value.landmark} onChangeText={set('landmark')} placeholder="e.g. Opp. Petrol Pump" autoCapitalize="words" />
      <View style={styles.row}>
        <View style={styles.flex}>
          <TextField label="City" value={value.city} onChangeText={set('city')} error={errors.city} placeholder="City" textContentType="addressCity" autoCapitalize="words" />
        </View>
        <View style={styles.pin}>
          <TextField label="PIN code" value={value.pincode} onChangeText={set('pincode')} error={errors.pincode} placeholder="422001" keyboardType="number-pad" textContentType="postalCode" maxLength={6} />
        </View>
      </View>
      <StateField value={value.state} onChange={set('state')} error={errors.state} />
    </View>
  );
}

/** What's missing or wrong in an address, field by field. */
export function addressErrors(value: AddressDraft): AddressErrors {
  const errors: AddressErrors = {};
  if (!value.addressLine.trim()) errors.addressLine = 'Enter the address: building, street.';
  if (!value.city.trim()) errors.city = 'Enter the city.';
  if (!value.state) errors.state = 'Choose the state.';
  if (!/^\d{6}$/.test(value.pincode.trim())) errors.pincode = 'Enter the 6-digit PIN code.';
  return errors;
}

/** One saved address: its kind, who receives, and where. */
export function AddressSummary({ address, selected, onPress }: { address: SavedAddress; selected?: boolean; onPress?: () => void }) {
  const look = ADDRESS_TYPE[address.type];
  const body = (
    <>
      <View style={[styles.typeIcon, selected && styles.typeIconSelected]}>
        <Ionicons name={look.icon} size={18} color={selected ? colors.white : colors.tint} />
      </View>
      <View style={styles.flex}>
        <View style={styles.titleLine}>
          <Text style={styles.title}>{address.label || look.label}</Text>
          {address.isDefault && <Text style={styles.badge}>Default</Text>}
        </View>
        <Text style={styles.detail}>
          {address.receiverName} · {address.contactNumber}
        </Text>
        {address.siteName ? <Text style={styles.detail}>Site: {address.siteName}</Text> : null}
        <Text style={styles.detail}>{addressLine(address)}</Text>
      </View>
      {onPress && <Ionicons name={selected === undefined ? 'chevron-forward' : selected ? 'radio-button-on' : 'radio-button-off'} size={22} color={selected ? colors.tint : colors.tertiaryLabel} />}
    </>
  );
  return onPress ? (
    <Pressable onPress={onPress} accessibilityRole={selected === undefined ? 'button' : 'radio'} accessibilityState={selected === undefined ? undefined : { selected }} style={({ pressed }) => [styles.summary, pressed && styles.pressed]}>
      {body}
    </Pressable>
  ) : (
    <View style={styles.summary}>{body}</View>
  );
}

const styles = StyleSheet.create({
  fields: { gap: 12 },
  row: { flexDirection: 'row', gap: 12 },
  flex: { flex: 1, minWidth: 0 },
  pin: { width: 120 },
  label: { ...type.footnote, fontWeight: '600', marginBottom: 6, marginLeft: 4, color: colors.secondaryLabel },
  picker: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, borderRadius: radius.md, backgroundColor: colors.card },
  pickerText: { ...type.body },
  placeholder: { color: colors.tertiaryLabel },
  error: { ...type.footnote, marginTop: 6, marginLeft: 4, color: colors.red },
  list: { maxHeight: 420 },
  option: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20 },
  optionText: { ...type.body },
  pressed: { backgroundColor: colors.fill },
  summary: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 16 },
  typeIcon: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 9, backgroundColor: colors.tintFill },
  typeIconSelected: { backgroundColor: colors.tint },
  titleLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { ...type.body, fontWeight: '600', flexShrink: 1 },
  badge: { ...type.caption1, overflow: 'hidden', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6, color: colors.green, backgroundColor: 'rgba(36, 138, 61, 0.12)', fontWeight: '600' },
  detail: { ...type.subheadline, color: colors.secondaryLabel },
});
