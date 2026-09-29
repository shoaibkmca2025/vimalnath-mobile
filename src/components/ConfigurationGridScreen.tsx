import Feather from '@expo/vector-icons/Feather';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View, type ImageSourcePropType } from 'react-native';

import { Screen } from '@/components/Screen';
import { pad2 } from '@/lib/format';
import { colors, fonts, type } from '@/theme';

export type Configuration = { name: string; image: ImageSourcePropType };

type Props = {
  eyebrow: string;
  title: string;
  intro: string;
  backLabel: string;
  backRoute: string;
  /** This screen's own route, so the glass calculator can return here if it has no back history. */
  ownRoute: string;
  configurations: Configuration[];
};

/** Shared "choose a configuration" grid, used by Telescopic Sliding, Synchronized System, etc. */
export function ConfigurationGridScreen({ eyebrow, title, intro, backLabel, backRoute, ownRoute, configurations }: Props) {
  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace(backRoute);
  };

  return (
    <Screen>
      <View style={styles.top}>
        <Pressable
          onPress={goBack}
          accessibilityRole="button"
          accessibilityLabel={backLabel}
          style={({ pressed }) => [styles.back, pressed && { backgroundColor: colors.blueDark }]}
        >
          <Feather name="arrow-left" size={21} color={colors.white} />
        </Pressable>
        <View style={{ flexShrink: 1 }}>
          <Text style={type.eyebrow}>{eyebrow}</Text>
          <Text style={[type.title, { fontSize: 28, lineHeight: 32 }]} accessibilityRole="header">
            {title}
          </Text>
        </View>
      </View>
      <Text style={styles.intro}>{intro}</Text>

      <View style={styles.grid}>
        {configurations.map((configuration, index) => (
          <Pressable
            key={index}
            onPress={() =>
              router.push({ pathname: '/glass-calculator', params: { name: configuration.name, eyebrow, fallbackRoute: ownRoute } })
            }
            accessibilityRole="button"
            accessibilityLabel={`${configuration.name}, configuration ${index + 1}`}
            style={({ pressed }) => [styles.tile, pressed && styles.tilePressed]}
          >
            <Image source={configuration.image} style={styles.tileImage} contentFit="cover" transition={120} />
            <View style={styles.tileCopy}>
              <Text style={styles.tileName} numberOfLines={2}>
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
    backgroundColor: colors.blue,
    borderRadius: 13,
  },
  intro: { ...type.body, marginLeft: 56, marginBottom: 20 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 14 },
  tile: { width: '48%', overflow: 'hidden', backgroundColor: colors.blue, borderWidth: 1, borderColor: colors.line, borderRadius: 16 },
  tilePressed: { borderColor: colors.blueDark, transform: [{ scale: 0.98 }] },
  tileImage: { width: '100%', aspectRatio: 1, backgroundColor: '#e6eeff' },
  tileCopy: { paddingHorizontal: 12, paddingTop: 10, paddingBottom: 12, gap: 2, backgroundColor: colors.blue },
  tileName: { color: colors.white, fontFamily: fonts.display, fontSize: 14 },
  tileMeta: { color: '#c9d8ff', fontFamily: fonts.regular, fontSize: 12 },
});
