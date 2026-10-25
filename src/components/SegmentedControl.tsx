import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, type } from '@/theme';

type Props<T extends string> = {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  accessibilityLabel: string;
  style?: StyleProp<ViewStyle>;
};

/** iOS-style segmented control: a gray track with the selected segment raised in white. */
export function SegmentedControl<T extends string>({ options, value, onChange, accessibilityLabel, style }: Props<T>) {
  return (
    <View style={[styles.track, style]} accessibilityRole="radiogroup" accessibilityLabel={accessibilityLabel}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={option.label}
            style={[styles.segment, selected && styles.selected]}
          >
            <Text style={[styles.label, selected && styles.labelSelected]} numberOfLines={1}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { minHeight: 40, flexDirection: 'row', padding: 2, backgroundColor: colors.tertiaryFill, borderRadius: 10 },
  segment: { flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
  selected: {
    backgroundColor: colors.white,
    boxShadow: '0 3px 8px rgba(0, 0, 0, 0.12), 0 1px 1px rgba(0, 0, 0, 0.04)',
  },
  label: { ...type.subheadline, fontWeight: '500' },
  labelSelected: { fontWeight: '600' },
});
