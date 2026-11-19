import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';

import { Sheet } from '@/components/Sheet';
import { TextField } from '@/components/TextField';
import { formatPhone, isFullPhone } from '@/lib/format';
import type { OrderDetails } from '@/providers/OrdersProvider';
import { colors, type } from '@/theme';

type Props = {
  visible: boolean;
  summary: string;
  onClose: () => void;
  onSubmit: (details: OrderDetails) => void;
};

/** Saved by logging in or creating an account, and by the User screen. */
const PROFILE_KEY = 'vimalnath:profile';
/** The last delivery address used on this phone; logging out clears it (admin-sync). */
const ADDRESS_KEY = 'vimalnath:delivery-address';

export function PlaceOrderSheet({ visible, summary, onClose, onSubmit }: Props) {
  const [customer, setCustomer] = useState('');
  const [phone, setPhone] = useState('');
  const [phoneDone, setPhoneDone] = useState(false);
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');

  // Filled from the logged-in account and the last order each time the sheet opens, so a repeat order is one tap.
  useEffect(() => {
    if (!visible) return;
    AsyncStorage.multiGet([PROFILE_KEY, ADDRESS_KEY])
      .then(([[, profile], [, lastAddress]]) => {
        const saved = (profile ? JSON.parse(profile) : {}) as { name?: string; business?: string; phone?: string };
        setCustomer((current) => current || saved.business?.trim() || saved.name?.trim() || '');
        setPhone((current) => current || formatPhone(saved.phone ?? ''));
        setAddress((current) => current || lastAddress || '');
      })
      .catch(() => {});
  }, [visible]);

  // Name and address are required; the phone is optional, but if it's given it must be all 10 digits.
  const phoneOk = !phone || isFullPhone(phone);
  const ready = customer.trim().length > 0 && address.trim().length > 0 && phoneOk;
  const submit = () => {
    if (!ready) return;
    const deliverTo = address.trim().replace(/\s*\n\s*/g, ', ');
    void AsyncStorage.setItem(ADDRESS_KEY, deliverTo).catch(() => {});
    // The shop keeps one "delivery notes" text per order (admin, PDF, app), so the address leads it.
    onSubmit({ customer: customer.trim(), phone: phone.trim(), notes: [`Deliver to: ${deliverTo}`, notes.trim()].filter(Boolean).join(' · ') });
  };

  return (
    <Sheet visible={visible} title="Place Order" onClose={onClose} action={{ label: 'Place', onPress: submit, disabled: !ready }}>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={styles.summary}>{summary}</Text>

        <TextField
          label="Customer or site name"
          value={customer}
          onChangeText={setCustomer}
          placeholder="e.g. Sharma Glass Works"
          autoCapitalize="words"
          textContentType="organizationName"
          returnKeyType="next"
          accessibilityLabel="Customer or site name, required"
          containerStyle={styles.field}
        />
        <TextField
          label="Phone (optional)"
          value={phone}
          onChangeText={(text) => setPhone(formatPhone(text))}
          onBlur={() => setPhoneDone(true)}
          error={phoneDone && !phoneOk ? 'Enter all 10 digits of the mobile number.' : undefined}
          placeholder="98220 12345"
          keyboardType="number-pad"
          textContentType="telephoneNumber"
          autoComplete="tel"
          containerStyle={styles.field}
        />
        <TextField
          label="Delivery address"
          value={address}
          onChangeText={setAddress}
          placeholder="Shop or site address, area, city"
          multiline
          maxLength={400}
          autoComplete="street-address"
          textContentType="fullStreetAddress"
          accessibilityLabel="Delivery address, required"
          containerStyle={styles.field}
        />
        <TextField
          label="Notes (optional)"
          value={notes}
          onChangeText={setNotes}
          placeholder="Timing, contact person at site…"
          multiline
          maxLength={1500}
          containerStyle={styles.field}
        />
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 12 },
  summary: { ...type.subheadline, marginBottom: 16, marginHorizontal: 4, color: colors.secondaryLabel },
  field: { marginBottom: 16 },
});
