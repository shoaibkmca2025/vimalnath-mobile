import { Children, Fragment, isValidElement, type ReactNode } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, radius, type } from '@/theme';

type Props = {
  children: ReactNode;
  header?: string;
  footer?: string;
  /** Leading inset of the separators, so they line up with the row text. */
  separatorInset?: number;
  style?: StyleProp<ViewStyle>;
};

/** iOS inset-grouped list section: a rounded card of rows divided by hairlines, with optional header and footer. */
export function InsetGroup({ children, header, footer, separatorInset = 16, style }: Props) {
  const rows = Children.toArray(children).filter(isValidElement);
  return (
    <View style={[styles.section, style]}>
      {header && (
        <Text style={styles.header} accessibilityRole="header">
          {header}
        </Text>
      )}
      <View style={styles.group}>
        {rows.map((row, index) => (
          <Fragment key={row.key ?? index}>
            {index > 0 && <View style={[styles.separator, { marginLeft: separatorInset }]} />}
            {row}
          </Fragment>
        ))}
      </View>
      {footer && <Text style={styles.footer}>{footer}</Text>}
    </View>
  );
}

/** A label/value row, as in Settings. */
export function ValueRow({ label, value, detail, emphasized = false }: { label: string; value: string; detail?: string; emphasized?: boolean }) {
  return (
    <View style={styles.valueRow} accessible accessibilityLabel={`${label}, ${value}`}>
      <View style={styles.valueLabelBox}>
        <Text style={emphasized ? type.headline : type.body}>{label}</Text>
        {detail && <Text style={styles.detail}>{detail}</Text>}
      </View>
      <Text style={[emphasized ? type.headline : type.body, styles.value, !emphasized && { color: colors.secondaryLabel }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginBottom: 28 },
  header: { ...type.footnote, marginBottom: 7, marginHorizontal: 16, color: colors.secondaryLabel, textTransform: 'uppercase' },
  group: { overflow: 'hidden', backgroundColor: colors.card, borderRadius: radius.md },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: colors.separator },
  footer: { ...type.footnote, marginTop: 7, marginHorizontal: 16, color: colors.secondaryLabel },
  valueRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 16, paddingVertical: 11 },
  valueLabelBox: { flexShrink: 1 },
  detail: { ...type.footnote, marginTop: 2, color: colors.secondaryLabel },
  value: { flex: 1, textAlign: 'right' },
});
