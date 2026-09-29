import { Image } from 'expo-image';
import { StyleSheet, Text, View } from 'react-native';

import { colors, fonts } from '@/theme';

export function BrandLockup() {
  return (
    <View style={styles.lockup} accessible accessibilityRole="header" accessibilityLabel="Vimalnath Sales Corporation">
      <View style={styles.mark}>
        <Image source={require('../../assets/images/logo-mark.png')} style={styles.markImage} contentFit="cover" />
      </View>
      <View>
        <Text style={styles.name} maxFontSizeMultiplier={1.2}>
          Vimalnath
        </Text>
        <Text style={styles.subtitle} maxFontSizeMultiplier={1.2}>
          SALES CORPORATION
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  lockup: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  mark: {
    width: 32,
    height: 32,
    overflow: 'hidden',
    backgroundColor: colors.white,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.separator,
    borderRadius: 8,
    transform: [{ skewX: '-8deg' }],
  },
  markImage: { width: '100%', height: '100%', transform: [{ skewX: '8deg' }, { scale: 1.08 }] },
  name: { color: colors.label, fontFamily: fonts.brand, fontSize: 17, lineHeight: 19 },
  subtitle: { marginTop: 1, color: colors.secondaryLabel, fontSize: 11, lineHeight: 13, fontWeight: '500', letterSpacing: 0.6 },
});
