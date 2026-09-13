import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, Text, View } from 'react-native';

import { colors, fonts } from '@/theme';

// Fixed sparkle positions (fractions of the card) standing in for the prototype's radial dot pattern.
const SPARKLES = [
  [0.86, 0.16], [0.74, 0.3], [0.93, 0.44], [0.62, 0.12], [0.8, 0.62], [0.95, 0.8], [0.55, 0.7], [0.7, 0.88],
];

export function HeroCard() {
  return (
    <LinearGradient
      colors={['#112044', '#1d3c8e', '#346cf2']}
      locations={[0, 0.58, 1]}
      start={{ x: 0, y: 0.15 }}
      end={{ x: 1, y: 0.85 }}
      style={styles.card}
      accessible
      accessibilityLabel="New collection 2026. Systems that move with you. Sliding, folding and slim partition solutions."
    >
      {/* Concentric translucent discs approximate the prototype's blurred glow without a blur filter. */}
      {[
        { size: 300, opacity: 0.06 },
        { size: 250, opacity: 0.08 },
        { size: 200, opacity: 0.1 },
        { size: 150, opacity: 0.12 },
      ].map(({ size, opacity }) => (
        <View key={size} style={[styles.glow, { width: size, height: size, right: 30 - size / 2, top: 30 - size / 2, opacity }]} />
      ))}
      {SPARKLES.map(([x, y], index) => (
        <View key={index} style={[styles.sparkle, { left: `${x * 100}%`, top: `${y * 100}%` }]} />
      ))}

      <View style={styles.visual}>
        <View style={[styles.panel, styles.panelBack]} />
        <View style={[styles.panel, styles.panelShadow]} />
        <View style={[styles.panel, styles.panelFront]}>
          <View style={[styles.panelRule, { left: 21 }]} />
          <View style={[styles.panelRule, { right: 20 }]} />
          <Text style={styles.panelLabel}>
            SF{'\n'}
            <Text style={styles.panelLabelSmall}>2400</Text>
          </Text>
        </View>
        <View style={styles.line} />
      </View>

      <View style={styles.copy}>
        <Text style={styles.kicker}>NEW COLLECTION · 2026</Text>
        <Text style={styles.headline}>
          Systems that{'\n'}
          <Text style={{ color: '#98b7ff' }}>move with you.</Text>
        </Text>
        <Text style={styles.body}>Sliding, folding and slim partition solutions.</Text>
      </View>

      <View style={styles.dots}>
        <View style={[styles.dot, styles.dotActive]} />
        <View style={styles.dot} />
        <View style={styles.dot} />
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  card: { minHeight: 244, overflow: 'hidden', paddingHorizontal: 22, paddingTop: 26, paddingBottom: 48, borderRadius: 24 },
  glow: { position: 'absolute', backgroundColor: '#6caaff', borderRadius: 999 },
  sparkle: { position: 'absolute', width: 2, height: 2, borderRadius: 1, backgroundColor: colors.white, opacity: 0.45 },
  copy: { width: '66%' },
  kicker: { color: '#bcd1ff', fontFamily: fonts.bold, fontSize: 10, letterSpacing: 1.3 },
  headline: { marginTop: 14, marginBottom: 10, color: colors.white, fontFamily: fonts.display, fontSize: 26, lineHeight: 28, letterSpacing: -1 },
  // Narrower than the headline so the copy stays clear of the panel illustration.
  body: { maxWidth: 176, color: '#d5e0ff', fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  visual: { position: 'absolute', width: 176, height: 184, right: -6, bottom: -16, pointerEvents: 'none', transform: [{ rotate: '-10deg' }] },
  panel: {
    position: 'absolute',
    width: 80,
    height: 154,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.58)',
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  panelBack: { right: 20, top: 4, opacity: 0.42, transform: [{ skewY: '9deg' }] },
  panelShadow: { right: 50, top: 37, borderWidth: 0, backgroundColor: 'rgba(7,23,64,0.18)', transform: [{ skewY: '-7deg' }] },
  panelFront: { right: 68, top: 22, transform: [{ skewY: '-7deg' }] },
  panelRule: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: 'rgba(255,255,255,0.5)' },
  panelLabel: { position: 'absolute', left: 12, bottom: 12, color: '#c9dbff', fontFamily: fonts.display, fontSize: 16, lineHeight: 15 },
  panelLabelSmall: { fontFamily: fonts.medium, fontSize: 8, letterSpacing: 1 },
  line: { position: 'absolute', right: 18, top: 20, width: 1, height: 136, backgroundColor: '#9fc0ff', transform: [{ rotate: '11deg' }] },
  dots: { position: 'absolute', left: 22, bottom: 20, flexDirection: 'row', gap: 5 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.4)' },
  dotActive: { width: 20, backgroundColor: colors.white },
});
