import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useIsFocused } from 'expo-router';
import { memo, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';

import { useReduceMotion } from '@/hooks/useReduceMotion';
import { useAppContent, type Banner } from '@/lib/content-sync';
import { colors, radius, type } from '@/theme';

const AUTO_ADVANCE_MS = 5000;

/** Memoized: it has no props, so typing or picking a category on the shop never re-renders it. The slides are the shop's home banners. */
export const HeroCard = memo(function HeroCard() {
  const { banners } = useAppContent();
  const [cardWidth, setCardWidth] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  // Auto-advance stops for good once someone swipes, and never runs with Reduce Motion on.
  const [userControlled, setUserControlled] = useState(false);
  const reduceMotion = useReduceMotion();
  // No auto-advance while another tab or screen is showing.
  const focused = useIsFocused();
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (!cardWidth || reduceMotion || userControlled || !focused) return;
    const timer = setInterval(() => {
      setActiveIndex((current) => {
        const next = (current + 1) % banners.length;
        scrollRef.current?.scrollTo({ x: next * cardWidth, animated: true });
        return next;
      });
    }, AUTO_ADVANCE_MS);
    return () => clearInterval(timer);
  }, [cardWidth, reduceMotion, userControlled, focused, banners.length]);

  const onMomentumScrollEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!cardWidth) return;
    setActiveIndex(Math.round(event.nativeEvent.contentOffset.x / cardWidth));
  };

  // Staff can switch every banner off.
  if (!banners.length) return null;

  return (
    <View style={styles.card} onLayout={(event) => setCardWidth(event.nativeEvent.layout.width)}>
      {cardWidth > 0 && (
        <ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          decelerationRate="fast"
          showsHorizontalScrollIndicator={false}
          onScrollBeginDrag={() => setUserControlled(true)}
          onMomentumScrollEnd={onMomentumScrollEnd}
          scrollEventThrottle={16}
        >
          {banners.map((banner, index) => (
            <View key={banner.id} style={{ width: cardWidth }}>
              <Slide banner={banner} position={index + 1} count={banners.length} />
            </View>
          ))}
        </ScrollView>
      )}

      {/* Page indicator, as in iOS: swiping changes the page; the dots only show where you are. */}
      <View style={styles.dots} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {banners.map((banner, index) => (
          <View key={banner.id} style={[styles.dot, index === activeIndex && styles.dotActive]} />
        ))}
      </View>
    </View>
  );
});

function Slide({ banner, position, count }: { banner: Banner; position: number; count: number }) {
  return (
    <View
      style={styles.slide}
      accessible
      accessibilityLabel={`${[banner.kicker, banner.headline, banner.body].filter(Boolean).join('. ')}. Slide ${position} of ${count}.`}
    >
      <Image cachePolicy="memory-disk" source={banner.image} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} />
      <LinearGradient
        colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.2)', 'rgba(0,0,0,0.62)']}
        locations={[0, 0.45, 1]}
        style={StyleSheet.absoluteFill}
      />

      <View style={styles.copy}>
        {banner.kicker ? <Text style={styles.kicker}>{banner.kicker.toUpperCase()}</Text> : null}
        <Text style={styles.headline}>{banner.headline}</Text>
        {banner.body ? <Text style={styles.body}>{banner.body}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { minHeight: 240, overflow: 'hidden', borderRadius: radius.lg, backgroundColor: colors.groupedBackground },
  slide: { minHeight: 240, paddingHorizontal: 20, paddingTop: 24, paddingBottom: 38, justifyContent: 'flex-end' },
  copy: { maxWidth: 300 },
  kicker: { ...type.caption1, color: 'rgba(255,255,255,0.85)', fontWeight: '600' },
  headline: { ...type.title1, marginTop: 6, color: colors.white },
  body: { ...type.subheadline, marginTop: 4, color: 'rgba(255,255,255,0.88)' },
  dots: { position: 'absolute', left: 0, right: 0, bottom: 14, flexDirection: 'row', justifyContent: 'center', gap: 8 },
  dot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: 'rgba(255,255,255,0.45)' },
  dotActive: { backgroundColor: colors.white },
});
