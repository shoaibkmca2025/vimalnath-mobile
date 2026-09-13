import { Image } from 'expo-image';
import { StyleSheet, Text, View } from 'react-native';

import { colors, fonts } from '@/theme';

export function BrandLockup({ inverted = false }: { inverted?: boolean }) {
  return (
    <View style={styles.lockup} accessible accessibilityLabel="Vimalnath Sales Corporation">
      <View style={styles.mark}>
        <Image source={require('../../assets/images/logo-mark.png')} style={styles.markImage} contentFit="cover" />
      </View>
      <View>
        <Text style={[styles.name, inverted && { color: colors.white }]}>Vimalnath</Text>
        <Text style={[styles.subtitle, inverted && { color: '#9ca9c5' }]}>SALES CORPORATION</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  lockup: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  mark: {
    width: 36,
    height: 36,
    overflow: 'hidden',
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: '#dce4ef',
    borderRadius: 10,
    transform: [{ skewX: '-8deg' }],
  },
  markImage: { width: '100%', height: '100%', transform: [{ skewX: '8deg' }, { scale: 1.08 }] },
  name: { color: colors.ink, fontFamily: fonts.display, fontSize: 17, lineHeight: 19, letterSpacing: -0.3 },
  subtitle: { marginTop: 3, color: colors.muted, fontFamily: fonts.medium, fontSize: 9, letterSpacing: 1.2 },
});
