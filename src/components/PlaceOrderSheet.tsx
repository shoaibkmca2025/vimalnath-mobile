import Feather from '@expo/vector-icons/Feather';
import { useEffect, useState } from 'react';
import { Animated, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useOverlayTransition } from '@/hooks/useOverlayTransition';
import type { OrderDetails } from '@/providers/OrdersProvider';
import { colors, fonts, type } from '@/theme';

type Props = {
  visible: boolean;
  summary: string;
  onClose: () => void;
  onSubmit: (details: OrderDetails) => void;
};

export function PlaceOrderSheet({ visible, summary, onClose, onSubmit }: Props) {
  const { mounted, progress } = useOverlayTransition(visible);
  const insets = useSafeAreaInsets();
  const [customer, setCustomer] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState(false);

  useEffect(() => {
    if (visible) setError(false);
  }, [visible]);

  const submit = () => {
    if (!customer.trim()) {
      setError(true);
      return;
    }
    onSubmit({ customer: customer.trim(), phone: phone.trim(), notes: notes.trim() });
  };

  return (
    <Modal visible={mounted} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: colors.backdrop, opacity: progress }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close order sheet" />
      </Animated.View>

      <Animated.View
        accessibilityViewIsModal
        style={[
          styles.sheet,
          { paddingBottom: insets.bottom + 16, transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [560, 0] }) }] },
        ]}
      >
        <View style={styles.handle} />
        <View style={styles.header}>
          <View style={{ flexShrink: 1 }}>
            <Text style={type.eyebrow}>CHECKOUT</Text>
            <Text style={styles.title}>Place order</Text>
          </View>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" style={styles.close}>
            <Feather name="x" size={20} color={colors.ink} />
          </Pressable>
        </View>
        <Text style={styles.summary}>{summary}</Text>

        <Text style={styles.label}>Customer / site name *</Text>
        <TextInput
          value={customer}
          onChangeText={(text) => {
            setCustomer(text);
            setError(false);
          }}
          placeholder="e.g. Sharma Glass Works"
          placeholderTextColor={colors.subtle}
          autoFocus
          accessibilityLabel="Customer or site name"
          style={[styles.input, error && styles.inputError]}
        />
        {error && <Text style={styles.error}>Enter the customer or site name.</Text>}

        <Text style={styles.label}>Phone</Text>
        <TextInput
          value={phone}
          onChangeText={setPhone}
          placeholder="Optional"
          placeholderTextColor={colors.subtle}
          keyboardType="phone-pad"
          accessibilityLabel="Phone number"
          style={styles.input}
        />

        <Text style={styles.label}>Notes</Text>
        <TextInput
          value={notes}
          onChangeText={setNotes}
          placeholder="Delivery address, timing… (optional)"
          placeholderTextColor={colors.subtle}
          multiline
          accessibilityLabel="Order notes"
          style={[styles.input, styles.notes]}
        />

        <Pressable onPress={submit} accessibilityRole="button" accessibilityLabel="Confirm order" style={({ pressed }) => [styles.submit, pressed && styles.submitPressed]}>
          <Feather name="check-circle" size={18} color={colors.white} />
          <Text style={styles.submitText}>Confirm order</Text>
        </Pressable>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: 20,
    backgroundColor: colors.white,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
  },
  handle: { alignSelf: 'center', width: 40, height: 5, marginTop: -8, marginBottom: 10, borderRadius: 3, backgroundColor: '#d3def7' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  title: { color: colors.ink, fontFamily: fonts.display, fontSize: 22, letterSpacing: -0.5 },
  close: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.soft, borderRadius: 19 },
  summary: { marginBottom: 12, color: colors.muted, fontFamily: fonts.medium, fontSize: 13 },
  label: { marginTop: 8, marginBottom: 6, color: colors.ink, fontFamily: fonts.bold, fontSize: 12 },
  input: {
    minHeight: 50,
    paddingHorizontal: 14,
    backgroundColor: colors.soft,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 14,
    color: colors.ink,
    fontFamily: fonts.semibold,
    fontSize: 15,
  },
  inputError: { borderColor: colors.red, backgroundColor: colors.redTint },
  error: { marginTop: 5, color: colors.red, fontFamily: fonts.semibold, fontSize: 12 },
  notes: { minHeight: 70, paddingTop: 12, textAlignVertical: 'top' },
  submit: {
    height: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 18,
    backgroundColor: colors.blue,
    borderRadius: 15,
  },
  submitPressed: { backgroundColor: colors.blueDark },
  submitText: { color: colors.white, fontFamily: fonts.bold, fontSize: 15 },
});
