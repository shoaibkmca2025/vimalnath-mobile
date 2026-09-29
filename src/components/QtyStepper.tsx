import Feather from '@expo/vector-icons/Feather';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { colors, fonts } from '@/theme';

type Props = {
  value: number;
  onChange: (qty: number) => void;
  label: string;
  /** Show a delete icon instead of minus at 1, for cart lines that can be removed. */
  removable?: boolean;
  min?: number;
};

export function QtyStepper({ value, onChange, label, removable = false, min = 1 }: Props) {
  const atFloor = value <= min;
  return (
    <View style={styles.stepper}>
      <Pressable
        onPress={() => (atFloor ? removable && onChange(0) : onChange(value - 1))}
        disabled={atFloor && !removable}
        accessibilityRole="button"
        accessibilityLabel={atFloor && removable ? `Remove ${label}` : `Decrease ${label}`}
        style={[styles.button, atFloor && !removable && { opacity: 0.35 }]}
      >
        <Feather name={atFloor && removable ? 'trash-2' : 'minus'} size={16} color={colors.blue} />
      </Pressable>
      <TextInput
        value={String(value)}
        onChangeText={(text) => {
          const qty = Number(text.replace(/[^0-9]/g, ''));
          if (qty >= min) onChange(qty);
        }}
        keyboardType="number-pad"
        selectTextOnFocus
        accessibilityLabel={`${label} quantity`}
        style={styles.value}
      />
      <Pressable onPress={() => onChange(value + 1)} accessibilityRole="button" accessibilityLabel={`Increase ${label}`} style={styles.button}>
        <Feather name="plus" size={16} color={colors.blue} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  stepper: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
  },
  button: { width: 38, height: 40, alignItems: 'center', justifyContent: 'center' },
  value: { width: 46, height: 40, padding: 0, textAlign: 'center', color: colors.ink, fontFamily: fonts.bold, fontSize: 15 },
});
