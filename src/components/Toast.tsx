import { usePathname } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Platform, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, fonts } from '@/theme';

const VISIBLE_MS = 2600;
const TAB_BAR_CLEARANCE = 78;

export function useToastController() {
  const [message, setMessage] = useState('');
  const [visible, setVisible] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const show = useCallback((next: string) => {
    setMessage(next);
    setVisible(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setVisible(false), VISIBLE_MS);
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);

  return { message, visible, show };
}

export function Toast({ controller }: { controller: ReturnType<typeof useToastController> }) {
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(progress, {
      toValue: controller.visible ? 1 : 0,
      duration: 240,
      useNativeDriver: Platform.OS !== 'web',
    }).start();
  }, [controller.visible, progress]);

  // Screens pushed over the tabs (e.g. Telescopic) have no tab bar to clear.
  const hasTabBar = pathname !== '/telescopic';

  return (
    <Animated.View
      accessibilityLiveRegion="polite"
      style={[
        styles.toast,
        {
          bottom: insets.bottom + (hasTabBar ? TAB_BAR_CLEARANCE : 0) + 16,
          opacity: progress,
          transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }],
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
    maxWidth: '88%',
    paddingHorizontal: 18,
    paddingVertical: 13,
    backgroundColor: colors.navy,
    borderRadius: 14,
    boxShadow: '0 10px 28px rgba(0, 0, 0, 0.18)',
    pointerEvents: 'none',
  },
  text: {
    color: colors.white,
    fontFamily: fonts.medium,
    fontSize: 14,
    lineHeight: 19,
    textAlign: 'center',
  },
});
