import Ionicons from '@expo/vector-icons/Ionicons';
import { router, usePathname, type Href } from 'expo-router';
import { useEffect, useMemo, useRef } from 'react';
import { Animated, Modal, PanResponder, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BrandLockup } from '@/components/BrandLockup';
import { primaryNav } from '@/data/navigation';
import { useOverlayTransition } from '@/hooks/useOverlayTransition';
import { useReduceMotion } from '@/hooks/useReduceMotion';
import { useCart } from '@/providers/CartProvider';
import { colors, radius, type } from '@/theme';

const useNativeDriver = Platform.OS !== 'web';

type Props = { visible: boolean; onClose: () => void; onOpenCart: () => void };

/** Side menu opened from the top-left menu button. Swipe left or tap outside to close. */
export function MenuDrawer({ visible, onClose, onOpenCart }: Props) {
  const { mounted, progress } = useOverlayTransition(visible);
  const reduceMotion = useReduceMotion();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const { count } = useCart();
  const drawerWidth = Math.min(width * 0.82, 320);
  const drag = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) drag.setValue(0);
  }, [visible, drag]);

  const pan = useMemo(() => {
    const settle = () => Animated.spring(drag, { toValue: 0, useNativeDriver, bounciness: 0, speed: 18 }).start();
    return PanResponder.create({
      onMoveShouldSetPanResponder: (_, gesture) => gesture.dx < -8 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
      onPanResponderMove: (_, gesture) => drag.setValue(Math.min(0, gesture.dx)),
      onPanResponderRelease: (_, gesture) => {
        if (gesture.dx < -drawerWidth / 3 || gesture.vx < -0.8) onClose();
        else settle();
      },
      onPanResponderTerminate: settle,
    });
  }, [drag, drawerWidth, onClose]);

  const go = (href: Href) => {
    onClose();
    // From a screen pushed over the tabs, unwind the stack instead of stacking another copy.
    if (!primaryNav.some((item) => item.href === pathname)) router.dismissTo(href);
    else router.navigate(href);
  };

  const aboutActive = pathname === '/about';
  const openAbout = () => {
    onClose();
    if (!aboutActive) router.push('/about');
  };

  const slide = progress.interpolate({ inputRange: [0, 1], outputRange: reduceMotion ? [0, 0] : [-drawerWidth - 12, 0] });

  return (
    <Modal visible={mounted} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: colors.backdrop, opacity: progress }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close menu" />
      </Animated.View>

      <Animated.View
        {...pan.panHandlers}
        accessibilityViewIsModal
        style={[
          styles.drawer,
          {
            width: drawerWidth,
            paddingTop: insets.top + 6,
            paddingBottom: insets.bottom + 20,
            opacity: reduceMotion ? progress : 1,
            transform: [{ translateX: Animated.add(slide, drag) }],
          },
        ]}
      >
        <View style={styles.header}>
          <BrandLockup />
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close menu"
            style={({ pressed }) => [styles.close, pressed && styles.pressed]}
          >
            <Ionicons name="close" size={20} color={colors.secondaryLabel} />
          </Pressable>
        </View>

        <View style={styles.links}>
          {primaryNav.map((item) => {
            const active = pathname === item.href;
            return (
              <Pressable
                key={item.key}
                onPress={() => go(item.href)}
                accessibilityRole="button"
                accessibilityLabel={item.title}
                accessibilityState={{ selected: active }}
                style={({ pressed }) => [styles.link, active && styles.linkActive, pressed && !active && styles.linkPressed]}
              >
                <Ionicons name={item.icon} size={22} color={colors.tint} />
                <Text style={[styles.linkText, active && styles.linkTextActive]}>{item.title}</Text>
              </Pressable>
            );
          })}

          <View style={styles.separator} />

          <Pressable
            onPress={onOpenCart}
            accessibilityRole="button"
            accessibilityLabel={count ? `Cart, ${count} item${count === 1 ? '' : 's'}` : 'Cart, empty'}
            style={({ pressed }) => [styles.link, pressed && styles.linkPressed]}
          >
            <Ionicons name="cart" size={22} color={colors.tint} />
            <Text style={styles.linkText}>Cart</Text>
            {count > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText} maxFontSizeMultiplier={1.2}>
                  {count > 99 ? '99+' : count}
                </Text>
              </View>
            )}
          </Pressable>

          <Pressable
            onPress={openAbout}
            accessibilityRole="button"
            accessibilityLabel="About"
            accessibilityState={{ selected: aboutActive }}
            style={({ pressed }) => [styles.link, aboutActive && styles.linkActive, pressed && !aboutActive && styles.linkPressed]}
          >
            <Ionicons name="information-circle" size={22} color={colors.tint} />
            <Text style={[styles.linkText, aboutActive && styles.linkTextActive]}>About</Text>
          </Pressable>
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerTitle}>Vimalnath Sales Corporation</Text>
          <Text style={styles.footerMeta}>Architectural systems and hardware</Text>
        </View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  drawer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    paddingHorizontal: 12,
    backgroundColor: colors.background,
    borderTopRightRadius: radius.lg,
    borderBottomRightRadius: radius.lg,
    boxShadow: '0 0 24px rgba(0, 0, 0, 0.12)',
  },
  header: { minHeight: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 8, marginBottom: 12 },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.5 },
  links: { gap: 2 },
  link: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 12, borderRadius: radius.md - 2 },
  linkActive: { backgroundColor: colors.tintFill },
  linkPressed: { backgroundColor: colors.quaternaryFill },
  linkText: { ...type.body, flex: 1 },
  linkTextActive: { color: colors.tint, fontWeight: '600' },
  separator: { height: StyleSheet.hairlineWidth, marginVertical: 8, marginHorizontal: 12, backgroundColor: colors.separator },
  badge: { minWidth: 24, height: 22, paddingHorizontal: 7, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.tint, borderRadius: 11 },
  badgeText: { ...type.footnote, color: colors.white, fontWeight: '700' },
  footer: { marginTop: 'auto', paddingHorizontal: 12, paddingTop: 16, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator },
  footerTitle: { ...type.footnote, fontWeight: '600' },
  footerMeta: { ...type.footnote, marginTop: 2, color: colors.secondaryLabel },
});
