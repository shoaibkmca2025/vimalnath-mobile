import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View } from 'react-native';

const INK = 'rgba(18,78,62,';

/** Drawn stand-in for the Sliding Folding System until a product photo is supplied. */
export function FoldingIllustration() {
  return (
    <LinearGradient colors={['#d9efe7', '#65ad94']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill}>
      <View style={styles.stage}>
        <View style={styles.frame} />
        <View style={[styles.floor, { bottom: 34, opacity: 1 }]} />
        <View style={[styles.floor, { bottom: 72, opacity: 0.4 }]} />
        {[0, 14, 29].map((angle, index) => (
          <View key={angle} style={[styles.panel, { left: 44 + index * 58, transform: [{ rotate: `${angle}deg` }] }]} />
        ))}
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  stage: { position: 'absolute', alignSelf: 'center', top: '50%', width: 300, height: 190, marginTop: -95 },
  frame: { position: 'absolute', top: 18, bottom: 20, left: 40, right: 50, borderWidth: 2, borderColor: `${INK}0.5)` },
  floor: { position: 'absolute', left: 20, right: 20, height: 1, backgroundColor: `${INK}0.38)`, transform: [{ rotate: '-5deg' }] },
  panel: {
    position: 'absolute',
    top: 26,
    width: 58,
    height: 136,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.72)',
    backgroundColor: 'rgba(255,255,255,0.12)',
    transformOrigin: 'bottom left',
  },
});
