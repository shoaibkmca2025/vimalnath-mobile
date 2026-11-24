import Ionicons from '@expo/vector-icons/Ionicons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Image } from 'expo-image';
import { router, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { Animated, Modal, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BrandLockup } from '@/components/BrandLockup';
import type { IconName } from '@/components/Button';
import { useLogOut } from '@/hooks/useLogOut';
import { useOverlayTransition } from '@/hooks/useOverlayTransition';
import { formatPhone } from '@/lib/format';
import { useProfilePhoto } from '@/lib/profile-photo';
import { useReduceMotion } from '@/hooks/useReduceMotion';
import { colors, type } from '@/theme';

const ITEMS: { label: string; icon: IconName; href: Href; color?: string }[] = [
  { label: 'User', icon: 'person-circle-outline', href: '/user' },
  { label: 'Installation Videos', icon: 'logo-youtube', href: '/videos', color: '#ff0000' },
  { label: 'Settings', icon: 'settings-outline', href: '/settings' },
  { label: 'More Apps', icon: 'apps-outline', href: '/more-apps' },
  { label: 'Feedback', icon: 'chatbubble-ellipses-outline', href: '/feedback' },
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

type Profile = { name?: string; business?: string; phone?: string };
/** Saved by logging in or creating an account, and by the User screen. */
const PROFILE_KEY = 'vimalnath:profile';

/** Side menu sliding in from the leading edge: who is logged in at the top, the developer credit at the bottom. */
function MenuDrawer({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { mounted, progress } = useOverlayTransition(visible);
  const { confirmLogOut, loggingOut } = useLogOut();
  const photo = useProfilePhoto();
  const [profile, setProfile] = useState<Profile>({});
  // Read each time the menu opens, so a name changed on the User screen shows straight away.
  useEffect(() => {
    if (!visible) return;
    AsyncStorage.getItem(PROFILE_KEY)
      .then((raw) => setProfile(raw ? (JSON.parse(raw) as Profile) : {}))
      .catch(() => {});
  }, [visible]);
  const name = profile.name?.trim() ?? '';
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]!.toUpperCase()).join('');
  const detail = [profile.business?.trim(), profile.phone ? formatPhone(profile.phone) : ''].filter(Boolean).join(' · ');
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

        <Pressable
          onPress={() => go('/user')}
          accessibilityRole="button"
          accessibilityLabel={`${name || 'Your account'}${detail ? `, ${detail}` : ''}`}
          accessibilityHint="Opens your details"
          style={({ pressed }) => [styles.userCard, pressed && styles.itemPressed]}
        >
          <View style={styles.userPhoto}>
            {photo ? (
              <Image source={{ uri: photo }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="none" accessibilityIgnoresInvertColors />
            ) : (
              <Text style={styles.userInitials}>{initials || '?'}</Text>
            )}
          </View>
          <View style={styles.userText}>
            <Text style={type.headline} numberOfLines={1}>
              {name || 'Your account'}
            </Text>
            {detail ? (
              <Text style={styles.userDetail} numberOfLines={1}>
                {detail}
              </Text>
            ) : null}
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.tertiaryLabel} />
        </Pressable>

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

        <Pressable
          onPress={() => {
            onClose();
            confirmLogOut();
          }}
          disabled={loggingOut}
          accessibilityRole="button"
          accessibilityLabel="Log Out"
          accessibilityHint="Asks before logging this phone out of your account"
          style={({ pressed }) => [styles.item, styles.logOut, pressed && styles.itemPressed]}
        >
          <Ionicons name="log-out-outline" size={24} color={colors.red} />
          <Text style={[styles.itemLabel, { color: colors.red }]}>Log Out</Text>
        </Pressable>

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
  userCard: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12, padding: 12, borderRadius: 14, backgroundColor: colors.groupedBackground },
  userPhoto: { width: 52, height: 52, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', borderRadius: 26, backgroundColor: colors.tint },
  userInitials: { ...type.headline, color: colors.white },
  userText: { flex: 1 },
  userDetail: { ...type.footnote, marginTop: 2, color: colors.secondaryLabel },
  logOut: { marginBottom: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator, borderRadius: 0 },
  credit: { ...type.footnote, paddingHorizontal: 10, color: colors.secondaryLabel, textAlign: 'center' },
  creditName: { fontWeight: '700', color: colors.label },
});
