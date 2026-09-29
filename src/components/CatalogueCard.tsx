import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Catalogue, CatalogueTone } from '@/data/catalogues';
import { colors, type } from '@/theme';

// Cover art is content, so it keeps its own palette; the row around it uses the system colors.
const tones: Record<CatalogueTone, { cover: [string, string]; coverText: string; ring: string }> = {
  blue: { cover: ['#2458e8', '#6d94ff'], coverText: colors.white, ring: 'rgba(255,255,255,0.18)' },
  sand: { cover: ['#b87942', '#e7b678'], coverText: colors.white, ring: 'rgba(255,255,255,0.18)' },
  green: { cover: ['#2c896e', '#83c6af'], coverText: colors.white, ring: 'rgba(255,255,255,0.18)' },
  muted: { cover: ['#dce1e9', '#f4f6f9'], coverText: '#4f5a6b', ring: 'rgba(100,113,133,0.13)' },
};

/** A catalogue row for an inset-grouped list. */
export function CatalogueCard({ catalogue, onPress }: { catalogue: Catalogue; onPress: () => void }) {
  const tone = tones[catalogue.tone];
  const available = Boolean(catalogue.url);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole={available ? 'link' : 'button'}
      accessibilityLabel={`${catalogue.title}. ${catalogue.meta}${available ? '' : '. Coming soon'}`}
      accessibilityHint={available ? 'Opens the PDF catalogue' : undefined}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <LinearGradient colors={tone.cover} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }} style={styles.cover}>
        <View style={[styles.coverRing, { borderColor: tone.ring }]} />
        <Text style={[styles.coverBrand, { color: tone.coverText }]} maxFontSizeMultiplier={1}>
          TAITON
        </Text>
        <Text style={[styles.coverNumber, { color: tone.coverText }]} maxFontSizeMultiplier={1}>
          {catalogue.number}
        </Text>
      </LinearGradient>

      <View style={styles.copy}>
        <Text style={styles.kicker}>{catalogue.kicker}</Text>
        <Text style={type.headline} numberOfLines={2}>
          {catalogue.title}
        </Text>
        <Text style={styles.meta}>{available ? catalogue.meta : `${catalogue.meta} · Coming soon`}</Text>
      </View>

      <Ionicons name={available ? 'open-outline' : 'time-outline'} size={20} color={available ? colors.tint : colors.tertiaryLabel} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 12, paddingLeft: 12, paddingRight: 16 },
  pressed: { backgroundColor: colors.fill },
  cover: { width: 60, height: 78, justifyContent: 'space-between', overflow: 'hidden', padding: 7, borderRadius: 6 },
  coverRing: { position: 'absolute', right: -20, bottom: -22, width: 62, height: 62, borderWidth: 9, borderRadius: 31 },
  coverBrand: { fontSize: 11, lineHeight: 13, fontWeight: '700' },
  coverNumber: { alignSelf: 'center', marginBottom: 12, fontSize: 24, lineHeight: 28, fontWeight: '700' },
  copy: { flex: 1, gap: 2 },
  kicker: { ...type.caption1, color: colors.secondaryLabel, fontWeight: '500' },
  meta: { ...type.footnote, color: colors.secondaryLabel },
});
