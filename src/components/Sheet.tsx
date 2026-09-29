import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useOverlayTransition } from '@/hooks/useOverlayTransition';
import { useReduceMotion } from '@/hooks/useReduceMotion';
import { colors, radius, type } from '@/theme';

const useNativeDriver = Platform.OS !== 'web';
const DISMISS_DISTANCE = 110;

type Action = { label: string; onPress: () => void; disabled?: boolean; loading?: boolean };

type Props = {
  visible: boolean;
  title: string;
  onClose: () => void;
  /** Confirming action on the trailing edge of the header (e.g. Done, Place). */
  action?: Action;
  /** While true the sheet can't be dismissed (e.g. a PDF is being generated). */
  busy?: boolean;
  children: ReactNode;
};

/**
 * iOS-style modal sheet: Cancel on the leading edge, the confirming action on the trailing edge,
 * and swipe-down-to-dismiss on the header. With Reduce Motion on, it fades instead of sliding.
 */
export function Sheet({ visible, title, onClose, action, busy = false, children }: Props) {
  const { mounted, progress } = useOverlayTransition(visible);
  const reduceMotion = useReduceMotion();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const [sheetHeight, setSheetHeight] = useState(windowHeight);
  const drag = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) drag.setValue(0);
  }, [visible, drag]);

  const dismiss = () => {
    if (!busy) onClose();
  };

  const pan = useMemo(() => {
    const settle = () => Animated.spring(drag, { toValue: 0, useNativeDriver, bounciness: 0, speed: 18 }).start();
    return PanResponder.create({
      onMoveShouldSetPanResponder: (_, gesture) => gesture.dy > 6 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
      onPanResponderMove: (_, gesture) => drag.setValue(Math.max(0, gesture.dy)),
      onPanResponderRelease: (_, gesture) => {
        if (!busy && (gesture.dy > DISMISS_DISTANCE || gesture.vy > 1.2)) onClose();
        else settle();
      },
      onPanResponderTerminate: settle,
    });
  }, [busy, onClose, drag]);

  const slide = progress.interpolate({ inputRange: [0, 1], outputRange: reduceMotion ? [0, 0] : [sheetHeight + 24, 0] });

  return (
    <Modal visible={mounted} transparent animationType="none" onRequestClose={dismiss} statusBarTranslucent navigationBarTranslucent>
      <KeyboardAvoidingView style={styles.frame} behavior="padding">
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: colors.backdrop, opacity: progress }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={dismiss} accessibilityRole="button" accessibilityLabel={`Close ${title}`} />
        </Animated.View>

        <Animated.View
          accessibilityViewIsModal
          onLayout={(event) => setSheetHeight(event.nativeEvent.layout.height)}
          style={[
            styles.sheet,
            {
              maxHeight: windowHeight - insets.top - 12,
              paddingBottom: insets.bottom + 12,
              opacity: reduceMotion ? progress : 1,
              transform: [{ translateY: Animated.add(slide, drag) }],
            },
          ]}
        >
          <View {...pan.panHandlers} style={styles.header}>
            <Pressable onPress={dismiss} disabled={busy} accessibilityRole="button" hitSlop={8} style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}>
              <Text style={[styles.cancel, busy && { color: colors.tertiaryLabel }]}>Cancel</Text>
            </Pressable>
            <Text style={styles.title} numberOfLines={1} accessibilityRole="header">
              {title}
            </Text>
            <View style={styles.trailing}>
              {action &&
                (action.loading ? (
                  <ActivityIndicator color={colors.tint} style={styles.headerButton} accessibilityLabel={`${action.label} in progress`} />
                ) : (
                  <Pressable
                    onPress={action.onPress}
                    disabled={action.disabled}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: action.disabled }}
                    hitSlop={8}
                    style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}
                  >
                    <Text style={[styles.action, action.disabled && { color: colors.tertiaryLabel }]}>{action.label}</Text>
                  </Pressable>
                ))}
            </View>
          </View>
          {children}
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  frame: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.groupedBackground,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    overflow: 'hidden',
  },
  header: { height: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8 },
  headerButton: { minWidth: 44, minHeight: 44, paddingHorizontal: 8, justifyContent: 'center' },
  pressed: { opacity: 0.5 },
  cancel: { ...type.body, color: colors.tint },
  action: { ...type.headline, color: colors.tint },
  title: { ...type.headline, position: 'absolute', left: 96, right: 96, textAlign: 'center' },
  trailing: { minWidth: 72, alignItems: 'flex-end' },
});
