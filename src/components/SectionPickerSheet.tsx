import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { InsetGroup } from '@/components/InsetGroup';
import { Sheet } from '@/components/Sheet';
import { sections, sectionTones, type Section } from '@/data/sections';
import { formatMm } from '@/lib/format';
import { colors, type } from '@/theme';

type Props = {
  visible: boolean;
  selectedCode: string;
  onSelect: (section: Section) => void;
  onClose: () => void;
};

export function SectionPickerSheet({ visible, selectedCode, onSelect, onClose }: Props) {
  return (
    <Sheet visible={visible} title="Choose Profile" onClose={onClose}>
      <ScrollView contentContainerStyle={styles.content}>
        <InsetGroup header="Section library" separatorInset={86}>
          {sections.map((section, index) => {
            const selected = section.code === selectedCode;
            return (
              <Pressable
                key={section.code}
                onPress={() => onSelect(section)}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={`${section.code}, ${section.name}. ${section.system}, ${section.dimensions}, ${formatMm(section.bar)} bar`}
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              >
                <LinearGradient colors={sectionTones[index % sectionTones.length]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.thumb}>
                  <View style={styles.thumbFrame} />
                  <Text style={styles.thumbCode} maxFontSizeMultiplier={1}>
                    {section.code}
                  </Text>
                </LinearGradient>
                <View style={styles.rowCopy}>
                  <Text style={type.headline} numberOfLines={1}>
                    {section.name}
                  </Text>
                  <Text style={styles.rowDescription} numberOfLines={2}>
                    {section.description}
                  </Text>
                  <Text style={styles.rowMeta} numberOfLines={1}>
                    {section.system} · {section.dimensions} · {formatMm(section.bar)} bar
                  </Text>
                </View>
                <View style={styles.check}>{selected && <Ionicons name="checkmark" size={22} color={colors.tint} />}</View>
              </Pressable>
            );
          })}
        </InsetGroup>
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 16, paddingTop: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingLeft: 16, paddingRight: 12 },
  rowPressed: { backgroundColor: colors.fill },
  thumb: { width: 58, height: 58, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderRadius: 10 },
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
    color: 'rgba(16,24,39,0.85)',
    backgroundColor: 'rgba(255,255,255,0.7)',
    borderRadius: 4,
    fontSize: 11,
    lineHeight: 13,
    fontWeight: '700',
  },
  rowCopy: { flex: 1, gap: 2 },
  rowDescription: { ...type.footnote, color: colors.secondaryLabel },
  rowMeta: { ...type.caption1, color: colors.secondaryLabel },
  check: { width: 24, alignItems: 'center' },
});
