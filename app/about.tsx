import Ionicons from '@expo/vector-icons/Ionicons';
import Constants from 'expo-constants';
import { Image } from 'expo-image';
import { StyleSheet, Text, View } from 'react-native';

import { InsetGroup, ValueRow } from '@/components/InsetGroup';
import { Screen } from '@/components/Screen';
import { primaryNav, type NavKey } from '@/data/navigation';
import { colors, fonts, radius, type } from '@/theme';

const DESCRIPTIONS: Record<NavKey, string> = {
  home: 'Browse Taiton hardware, office partitions and sliding systems with MRP, and add them to your cart.',
  catalog: 'Open the Taiton price lists as PDFs.',
  bar: 'Plan cuts from standard bars with the least waste. Works offline.',
  cutlist: 'Glass cutting sizes and material lists for telescopic, synchronized and sliding folding systems.',
  orders: 'Place orders from your cart and share them as PDFs.',
};

export default function AboutScreen() {
  return (
    <Screen title="About" back={{ fallback: '/' }} grouped>
      <View style={styles.identity} accessible accessibilityLabel="Vimalnath Sales Corporation. Architectural systems and hardware.">
        <View style={styles.mark}>
          <Image source={require('../assets/images/logo-mark.png')} style={styles.markImage} contentFit="cover" />
        </View>
        <Text style={styles.name}>Vimalnath</Text>
        <Text style={styles.company}>Sales Corporation</Text>
        <Text style={styles.tagline}>Architectural systems and hardware</Text>
      </View>

      <InsetGroup header="What you can do" separatorInset={58}>
        {primaryNav.map((item) => (
          <View key={item.key} style={styles.feature}>
            <View style={styles.featureIcon}>
              <Ionicons name={item.icon} size={18} color={colors.tint} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={type.headline}>{item.title}</Text>
              <Text style={styles.featureText}>{DESCRIPTIONS[item.key]}</Text>
            </View>
          </View>
        ))}
      </InsetGroup>

      <InsetGroup header="App">
        <ValueRow label="Version" value={Constants.expoConfig?.version ?? '—'} />
        <ValueRow label="Price lists" value="Taiton · Feb 2026" />
      </InsetGroup>
    </Screen>
  );
}

const styles = StyleSheet.create({
  identity: { alignItems: 'center', marginTop: 4, marginBottom: 28 },
  mark: {
    width: 76,
    height: 76,
    overflow: 'hidden',
    backgroundColor: colors.white,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.separator,
    borderRadius: 18,
  },
  markImage: { width: '100%', height: '100%', transform: [{ scale: 1.08 }] },
  name: { marginTop: 12, color: colors.label, fontFamily: fonts.brand, fontSize: 24, lineHeight: 28 },
  company: { ...type.footnote, marginTop: 1, color: colors.secondaryLabel, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.8 },
  tagline: { ...type.subheadline, marginTop: 8, color: colors.secondaryLabel },
  feature: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 12, paddingHorizontal: 14 },
  featureIcon: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.tintFill, borderRadius: radius.sm },
  featureText: { ...type.subheadline, marginTop: 1, color: colors.secondaryLabel },
});
