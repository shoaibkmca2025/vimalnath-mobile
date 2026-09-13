import Feather from '@expo/vector-icons/Feather';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Screen } from '@/components/Screen';
import { telescopicConfigurations } from '@/data/cutlist';
import { pad2 } from '@/lib/format';
import { useAppUI } from '@/providers/AppUIProvider';
import { colors, fonts, type } from '@/theme';

export default function TelescopicScreen() {
  const { showToast } = useAppUI();

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/cutlist');
  };

  return (
    <Screen>
      <View style={styles.top}>
        <Pressable
          onPress={goBack}
          accessibilityRole="button"
          accessibilityLabel="Back to cutlist"
          style={({ pressed }) => [styles.back, pressed && { backgroundColor: colors.blueTint }]}
        >
          <Feather name="arrow-left" size={21} color={colors.ink} />
        </Pressable>
        <View style={{ flexShrink: 1 }}>
          <Text style={type.eyebrow}>CUTLIST SYSTEM</Text>
          <Text style={[type.title, { fontSize: 28, lineHeight: 32 }]} accessibilityRole="header">
            Telescopic Sliding
          </Text>
        </View>
      </View>
      <Text style={styles.intro}>Choose a sliding configuration to view its cutting setup.</Text>

      <View style={styles.grid}>
        {telescopicConfigurations.map((configuration, index) => (
          <Pressable
            key={index}
            onPress={() => showToast(`${configuration.name} selected.`)}
            accessibilityRole="button"
            accessibilityLabel={`${configuration.name}, configuration ${index + 1}`}
            style={({ pressed }) => [styles.tile, pressed && styles.tilePressed]}
          >
            <Image source={configuration.image} style={styles.tileImage} contentFit="cover" transition={120} />
            <View style={styles.tileCopy}>
              <Text style={styles.tileName} numberOfLines={1}>
                {configuration.name}
              </Text>
              <Text style={styles.tileMeta}>Configuration {pad2(index + 1)}</Text>
            </View>
          </Pressable>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 10 },
  back: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.soft,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 13,
  },
  intro: { ...type.body, marginLeft: 56, marginBottom: 20 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 14 },
  tile: { width: '48%', overflow: 'hidden', backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, borderRadius: 16 },
  tilePressed: { borderColor: '#bdcaf0', transform: [{ scale: 0.98 }] },
  tileImage: { width: '100%', aspectRatio: 261 / 321, backgroundColor: '#dbe8ed' },
  tileCopy: { paddingHorizontal: 12, paddingTop: 10, paddingBottom: 12, gap: 2 },
  tileName: { color: colors.ink, fontFamily: fonts.display, fontSize: 14 },
  tileMeta: { color: colors.muted, fontFamily: fonts.regular, fontSize: 12 },
});
