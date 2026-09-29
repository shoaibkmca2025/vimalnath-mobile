import Feather from '@expo/vector-icons/Feather';
import { router, type Href } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, type } from '@/theme';

type Props = {
  eyebrow: string;
  title: string;
  /** Where back goes when there is no history (e.g. the app was opened on this screen). */
  fallback: Href;
  accessory?: ReactNode;
};

/** Blue back button + eyebrow + title, used by screens pushed over the tabs. */
export function PageHeader({ eyebrow, title, fallback, accessory }: Props) {
  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace(fallback);
  };

  return (
    <View style={styles.top}>
      <Pressable
        onPress={goBack}
        accessibilityRole="button"
        accessibilityLabel="Back"
        style={({ pressed }) => [styles.back, pressed && { backgroundColor: colors.blueDark }]}
      >
        <Feather name="arrow-left" size={21} color={colors.white} />
      </Pressable>
      <View style={{ flex: 1 }}>
        <Text style={type.eyebrow}>{eyebrow}</Text>
        <Text style={[type.title, { fontSize: 26, lineHeight: 30 }]} numberOfLines={2} accessibilityRole="header">
          {title}
        </Text>
      </View>
      {accessory}
    </View>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 18 },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.blue, borderRadius: 13 },
});
