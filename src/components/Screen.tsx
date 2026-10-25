import Ionicons from '@expo/vector-icons/Ionicons';
import { router, type Href } from 'expo-router';
import { useRef, type ReactNode, type Ref } from 'react';
import { Animated, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BrandLockup } from '@/components/BrandLockup';
import { CartButton } from '@/components/CartButton';
import { MenuButton } from '@/components/MenuDrawer';
import { colors, space, type } from '@/theme';

const useNativeDriver = Platform.OS !== 'web';
/** Longer back titles become "Back", as on iOS, so they never run into the screen title. */
const MAX_BACK_LABEL = 12;

type ScreenProps = {
  title: string;
  subtitle?: string;
  /** Pushed screens get a back button in place of the brand. `fallback` is used when there is no history. */
  back?: { fallback: Href; label?: string };
  /** `inline` keeps the title in the navigation bar instead of showing a large title above the content. */
  titleDisplay?: 'large' | 'inline';
  /** Trailing navigation bar items. Defaults to the cart button; pass `null` for none. */
  trailing?: ReactNode;
  /** Lists and forms sit on the grouped background so their white groups stand out. */
  grouped?: boolean;
  scrollRef?: Ref<ScrollView>;
  children: ReactNode;
};

/**
 * Screen with an iOS-style navigation bar: menu + brand + cart on tab roots, back button on pushed screens,
 * a large title that scrolls with the content, and a bar separator that appears once content scrolls under it.
 */
export function Screen({ title, subtitle, back, titleDisplay = 'large', trailing, grouped = false, scrollRef, children }: ScreenProps) {
  const insets = useSafeAreaInsets();
  const scrollY = useRef(new Animated.Value(0)).current;
  const background = grouped ? colors.groupedBackground : colors.background;
  const large = titleDisplay === 'large';

  const edgeOpacity = scrollY.interpolate({ inputRange: [0, 10], outputRange: [0, 1], extrapolate: 'clamp' });
  // On pushed screens the inline title takes over once the large title has scrolled under the bar.
  const inlineOpacity = large ? scrollY.interpolate({ inputRange: [30, 46], outputRange: [0, 1], extrapolate: 'clamp' }) : 1;

  const goBack = () => {
    if (!back) return;
    if (router.canGoBack()) router.back();
    else router.replace(back.fallback);
  };

  return (
    <View style={[styles.root, { backgroundColor: background }]}>
      <View style={{ paddingTop: insets.top, backgroundColor: background }}>
        <View style={styles.bar}>
          {back ? (
            <Pressable
              onPress={goBack}
              accessibilityRole="button"
              accessibilityLabel="Back"
              hitSlop={4}
              style={({ pressed }) => [styles.back, pressed && styles.pressed]}
            >
              <Ionicons name="chevron-back" size={27} color={colors.tint} style={styles.backIcon} />
              <Text style={styles.backLabel} numberOfLines={1} maxFontSizeMultiplier={1.3}>
                {back.label && back.label.length <= MAX_BACK_LABEL ? back.label : 'Back'}
              </Text>
            </Pressable>
          ) : (
            <View style={styles.leading}>
              <MenuButton />
              <BrandLockup />
            </View>
          )}
          <View style={styles.trailing}>{trailing === undefined ? <CartButton /> : trailing}</View>
          {back && (
            <Animated.Text
              style={[styles.inlineTitle, { opacity: inlineOpacity }]}
              numberOfLines={1}
              maxFontSizeMultiplier={1.3}
              accessibilityRole={large ? undefined : 'header'}
              accessibilityElementsHidden={large}
              importantForAccessibility={large ? 'no-hide-descendants' : 'auto'}
            >
              {title}
            </Animated.Text>
          )}
        </View>
        <Animated.View style={[styles.separator, { opacity: edgeOpacity }]} />
      </View>

      {/* Android is edge-to-edge, so the window no longer resizes for the keyboard; iOS uses scroll insets instead. */}
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'android' ? 'padding' : undefined}>
        <Animated.ScrollView
          ref={scrollRef}
          onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver })}
          scrollEventThrottle={16}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          automaticallyAdjustKeyboardInsets
        >
          {large && (
            <View style={styles.titleBlock}>
              <Text style={type.largeTitle} accessibilityRole="header">
                {title}
              </Text>
              {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
            </View>
          )}
          {children}
        </Animated.ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

/** Text button for the navigation bar, e.g. “Clear”. */
export function BarButton({ label, onPress, accessibilityLabel }: { label: string; onPress: () => void; accessibilityLabel?: string }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      style={({ pressed }) => [styles.barButton, pressed && styles.pressed]}
    >
      <Text style={styles.barButtonText} maxFontSizeMultiplier={1.3}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  bar: { height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: space.gutter, paddingRight: 8 },
  // A fixed share of the bar (not the label's measured width), so Bold text can't squeeze "Back" to "Ba…".
  back: { width: '40%', minHeight: 44, flexDirection: 'row', alignItems: 'center', marginLeft: -10, paddingRight: 8 },
  leading: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  backIcon: { marginRight: -2 },
  backLabel: { ...type.body, flex: 1, color: colors.tint },
  pressed: { opacity: 0.5 },
  trailing: { minWidth: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end' },
  inlineTitle: { ...type.headline, position: 'absolute', left: 110, right: 110, textAlign: 'center', pointerEvents: 'none' },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: colors.separator },
  content: { paddingHorizontal: space.gutter, paddingBottom: 40 },
  titleBlock: { marginTop: 2, marginBottom: 18 },
  subtitle: { ...type.subheadline, marginTop: 2, color: colors.secondaryLabel },
  barButton: { minWidth: 44, minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 },
  barButtonText: { ...type.body, color: colors.tint },
});
