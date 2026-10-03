import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { FoldingIllustration } from '@/components/FoldingIllustration';
import { Screen } from '@/components/Screen';
import { cutlistSystems, type CutlistSystem } from '@/data/cutlist';
import { colors, radius, type } from '@/theme';

export default function CutlistScreen() {
  const open = (system: CutlistSystem) => {
    if (system.id === 'telescopic') router.push('/telescopic');
    else if (system.id === 'synchronized') router.push('/synchronized');
    else router.push('/folding');
  };

  return (
    <Screen title="Cutlist" subtitle="Glass cutting sizes and material lists" grouped>
      <View style={styles.list}>
        {cutlistSystems.map((system) => (
          <Pressable
            key={system.id}
            onPress={() => open(system)}
            accessibilityRole="button"
            accessibilityLabel={`${system.name}. ${system.subtitle}`}
            style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
          >
            <View style={styles.media}>
              {system.photo ? (
                <Image cachePolicy="memory" source={system.photo} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} />
              ) : (
                <FoldingIllustration />
              )}
            </View>
            <View style={styles.copy}>
              <View style={{ flex: 1 }}>
                <Text style={type.headline}>{system.name}</Text>
                <Text style={styles.subtitle}>{system.subtitle}</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.tertiaryLabel} />
            </View>
          </Pressable>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { gap: 16 },
  card: { overflow: 'hidden', backgroundColor: colors.card, borderRadius: radius.lg },
  cardPressed: { opacity: 0.8 },
  media: { aspectRatio: 16 / 9, overflow: 'hidden', backgroundColor: colors.groupedBackground },
  copy: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
  subtitle: { ...type.subheadline, marginTop: 2, color: colors.secondaryLabel },
});
