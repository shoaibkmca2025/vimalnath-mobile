import Constants from 'expo-constants';
import { Image } from 'expo-image';
import { StyleSheet, Text, View } from 'react-native';

import { InsetGroup, ValueRow } from '@/components/InsetGroup';
import { Screen } from '@/components/Screen';
import { colors, fonts, radius, type } from '@/theme';

const FEATURES = [
  'Shop Taiton hardware, partitions and sliding systems with catalogue prices',
  'Place orders and share them as PDF',
  'Glass cutting sizes and material lists for telescopic, synchronized and folding systems, in mm or inches',
  'Bar optimizer to cut pieces from standard bars with the least waste',
];

export default function AboutScreen() {
  return (
    <Screen title="About" back={{ fallback: '/', label: 'Back' }} grouped>
      <View style={styles.hero}>
        <View style={styles.logo}>
          <Image cachePolicy="memory" source={require('../assets/images/logo-mark.png')} style={styles.logoImage} contentFit="cover" />
        </View>
        <Text style={styles.name}>Vimalnath</Text>
        <Text style={styles.tagline}>SALES CORPORATION</Text>
      </View>

      <InsetGroup header="What you can do">
        {FEATURES.map((feature) => (
          <View key={feature} style={styles.feature}>
            <View style={styles.dot} />
            <Text style={styles.featureText}>{feature}</Text>
          </View>
        ))}
      </InsetGroup>

      <InsetGroup>
        <ValueRow label="Version" value={Constants.expoConfig?.version ?? '1.0.0'} />
        <ValueRow label="Developed by" value="4AM Global Media" />
      </InsetGroup>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', marginBottom: 28 },
  logo: { width: 84, height: 84, overflow: 'hidden', backgroundColor: colors.white, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.separator },
  logoImage: { width: '100%', height: '100%' },
  name: { marginTop: 12, color: colors.label, fontFamily: fonts.brand, fontSize: 26, lineHeight: 30 },
  tagline: { ...type.footnote, marginTop: 2, color: colors.secondaryLabel, fontWeight: '600', letterSpacing: 1 },
  feature: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingHorizontal: 16, paddingVertical: 11 },
  dot: { width: 6, height: 6, marginTop: 7, backgroundColor: colors.tint, borderRadius: 3 },
  featureText: { ...type.subheadline, flex: 1 },
});
