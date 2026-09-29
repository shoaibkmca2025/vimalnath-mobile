import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View, type ImageSourcePropType } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, type } from '@/theme';

// Catalogue pages are A4 portrait.
const PAGE_RATIO = 842 / 595;

type Props = { visible: boolean; source?: ImageSourcePropType; title: string; onClose: () => void };

/**
 * Full-screen catalogue page. Android's ScrollView can't pinch-zoom, so the page can be toggled to
 * double width and panned in both directions to read the small price tables.
 */
export function CatalogPageViewer({ visible, source, title, onClose }: Props) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [zoomed, setZoomed] = useState(false);
  const pageWidth = zoomed ? width * 2.2 : width;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <StatusBar style="light" />
        <View style={styles.bar}>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close catalogue page" style={({ pressed }) => [styles.barButton, pressed && styles.pressed]}>
            <Text style={styles.done}>Done</Text>
          </Pressable>
          <Text style={styles.title} numberOfLines={1} accessibilityRole="header">
            {title}
          </Text>
          <Pressable
            onPress={() => setZoomed((value) => !value)}
            accessibilityRole="button"
            accessibilityLabel={zoomed ? 'Zoom out' : 'Zoom in'}
            style={({ pressed }) => [styles.barButton, styles.iconButton, pressed && styles.pressed]}
          >
            <Ionicons name={zoomed ? 'contract-outline' : 'expand-outline'} size={22} color={colors.white} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 16 }} maximumZoomScale={4} minimumZoomScale={1}>
          <ScrollView horizontal scrollEnabled={zoomed} showsHorizontalScrollIndicator={zoomed}>
            <Pressable onPress={() => setZoomed((value) => !value)} accessibilityLabel="Catalogue page" accessibilityHint={zoomed ? 'Tap to zoom out' : 'Tap to zoom in'}>
              {source && <Image source={source} style={{ width: pageWidth, height: pageWidth * PAGE_RATIO }} contentFit="contain" />}
            </Pressable>
          </ScrollView>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000' },
  bar: { height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8 },
  barButton: { minWidth: 44, minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 },
  iconButton: { alignItems: 'center' },
  pressed: { opacity: 0.5 },
  done: { ...type.headline, color: colors.white },
  title: { ...type.headline, position: 'absolute', left: 80, right: 80, color: colors.white, textAlign: 'center', pointerEvents: 'none' },
});
