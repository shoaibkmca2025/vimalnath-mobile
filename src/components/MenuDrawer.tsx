import Feather from '@expo/vector-icons/Feather';
import { router, usePathname, type Href } from 'expo-router';
import { Animated, Modal, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BrandLockup } from '@/components/BrandLockup';
import { NavIcon, primaryNav } from '@/components/NavIcon';
import { useOverlayTransition } from '@/hooks/useOverlayTransition';
import { colors, fonts } from '@/theme';

type Props = { visible: boolean; onClose: () => void; onEnquiry: () => void };

export function MenuDrawer({ visible, onClose, onEnquiry }: Props) {
  const { mounted, progress } = useOverlayTransition(visible);
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const drawerWidth = Math.min(width * 0.84, 340);

  const go = (href: Href) => {
    onClose();
    // From a screen pushed over the tabs, unwind the stack instead of stacking another copy.
    if (pathname === '/telescopic') router.dismissTo(href);
    else router.navigate(href);
  };

  return (
    <Modal visible={mounted} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: colors.backdrop, opacity: progress }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close menu" />
      </Animated.View>

      <Animated.View
        accessibilityViewIsModal
        style={[
          styles.drawer,
          {
            width: drawerWidth,
            paddingTop: insets.top + 18,
            paddingBottom: insets.bottom + 24,
            transform: [{ translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [-drawerWidth - 12, 0] }) }],
          },
        ]}
      >
        <View style={styles.top}>
          <BrandLockup inverted />
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close menu" style={styles.close} hitSlop={6}>
            <Feather name="x" size={24} color={colors.white} />
          </Pressable>
        </View>

        <View style={styles.profile}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>VN</Text>
          </View>
          <View>
            <Text style={styles.profileName}>Welcome, fabricator</Text>
            <Text style={styles.profileMeta}>Guest workspace</Text>
          </View>
        </View>

        <View style={styles.links}>
          {primaryNav.map((item) => {
            const active = pathname === item.href;
            return (
              <Pressable
                key={item.key}
                onPress={() => go(item.href)}
                accessibilityRole="button"
                accessibilityLabel={item.drawerLabel}
                accessibilityState={{ selected: active }}
                style={({ pressed }) => [styles.link, (active || pressed) && styles.linkActive]}
              >
                <NavIcon name={item.key} size={20} color={active ? colors.white : '#cdd6e8'} />
                <Text style={[styles.linkText, active && { color: colors.white }]}>{item.drawerLabel}</Text>
              </Pressable>
            );
          })}
          <Pressable
            onPress={onEnquiry}
            accessibilityRole="button"
            accessibilityLabel="My enquiry, 0 items"
            style={({ pressed }) => [styles.link, pressed && styles.linkActive]}
          >
            <View style={styles.iconBox}>
              <Feather name="mail" size={20} color="#cdd6e8" />
            </View>
            <Text style={styles.linkText}>My enquiry</Text>
            <View style={styles.badge}>
              <Text style={styles.badgeText}>0</Text>
            </View>
          </Pressable>
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerTitle}>Vimalnath Sales Corporation</Text>
          <Text style={styles.footerMeta}>Architectural systems & hardware</Text>
        </View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  drawer: { position: 'absolute', top: 0, bottom: 0, left: 0, paddingHorizontal: 20, backgroundColor: colors.navy },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22 },
  profile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 36,
    marginBottom: 22,
    paddingBottom: 22,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.12)',
  },
  avatar: {
    width: 46,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#3a64d9',
    borderWidth: 2,
    borderColor: '#5879d9',
    borderRadius: 23,
  },
  avatarText: { color: colors.white, fontFamily: fonts.bold, fontSize: 13 },
  profileName: { color: colors.white, fontFamily: fonts.bold, fontSize: 15 },
  profileMeta: { marginTop: 3, color: '#9ca9c5', fontFamily: fonts.regular, fontSize: 12 },
  links: { gap: 4 },
  link: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 50, paddingHorizontal: 12, borderRadius: 12 },
  linkActive: { backgroundColor: 'rgba(255,255,255,0.08)' },
  // Same footprint as NavIcon (size + 2) so every label starts on one line.
  iconBox: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center' },
  linkText: { flex: 1, color: '#cdd6e8', fontFamily: fonts.medium, fontSize: 15 },
  badge: { minWidth: 24, paddingHorizontal: 7, paddingVertical: 3, alignItems: 'center', backgroundColor: colors.orange, borderRadius: 10 },
  badgeText: { color: colors.white, fontFamily: fonts.bold, fontSize: 11 },
  footer: { marginTop: 'auto', paddingTop: 18, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.12)' },
  footerTitle: { color: colors.white, fontFamily: fonts.display, fontSize: 14 },
  footerMeta: { marginTop: 4, color: '#9ca9c5', fontFamily: fonts.regular, fontSize: 12 },
});
