import { usePathname } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Platform, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { primaryNav } from '@/data/navigation';
import { useReduceMotion } from '@/hooks/useReduceMotion';
import { colors, type } from '@/theme';

const TAB_BAR_CLEARANCE = 56;

// Longer messages stay up longer so there's time to read them.
const visibleMs = (message: string) => Math.min(6000, 2400 + message.length * 45);

export function useToastController() {
  const [message, setMessage] = useState('');
  const [visible, setVisible] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const show = useCallback((next: string) => {
    setMessage(next);
    setVisible(true);
    // Announce explicitly: VoiceOver doesn't read live regions, and the toast itself can't take focus.
    AccessibilityInfo.announceForAccessibility(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setVisible(false), visibleMs(next));
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);

  return { message, visible, show };
}

/** Brief status message floating above the tab bar (or the bottom edge on pushed screens). */
export function Toast({ controller }: { controller: ReturnType<typeof useToastController> }) {
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const reduceMotion = useReduceMotion();
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(progress, {
      toValue: controller.visible ? 1 : 0,
      duration: controller.visible ? 220 : 180,
      useNativeDriver: Platform.OS !== 'web',
    }).start();
  }, [controller.visible, progress]);

  // Only the tab roots have a tab bar to clear.
  const hasTabBar = primaryNav.some((item) => item.href === pathname);

  return (
    <Animated.View
      style={[
        styles.toast,
        {
          bottom: insets.bottom + (hasTabBar ? TAB_BAR_CLEARANCE : 0) + 16,
          opacity: progress,
          transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [reduceMotion ? 0 : 12, 0] }) }],
        },
      ]}
    >
      <Text style={styles.text}>{controller.message}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: 'absolute',
    alignSelf: 'center',
    maxWidth: '90%',
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: colors.hud,
    borderRadius: 22,
    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.18)',
    pointerEvents: 'none',
  },
  text: { ...type.subheadline, color: colors.white, fontWeight: '500', textAlign: 'center' },
});
