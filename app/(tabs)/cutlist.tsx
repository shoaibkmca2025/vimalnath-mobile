import Feather from '@expo/vector-icons/Feather';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { FoldingIllustration } from '@/components/FoldingIllustration';
import { Screen } from '@/components/Screen';
import { ScreenTitle } from '@/components/ScreenTitle';
import { cutlistSystems, type CutlistSystem } from '@/data/cutlist';
import { pad2 } from '@/lib/format';
import { useAppUI } from '@/providers/AppUIProvider';
import { colors, fonts } from '@/theme';

export default function CutlistScreen() {
  const { showToast } = useAppUI();

  const open = (system: CutlistSystem) => {
    if (system.id === 'telescopic') router.push('/telescopic');
    else showToast(`${system.name} selected.`);
  };

  return (
    <Screen>
      <ScreenTitle eyebrow="FABRICATION SYSTEMS" title="Cutlist" />

      <View style={styles.list}>
        {cutlistSystems.map((system, index) => (
          <Pressable
            key={system.id}
            onPress={() => open(system)}
            accessibilityRole="button"
            accessibilityLabel={`${system.name}. ${system.subtitle}`}
            style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
          >
            <View style={styles.media}>
              {system.photo ? (
                <Image source={system.photo} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} />
              ) : (
                <FoldingIllustration />
              )}
              <View style={styles.index}>
                <Text style={styles.indexText}>{pad2(index + 1)}</Text>
              </View>
            </View>
            <View style={styles.copy}>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{system.name}</Text>
                <Text style={styles.subtitle}>{system.subtitle}</Text>
              </View>
              <View style={styles.go}>
                <Feather name="arrow-right" size={18} color={colors.blue} />
              </View>
            </View>
          </Pressable>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { gap: 16 },
  card: {
    overflow: 'hidden',
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 20,
    boxShadow: '0 5px 15px rgba(20, 30, 50, 0.05)',
  },
  cardPressed: { borderColor: '#bdcaf0', transform: [{ scale: 0.99 }] },
  media: { aspectRatio: 16 / 10, overflow: 'hidden', backgroundColor: '#e9eef3' },
  index: {
    position: 'absolute',
    top: 12,
    left: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: 'rgba(255,255,255,0.88)',
    borderRadius: 8,
  },
  indexText: { color: colors.ink, fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.5 },
  copy: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
  name: { color: colors.ink, fontFamily: fonts.display, fontSize: 18, letterSpacing: -0.3 },
  subtitle: { marginTop: 3, color: colors.muted, fontFamily: fonts.regular, fontSize: 13 },
  go: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.blueTint, borderRadius: 19 },
});
