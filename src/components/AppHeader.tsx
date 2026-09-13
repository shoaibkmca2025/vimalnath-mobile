import Feather from '@expo/vector-icons/Feather';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BrandLockup } from '@/components/BrandLockup';
import { useAppUI } from '@/providers/AppUIProvider';
import { colors } from '@/theme';

export function AppHeader() {
  const insets = useSafeAreaInsets();
  const { openDrawer, showToast } = useAppUI();

  return (
    <View style={[styles.header, { paddingTop: insets.top }]}>
      <View style={styles.row}>
        <Pressable
          onPress={openDrawer}
          accessibilityRole="button"
          accessibilityLabel="Open menu"
          style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
        >
          {/* Three strokes with a short last line, matching the prototype's menu glyph. */}
          <View style={styles.menuGlyph}>
            <View style={styles.menuLine} />
            <View style={styles.menuLine} />
            <View style={[styles.menuLine, { width: 11 }]} />
          </View>
        </Pressable>

        <BrandLockup />

        <Pressable
          onPress={() => showToast('You’re all caught up.')}
          accessibilityRole="button"
          accessibilityLabel="Notifications"
          style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
        >
          <Feather name="bell" size={21} color={colors.ink} />
          <View style={styles.notificationDot} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    backgroundColor: colors.white,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#dfe3e8',
  },
  row: {
    height: 62,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
  },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22 },
  pressed: { backgroundColor: colors.soft },
  menuGlyph: { width: 18, gap: 4.5 },
  menuLine: { width: 18, height: 2, borderRadius: 1, backgroundColor: colors.ink },
  notificationDot: {
    position: 'absolute',
    top: 10,
    right: 11,
    width: 9,
    height: 9,
    backgroundColor: colors.orange,
    borderWidth: 2,
    borderColor: colors.white,
    borderRadius: 5,
  },
});
