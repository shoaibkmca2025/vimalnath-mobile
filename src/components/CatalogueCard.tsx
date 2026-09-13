import Feather from '@expo/vector-icons/Feather';
import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Catalogue, CatalogueTone } from '@/data/catalogues';
import { colors, fonts } from '@/theme';

const tones: Record<CatalogueTone, { card: string; border: string; cover: [string, string]; kicker: string; coverText: string; ring: string }> = {
  blue: { card: '#f4f7ff', border: '#e2e9fb', cover: ['#2458e8', '#6d94ff'], kicker: colors.blue, coverText: colors.white, ring: 'rgba(255,255,255,0.18)' },
  sand: { card: '#fff8ed', border: '#f3e6cf', cover: ['#b87942', '#e7b678'], kicker: '#a86d34', coverText: colors.white, ring: 'rgba(255,255,255,0.18)' },
  green: { card: '#eefaf6', border: '#d6eee5', cover: ['#2c896e', '#83c6af'], kicker: '#298064', coverText: colors.white, ring: 'rgba(255,255,255,0.18)' },
  muted: { card: '#f7f8fa', border: '#e9ebee', cover: ['#dce1e9', '#f4f6f9'], kicker: '#929aa7', coverText: '#647185', ring: 'rgba(100,113,133,0.13)' },
};

export function CatalogueCard({ catalogue, onPress }: { catalogue: Catalogue; onPress: () => void }) {
  const tone = tones[catalogue.tone];
  const available = Boolean(catalogue.url);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole={available ? 'link' : 'button'}
      accessibilityLabel={`${catalogue.title}. ${catalogue.meta}`}
      accessibilityHint={available ? 'Opens the PDF catalogue' : undefined}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: tone.card, borderColor: tone.border },
        pressed && { transform: [{ scale: 0.985 }], opacity: 0.92 },
      ]}
    >
      <LinearGradient colors={tone.cover} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }} style={styles.cover}>
        <View style={[styles.coverRing, { borderColor: tone.ring }]} />
        {available && (
          <View style={styles.coverRules}>
            <View style={[styles.coverRule, { opacity: 0.58 }]} />
            <View style={[styles.coverRule, { opacity: 0.38 }]} />
            <View style={[styles.coverRule, { opacity: 0.26 }]} />
          </View>
        )}
        <Text style={[styles.coverBrand, { color: tone.coverText }]}>TAITON</Text>
        <Text style={[styles.coverNumber, { color: tone.coverText }]}>{catalogue.number}</Text>
        <Text style={[styles.coverFoot, { color: tone.coverText }]}>{available ? 'CATALOGUE' : 'COMING SOON'}</Text>
      </LinearGradient>

      <View style={styles.copy}>
        <Text style={[styles.kicker, { color: tone.kicker }]}>{catalogue.kicker}</Text>
        <Text style={[styles.title, !available && { color: '#6b7380' }]} numberOfLines={2}>
          {catalogue.title}
        </Text>
        <Text style={styles.meta}>{catalogue.meta}</Text>
      </View>

      <View style={[styles.open, !available && styles.openMuted]}>
        <Feather name={available ? 'arrow-up-right' : 'clock'} size={17} color={available ? colors.blue : '#9aa1ac'} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 10, borderWidth: 1, borderRadius: 18 },
  cover: {
    width: 84,
    height: 108,
    justifyContent: 'space-between',
    overflow: 'hidden',
    paddingHorizontal: 9,
    paddingVertical: 9,
    borderRadius: 10,
  },
  coverRing: { position: 'absolute', right: -24, bottom: -28, width: 82, height: 82, borderWidth: 12, borderRadius: 41 },
  coverRules: { position: 'absolute', right: 10, top: 38, gap: 7, transform: [{ rotate: '-32deg' }] },
  coverRule: { width: 38, height: 1, backgroundColor: colors.white },
  coverBrand: { fontFamily: fonts.bold, fontSize: 8, letterSpacing: 0.8 },
  coverNumber: { alignSelf: 'center', fontFamily: fonts.display, fontSize: 30, lineHeight: 32 },
  coverFoot: { fontFamily: fonts.semibold, fontSize: 7, letterSpacing: 0.6, opacity: 0.85 },
  copy: { flex: 1, gap: 4 },
  kicker: { fontFamily: fonts.bold, fontSize: 10, letterSpacing: 0.8 },
  title: { color: colors.ink, fontFamily: fonts.display, fontSize: 16, lineHeight: 20, letterSpacing: -0.2 },
  meta: { color: colors.muted, fontFamily: fonts.regular, fontSize: 12 },
  open: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    backgroundColor: 'rgba(255,255,255,0.85)',
    borderRadius: 18,
  },
  openMuted: { backgroundColor: '#eceff3' },
});
