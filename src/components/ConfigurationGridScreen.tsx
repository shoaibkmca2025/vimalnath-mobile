import { Image } from 'expo-image';
import { router, type Href } from 'expo-router';
import { Pressable, StyleSheet, Text, View, type ImageSourcePropType } from 'react-native';

import { Screen } from '@/components/Screen';
import { pad2 } from '@/lib/format';
import { colors, radius, type } from '@/theme';

export type Configuration = { name: string; image: ImageSourcePropType };

type Props = {
  title: string;
  intro: string;
  /** Title of the screen back returns to, shown on the back button. */
  backLabel: string;
  backRoute: Href;
  /** This screen's own route, so the glass calculator can return here if it has no back history. */
  ownRoute: string;
  configurations: Configuration[];
};

/** Shared "choose a configuration" grid, used by Telescopic Sliding, Synchronized System, etc. */
export function ConfigurationGridScreen({ title, intro, backLabel, backRoute, ownRoute, configurations }: Props) {
  return (
    <Screen title={title} subtitle={intro} back={{ fallback: backRoute, label: backLabel }} grouped>
      <View style={styles.grid}>
        {configurations.map((configuration, index) => (
          <Pressable
            key={index}
            onPress={() =>
              router.push({ pathname: '/glass-calculator', params: { name: configuration.name, backLabel: title, fallbackRoute: ownRoute } })
            }
            accessibilityRole="button"
            accessibilityLabel={`${configuration.name}, configuration ${index + 1}`}
            style={({ pressed }) => [styles.tile, pressed && styles.tilePressed]}
          >
            <Image cachePolicy="memory" source={configuration.image} style={styles.tileImage} contentFit="cover" transition={120} />
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
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 14 },
  tile: { width: '48%', overflow: 'hidden', backgroundColor: colors.card, borderRadius: radius.md },
  tilePressed: { opacity: 0.75 },
  tileImage: { width: '100%', aspectRatio: 1, backgroundColor: colors.groupedBackground },
  tileCopy: { paddingHorizontal: 12, paddingTop: 10, paddingBottom: 12, gap: 2 },
  tileName: { ...type.subheadline, minHeight: 40, fontWeight: '600' },
  tileMeta: { ...type.caption1, color: colors.secondaryLabel },
});
