import { StyleSheet, Text, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native';

import { colors, radius, type } from '@/theme';

type Props = TextInputProps & {
  /** Visible label above the field, so its purpose stays clear after the placeholder disappears. */
  label?: string;
  /** Shown directly under the field. */
  error?: string | null;
  /** Fixed unit after the value, e.g. “mm”. */
  unit?: string;
  /** Use `card` on the grouped background, `fill` on white surfaces. */
  surface?: 'fill' | 'card';
  containerStyle?: StyleProp<ViewStyle>;
};

export function TextField({ label, error, unit, surface = 'card', containerStyle, style, multiline, accessibilityLabel, ...input }: Props) {
  return (
    <View style={containerStyle}>
      {label && <Text style={styles.label}>{label}</Text>}
      <View
        style={[
          styles.field,
          { backgroundColor: surface === 'card' ? colors.card : colors.tertiaryFill },
          multiline && styles.multiline,
          error ? styles.fieldError : null,
        ]}
      >
        <TextInput
          placeholderTextColor={colors.tertiaryLabel}
          selectionColor={colors.tint}
          cursorColor={colors.tint}
          multiline={multiline}
          accessibilityLabel={accessibilityLabel ?? label}
          accessibilityHint={error ?? undefined}
          style={[styles.input, multiline && styles.inputMultiline, style]}
          {...input}
        />
        {unit && <Text style={styles.unit}>{unit}</Text>}
      </View>
      {error ? (
        <Text style={styles.error} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  label: { ...type.footnote, marginBottom: 6, marginLeft: 4, color: colors.secondaryLabel },
  field: { minHeight: 48, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, borderRadius: radius.md, borderWidth: 1, borderColor: 'transparent' },
  multiline: { alignItems: 'flex-start', paddingVertical: 11 },
  fieldError: { borderColor: colors.red },
  input: { ...type.body, flex: 1, minWidth: 0, minHeight: 46, padding: 0 },
  inputMultiline: { minHeight: 66, textAlignVertical: 'top' },
  unit: { ...type.body, marginLeft: 8, color: colors.secondaryLabel },
  error: { ...type.footnote, marginTop: 6, marginLeft: 4, color: colors.red },
});
