import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, fonts, type } from '@/theme';

export function ScreenTitle({ eyebrow, title, accessory }: { eyebrow: string; title: string; accessory?: ReactNode }) {
  return (
    <View style={styles.row}>
      <View style={styles.copy}>
        <Text style={type.eyebrow}>{eyebrow}</Text>
        <Text style={type.title} accessibilityRole="header">
          {title}
        </Text>
      </View>
      {accessory}
    </View>
  );
}

type PillTone = 'blue' | 'green';

export function Pill({ children, tone = 'blue', dot = false }: { children: string; tone?: PillTone; dot?: boolean }) {
  const palette = tone === 'green' ? { fg: colors.green, bg: colors.greenTint } : { fg: colors.blue, bg: colors.blueTint };
  return (
    <View style={[styles.pill, { backgroundColor: palette.bg }]}>
      {dot && <View style={[styles.pillDot, { backgroundColor: palette.fg }]} />}
      <Text style={[styles.pillText, { color: palette.fg }]}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 22 },
  copy: { flexShrink: 1 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 11, paddingVertical: 7, borderRadius: 20 },
  pillDot: { width: 6, height: 6, borderRadius: 3 },
  pillText: { fontFamily: fonts.bold, fontSize: 11 },
});
