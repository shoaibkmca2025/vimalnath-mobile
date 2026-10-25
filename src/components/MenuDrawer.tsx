import Ionicons from '@expo/vector-icons/Ionicons';
import { router, type Href } from 'expo-router';
import { useState } from 'react';
import { Animated, Modal, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BrandLockup } from '@/components/BrandLockup';
import type { IconName } from '@/components/Button';
import { useOverlayTransition } from '@/hooks/useOverlayTransition';
import { useReduceMotion } from '@/hooks/useReduceMotion';
import { colors, type } from '@/theme';

const ITEMS: { label: string; icon: IconName; href: Href; color?: string }[] = [
  { label: 'User', icon: 'person-circle-outline', href: '/user' },
  { label: 'Installation Videos', icon: 'logo-youtube', href: '/videos', color: '#ff0000' },
  { label: 'Settings', icon: 'settings-outline', href: '/settings' },
  { label: 'More Apps', icon: 'apps-outline', href: '/more-apps' },
  { label: 'About', icon: 'information-circle-outline', href: '/about' },
];

const DEVELOPER = '4AM Global Media';

/** Navigation bar button on the tab screens that opens the side menu. */
export function MenuButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="Menu"
        style={({ pressed }) => [styles.menuButton, pressed && styles.pressed]}
      >
        <Ionicons name="menu" size={28} color={colors.tint} />
      </Pressable>
      <MenuDrawer visible={open} onClose={() => setOpen(false)} />
    </>
  );
}

/** Side menu sliding in from the leading edge, with the developer credit at the bottom. */
function MenuDrawer({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { mounted, progress } = useOverlayTransition(visible);
  const reduceMotion = useReduceMotion();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const panelWidth = Math.min(320, width * 0.82);
  const slide = progress.interpolate({ inputRange: [0, 1], outputRange: reduceMotion ? [0, 0] : [-panelWidth, 0] });

  const go = (href: Href) => {
    onClose();
    router.push(href);
  };

  return (
    <Modal visible={mounted} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: colors.backdrop, opacity: progress }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close menu" />
      </Animated.View>

      <Animated.View
        accessibilityViewIsModal
        style={[
          styles.panel,
          { width: panelWidth, paddingTop: insets.top + 12, paddingBottom: insets.bottom + 16, opacity: reduceMotion ? progress : 1, transform: [{ translateX: slide }] },
        ]}
      >
        <View style={styles.header}>
          <BrandLockup />
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close menu" hitSlop={8} style={({ pressed }) => [styles.close, pressed && styles.pressed]}>
            <Ionicons name="close" size={26} color={colors.secondaryLabel} />
          </Pressable>
        </View>

        <View style={styles.items}>
          {ITEMS.map((item) => (
            <Pressable
              key={item.label}
              onPress={() => go(item.href)}
              accessibilityRole="button"
              accessibilityLabel={item.label}
              style={({ pressed }) => [styles.item, pressed && styles.itemPressed]}
            >
              <Ionicons name={item.icon} size={24} color={item.color ?? colors.tint} />
              <Text style={styles.itemLabel}>{item.label}</Text>
              <Ionicons name="chevron-forward" size={18} color={colors.tertiaryLabel} />
            </Pressable>
          ))}
        </View>

        <Text style={styles.credit}>
          Developed by <Text style={styles.creditName}>{DEVELOPER}</Text>
        </Text>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  menuButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginLeft: -10 },
  pressed: { opacity: 0.5 },
  panel: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    paddingHorizontal: 12,
    backgroundColor: colors.background,
    ...(Platform.OS === 'web' ? {} : { boxShadow: '4px 0 24px rgba(0, 0, 0, 0.18)' }),
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 8, paddingBottom: 18 },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  items: { flex: 1, gap: 2 },
  item: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 10, borderRadius: 12 },
  itemPressed: { backgroundColor: colors.fill },
  itemLabel: { ...type.body, flex: 1, fontWeight: '500' },
  credit: { ...type.footnote, paddingHorizontal: 10, color: colors.secondaryLabel, textAlign: 'center' },
  creditName: { fontWeight: '700', color: colors.label },
});
