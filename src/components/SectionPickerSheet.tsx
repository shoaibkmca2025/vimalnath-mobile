import Feather from '@expo/vector-icons/Feather';
import { LinearGradient } from 'expo-linear-gradient';
import { Animated, Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { sections, sectionTones, type Section } from '@/data/sections';
import { useOverlayTransition } from '@/hooks/useOverlayTransition';
import { formatMm } from '@/lib/format';
import { colors, fonts, type } from '@/theme';

type Props = {
  visible: boolean;
  selectedCode: string;
  onSelect: (section: Section) => void;
  onClose: () => void;
};

export function SectionPickerSheet({ visible, selectedCode, onSelect, onClose }: Props) {
  const { mounted, progress } = useOverlayTransition(visible);
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={mounted} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: colors.backdrop, opacity: progress }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close section library" />
      </Animated.View>

      <Animated.View
        accessibilityViewIsModal
        style={[
          styles.sheet,
          {
            maxHeight: height * 0.82,
            paddingBottom: insets.bottom + 12,
            transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [height, 0] }) }],
          },
        ]}
      >
        <View style={styles.handle} />
        <View style={styles.header}>
          <View style={{ flexShrink: 1 }}>
            <Text style={type.eyebrow}>SECTION LIBRARY</Text>
            <Text style={styles.title}>Choose a profile</Text>
          </View>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" style={styles.close}>
            <Feather name="x" size={20} color={colors.ink} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
          {sections.map((section, index) => {
            const selected = section.code === selectedCode;
            return (
              <Pressable
                key={section.code}
                onPress={() => onSelect(section)}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                style={({ pressed }) => [styles.row, selected && styles.rowSelected, pressed && !selected && styles.rowPressed]}
              >
                <LinearGradient colors={sectionTones[index % sectionTones.length]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.thumb}>
                  <View style={styles.thumbFrame} />
                  <Text style={styles.thumbCode}>{section.code}</Text>
                </LinearGradient>
                <View style={styles.rowCopy}>
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {section.name}
                  </Text>
                  <Text style={styles.rowDescription} numberOfLines={2}>
                    {section.description}
                  </Text>
                  <Text style={styles.rowMeta} numberOfLines={1}>
                    {section.system} · {section.dimensions} · {formatMm(section.bar)} bar
                  </Text>
                </View>
                <Feather name={selected ? 'check-circle' : 'circle'} size={20} color={selected ? colors.blue : '#c9cfd8'} />
              </Pressable>
            );
          })}
        </ScrollView>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.white,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
  },
  handle: { alignSelf: 'center', width: 40, height: 5, marginTop: 10, borderRadius: 3, backgroundColor: '#d6dbe2' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 14, paddingBottom: 12 },
  title: { color: colors.ink, fontFamily: fonts.display, fontSize: 22, letterSpacing: -0.5 },
  close: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.soft, borderRadius: 19 },
  list: { paddingHorizontal: 14, paddingBottom: 8, gap: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderWidth: 1, borderColor: 'transparent', borderRadius: 16 },
  rowSelected: { backgroundColor: colors.blueWash, borderColor: '#d6e1ff' },
  rowPressed: { backgroundColor: colors.soft },
  thumb: { width: 58, height: 58, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderRadius: 13 },
  thumbFrame: {
    position: 'absolute',
    width: 34,
    height: 34,
    borderWidth: 1,
    borderColor: 'rgba(16,24,39,0.45)',
    transform: [{ rotate: '20deg' }, { skewX: '-12deg' }],
  },
  thumbCode: {
    paddingHorizontal: 5,
    paddingVertical: 2,
    overflow: 'hidden',
    color: 'rgba(16,24,39,0.75)',
    backgroundColor: 'rgba(255,255,255,0.6)',
    borderRadius: 4,
    fontFamily: fonts.display,
    fontSize: 10,
  },
  rowCopy: { flex: 1, gap: 2 },
  rowTitle: { color: colors.ink, fontFamily: fonts.bold, fontSize: 15 },
  rowDescription: { color: colors.muted, fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
  rowMeta: { marginTop: 2, color: colors.blue, fontFamily: fonts.semibold, fontSize: 11 },
});
