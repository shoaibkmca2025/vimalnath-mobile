import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Platform } from 'react-native';

const useNativeDriver = Platform.OS !== 'web';

/**
 * Keeps an overlay mounted while it animates out, so a Modal can play its exit
 * transition before being removed. `progress` runs 0 → 1 as the overlay opens.
 */
export function useOverlayTransition(visible: boolean) {
  const progress = useRef(new Animated.Value(0)).current;
  const [mounted, setMounted] = useState(visible);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      Animated.timing(progress, { toValue: 1, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver }).start();
    } else {
      Animated.timing(progress, { toValue: 0, duration: 210, easing: Easing.in(Easing.cubic), useNativeDriver }).start(
        ({ finished }) => finished && setMounted(false),
      );
    }
  }, [visible, progress]);

  return { mounted, progress };
}
