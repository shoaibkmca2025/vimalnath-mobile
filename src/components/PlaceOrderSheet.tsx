import { useState } from 'react';
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

export function PlaceOrderSheet({ visible, summary, onClose, onSubmit }: Props) {
  const [customer, setCustomer] = useState('');
  const [phone, setPhone] = useState('');
  const [phoneDone, setPhoneDone] = useState(false);
  const [notes, setNotes] = useState('');

  // The name is required; the phone is optional, but if it's given it must be all 10 digits.
  const phoneOk = !phone || isFullPhone(phone);
  const ready = customer.trim().length > 0 && phoneOk;
  const submit = () => {
    if (ready) onSubmit({ customer: customer.trim(), phone: phone.trim(), notes: notes.trim() });
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
          autoFocus
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
          label="Notes (optional)"
          value={notes}
          onChangeText={setNotes}
          placeholder="Delivery address, timing…"
          multiline
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
