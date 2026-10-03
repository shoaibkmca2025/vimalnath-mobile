import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Sheet } from '@/components/Sheet';
import { formatFraction } from '@/lib/format';
import { colors, radius, type } from '@/theme';

const SIXTEENTHS = Array.from({ length: 16 }, (_, index) => index);

/** The fraction part of an inch size, shown as a tinted pill that opens the fraction sheet. */
export function FractionButton({ sixteenths, onPress, accessibilityLabel }: { sixteenths: number; onPress: () => void; accessibilityLabel: string }) {
  const fraction = formatFraction(sixteenths);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${accessibilityLabel}, ${fraction ? `${fraction} inch` : 'none'}`}
      accessibilityHint="Choose the fraction of an inch"
      hitSlop={{ top: 6, bottom: 6 }}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
    >
      <Text style={[styles.buttonText, !fraction && { color: colors.secondaryLabel }]}>{fraction || '0/16'}</Text>
      <Ionicons name="chevron-down" size={14} color={colors.tint} />
    </Pressable>
  );
}

/** Tape-measure fractions, 0 to 15/16, in a 4 × 4 grid. Picking one closes the sheet. */
export function FractionSheet({
  visible,
  title,
  sixteenths,
  onPick,
  onClose,
}: {
  visible: boolean;
  title: string;
  sixteenths: number;
  onPick: (sixteenths: number) => void;
  onClose: () => void;
}) {
  return (
    <Sheet visible={visible} title={title} onClose={onClose}>
      <View style={styles.grid}>
        {SIXTEENTHS.map((value) => {
          const selected = value === sixteenths;
          const label = formatFraction(value) || '0';
          return (
            <Pressable
              key={value}
              onPress={() => onPick(value)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={value ? `${label} inch` : 'No fraction'}
              style={({ pressed }) => [styles.cell, selected && styles.cellSelected, pressed && styles.pressed]}
            >
              <Text style={[styles.cellText, selected && { color: colors.white }]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  button: { minWidth: 72, height: 34, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3, paddingHorizontal: 10, backgroundColor: colors.tintFill, borderRadius: 17 },
  pressed: { opacity: 0.6 },
  buttonText: { ...type.subheadline, fontWeight: '600', color: colors.tint },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 10, paddingHorizontal: 16, paddingTop: 4, paddingBottom: 12 },
  cell: { width: '23%', height: 52, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.card, borderRadius: radius.md },
  cellSelected: { backgroundColor: colors.tint },
  cellText: { ...type.headline },
});
