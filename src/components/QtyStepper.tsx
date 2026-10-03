import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { colors, tabularNums, type } from '@/theme';

type Props = {
  value: number;
  onChange: (qty: number) => void;
  label: string;
  /** Show a delete icon instead of minus at 1, for cart lines that can be removed. */
  removable?: boolean;
  min?: number;
};

/** Stepper paired with an editable value, so large quantities can be typed instead of tapped. */
export function QtyStepper({ value, onChange, label, removable = false, min = 1 }: Props) {
  const atFloor = value <= min;
  const removing = atFloor && removable;
  return (
    <View style={styles.stepper}>
      <Pressable
        onPress={() => (atFloor ? removable && onChange(0) : onChange(value - 1))}
        disabled={atFloor && !removable}
        accessibilityRole="button"
        accessibilityLabel={removing ? `Remove ${label}` : `Decrease ${label}`}
        accessibilityState={{ disabled: atFloor && !removable }}
        style={({ pressed }) => [styles.button, pressed && styles.pressed]}
      >
        <Ionicons
          name={removing ? 'trash-outline' : 'remove'}
          size={removing ? 18 : 20}
          color={removing ? colors.red : atFloor ? colors.tertiaryLabel : colors.tint}
        />
      </Pressable>
      <TextInput
        value={String(value)}
        onChangeText={(text) => {
          const qty = Number(text.replace(/[^0-9]/g, ''));
          if (qty >= min) onChange(qty);
        }}
        keyboardType="number-pad"
        selectTextOnFocus
        selectionColor={colors.tint}
        accessibilityLabel={`${label} quantity`}
        style={styles.value}
      />
      <Pressable
        onPress={() => onChange(value + 1)}
        accessibilityRole="button"
        accessibilityLabel={`Increase ${label}`}
        style={({ pressed }) => [styles.button, pressed && styles.pressed]}
      >
        <Ionicons name="add" size={20} color={colors.tint} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  stepper: { flexShrink: 0, height: 44, flexDirection: 'row', alignItems: 'center', backgroundColor: colors.tertiaryFill, borderRadius: 22 },
  button: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22 },
  pressed: { backgroundColor: colors.fill },
  value: { ...type.headline, width: 40, height: 44, padding: 0, textAlign: 'center', ...tabularNums },
});
