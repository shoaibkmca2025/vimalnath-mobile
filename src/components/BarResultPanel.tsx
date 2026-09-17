import Feather from '@expo/vector-icons/Feather';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { WasteStripes } from '@/components/WasteStripes';
import type { BarPlan } from '@/lib/bar-optimizer';
import { formatMm, formatNumber, pad2 } from '@/lib/format';
import { colors, fonts } from '@/theme';

type Props = {
  plan: BarPlan;
  onShare: () => void;
  onExport: () => void;
};

export function BarResultPanel({ plan, onShare, onExport }: Props) {
  const stats = [
    { label: 'Total material', value: formatMm(plan.totalMaterial) },
    { label: 'Estimated waste', value: formatMm(plan.waste) },
    { label: 'Utilization', value: `${plan.utilization.toFixed(1)}%` },
  ];

  return (
    <View style={styles.panel}>
      <View style={styles.header}>
        <View style={{ flexShrink: 1 }}>
          <Text style={styles.kicker}>OPTIMIZED RESULT</Text>
          <Text style={styles.title}>Bar plan ready</Text>
        </View>
        <View style={styles.headline}>
          <Text style={styles.headlineNumber}>{plan.bars.length}</Text>
          <Text style={styles.headlineLabel}>{plan.bars.length === 1 ? 'bar required' : 'bars required'}</Text>
        </View>
      </View>

      <View style={styles.stats}>
        {stats.map((stat) => (
          <View key={stat.label} style={styles.stat}>
            <Text style={styles.statLabel}>{stat.label}</Text>
            <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit>
              {stat.value}
            </Text>
          </View>
        ))}
      </View>

      <View style={styles.layoutTitle}>
        <Text style={styles.layoutTitleText}>Cut arrangement · {plan.kerf} mm loss per cut</Text>
        <Text style={styles.layoutTitleText}>{plan.cuts} cuts</Text>
      </View>

      <View style={styles.bars}>
        {plan.bars.map((bar, barIndex) => (
          <View key={barIndex} accessible accessibilityLabel={`Bar ${barIndex + 1}: pieces ${bar.pieces.join(', ')} millimetres, ${formatMm(bar.used)} used`}>
            <View style={styles.barLabel}>
              <Text style={styles.barLabelText}>BAR {pad2(barIndex + 1)}</Text>
              <Text style={styles.barLabelText}>
                {formatNumber(bar.used)} / {formatMm(bar.length)}
              </Text>
            </View>
            <View style={styles.track}>
              {bar.pieces.map((piece, pieceIndex) => (
                <View
                  key={pieceIndex}
                  style={[
                    styles.piece,
                    { width: `${(piece / bar.length) * 100}%`, backgroundColor: pieceIndex % 2 ? '#7c9dff' : '#4e7af2' },
                  ]}
                >
                  <Text style={styles.pieceText} numberOfLines={1}>
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

      <View style={styles.actions}>
        <Pressable onPress={onShare} accessibilityRole="button" style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}>
          <Feather name="share-2" size={16} color="#d9e3ff" />
          <Text style={styles.actionText}>Share plan</Text>
        </Pressable>
        <Pressable onPress={onExport} accessibilityRole="button" style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}>
          <Feather name="file-text" size={16} color="#d9e3ff" />
          <Text style={styles.actionText}>Export report</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { marginTop: 24, padding: 18, backgroundColor: colors.navy, borderRadius: 22 },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 18 },
  kicker: { marginBottom: 6, color: '#91adf5', fontFamily: fonts.bold, fontSize: 10, letterSpacing: 1.3 },
  title: { color: colors.white, fontFamily: fonts.display, fontSize: 22, letterSpacing: -0.5 },
  headline: { alignItems: 'flex-end' },
  headlineNumber: { color: '#9db8ff', fontFamily: fonts.display, fontSize: 40, lineHeight: 42 },
  headlineLabel: { color: '#9aa7c5', fontFamily: fonts.regular, fontSize: 11 },
  stats: { flexDirection: 'row', gap: 8, marginBottom: 18 },
  // space-between keeps values on one baseline when a label wraps to two lines.
  stat: { flex: 1, justifyContent: 'space-between', paddingHorizontal: 10, paddingVertical: 11, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 12 },
  statLabel: { marginBottom: 5, color: '#aab6ce', fontFamily: fonts.regular, fontSize: 11 },
  statValue: { color: colors.white, fontFamily: fonts.bold, fontSize: 14 },
  layoutTitle: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, marginBottom: 10 },
  layoutTitleText: { color: '#aab6ce', fontFamily: fonts.regular, fontSize: 11 },
  bars: { gap: 12 },
  barLabel: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  barLabelText: { color: colors.white, fontFamily: fonts.medium, fontSize: 11 },
  track: { flexDirection: 'row', height: 30, overflow: 'hidden', backgroundColor: colors.navyRaised, borderRadius: 7 },
  piece: { minWidth: 2, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderRightWidth: 2, borderRightColor: colors.navy },
  pieceText: { color: colors.white, fontFamily: fonts.semibold, fontSize: 10 },
  waste: { flex: 1, overflow: 'hidden' },
  actions: { flexDirection: 'row', gap: 8, marginTop: 18 },
  action: {
    flex: 1,
    height: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,255,255,0.09)',
    borderRadius: 12,
  },
  actionPressed: { backgroundColor: 'rgba(255,255,255,0.16)' },
  actionText: { color: '#d9e3ff', fontFamily: fonts.bold, fontSize: 13 },
});
