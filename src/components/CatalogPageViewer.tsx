import Feather from '@expo/vector-icons/Feather';
import { Image } from 'expo-image';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View, type ImageSourcePropType } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, fonts } from '@/theme';

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
        <View style={styles.bar}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          <Pressable
            onPress={() => setZoomed((value) => !value)}
            accessibilityRole="button"
            accessibilityLabel={zoomed ? 'Zoom out' : 'Zoom in'}
            style={styles.barButton}
          >
            <Feather name={zoomed ? 'zoom-out' : 'zoom-in'} size={20} color={colors.white} />
          </Pressable>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close catalogue page" style={styles.barButton}>
            <Feather name="x" size={22} color={colors.white} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 16 }} maximumZoomScale={4} minimumZoomScale={1}>
          <ScrollView horizontal scrollEnabled={zoomed} showsHorizontalScrollIndicator={zoomed}>
            <Pressable onPress={() => setZoomed((value) => !value)} accessibilityLabel="Catalogue page. Tap to zoom">
              {source && <Image source={source} style={{ width: pageWidth, height: pageWidth * PAGE_RATIO }} contentFit="contain" />}
            </Pressable>
          </ScrollView>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.navy },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8 },
  title: { flex: 1, color: colors.white, fontFamily: fonts.bold, fontSize: 15 },
  barButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 21 },
});
