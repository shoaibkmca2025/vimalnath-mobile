import { StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { WasteStripes } from '@/components/WasteStripes';
import type { BarPlan } from '@/lib/bar-optimizer';
import { formatMm, formatNumber, pad2 } from '@/lib/format';
import { colors, radius, type } from '@/theme';

type Props = {
  plan: BarPlan;
  onShare: () => void;
  onExport: () => void;
};

// Neighbouring pieces alternate between two blues; white text keeps at least 4.5:1 on both.
const PIECE_COLORS = [colors.tint, '#1a3fa8'];

export function BarResultPanel({ plan, onShare, onExport }: Props) {
  const stats = [
    { label: 'Total material', value: formatMm(plan.totalMaterial) },
    { label: 'Waste', value: formatMm(plan.waste) },
    { label: 'Utilization', value: `${plan.utilization.toFixed(1)}%` },
  ];

  return (
    <View style={styles.panel}>
      <View style={styles.header}>
        <View style={{ flexShrink: 1 }}>
          <Text style={type.title3} accessibilityRole="header">
            Bar Plan
          </Text>
          <Text style={styles.headerMeta}>
            {plan.cuts} cuts · {plan.kerf} mm loss per cut
          </Text>
        </View>
        <View style={styles.headline} accessible accessibilityLabel={`${plan.bars.length} ${plan.bars.length === 1 ? 'bar' : 'bars'} required`}>
          <Text style={styles.headlineNumber}>{plan.bars.length}</Text>
          <Text style={styles.headlineLabel}>{plan.bars.length === 1 ? 'bar required' : 'bars required'}</Text>
        </View>
      </View>

      <View style={styles.stats}>
        {stats.map((stat) => (
          <View key={stat.label} style={styles.stat} accessible accessibilityLabel={`${stat.label}, ${stat.value}`}>
            <Text style={styles.statLabel}>{stat.label}</Text>
            <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit>
              {stat.value}
            </Text>
          </View>
        ))}
      </View>

      <View style={styles.bars}>
        {plan.bars.map((bar, barIndex) => (
          <View key={barIndex} accessible accessibilityLabel={`Bar ${barIndex + 1}: pieces ${bar.pieces.join(', ')} millimetres, ${formatMm(bar.used)} used of ${formatMm(bar.length)}`}>
            <View style={styles.barLabel}>
              <Text style={styles.barLabelText}>Bar {pad2(barIndex + 1)}</Text>
              <Text style={styles.barLabelText}>
                {formatNumber(bar.used)} / {formatMm(bar.length)}
              </Text>
            </View>
            <View style={styles.track}>
              {bar.pieces.map((piece, pieceIndex) => (
                <View
                  key={pieceIndex}
                  style={[styles.piece, { width: `${(piece / bar.length) * 100}%`, backgroundColor: PIECE_COLORS[pieceIndex % 2] }]}
                >
                  <Text style={styles.pieceText} numberOfLines={1} maxFontSizeMultiplier={1}>
                    {piece}
                  </Text>
                </View>
              ))}
              <View style={styles.waste}>
                <WasteStripes />
              </View>
            </View>
          </View>
        ))}
      </View>

      {/* Waste is shown by the hatch pattern as well as its color. */}
      <View style={styles.legend} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <View style={styles.legendItem}>
          <View style={[styles.legendSwatch, { backgroundColor: colors.tint }]} />
          <Text style={styles.legendText}>Cut piece</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={styles.legendSwatch}>
            <WasteStripes />
          </View>
          <Text style={styles.legendText}>Offcut</Text>
        </View>
      </View>

      <View style={styles.actions}>
        <Button label="Share Plan" icon="share-outline" variant="gray" size="medium" onPress={onShare} style={styles.action} />
        <Button label="Export PDF" icon="document-text-outline" variant="gray" size="medium" onPress={onExport} style={styles.action} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { marginTop: 28, padding: 16, backgroundColor: colors.card, borderRadius: radius.lg },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 16 },
  headerMeta: { ...type.footnote, marginTop: 2, color: colors.secondaryLabel },
  headline: { alignItems: 'flex-end' },
  headlineNumber: { ...type.largeTitle, fontVariant: ['tabular-nums'] },
  headlineLabel: { ...type.caption1, color: colors.secondaryLabel },
  stats: { flexDirection: 'row', gap: 8, marginBottom: 20 },
  // space-between keeps values on one baseline when a label wraps to two lines.
  stat: { flex: 1, justifyContent: 'space-between', paddingHorizontal: 10, paddingVertical: 10, backgroundColor: colors.groupedBackground, borderRadius: radius.sm + 2 },
  statLabel: { ...type.caption1, marginBottom: 4, color: colors.secondaryLabel },
  statValue: { ...type.headline, fontVariant: ['tabular-nums'] },
  bars: { gap: 14 },
  barLabel: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 },
  barLabelText: { ...type.caption1, color: colors.secondaryLabel, fontVariant: ['tabular-nums'] },
  track: { flexDirection: 'row', height: 28, overflow: 'hidden', backgroundColor: colors.groupedBackground, borderRadius: 6 },
  piece: { minWidth: 2, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderRightWidth: 2, borderRightColor: colors.card },
  pieceText: { ...type.caption2, color: colors.white, fontWeight: '600', fontVariant: ['tabular-nums'] },
  waste: { flex: 1, overflow: 'hidden' },
  legend: { flexDirection: 'row', gap: 18, marginTop: 14 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendSwatch: { width: 14, height: 14, overflow: 'hidden', borderRadius: 3 },
  legendText: { ...type.caption1, color: colors.secondaryLabel },
  actions: { flexDirection: 'row', gap: 10, marginTop: 18 },
  action: { flex: 1 },
});
