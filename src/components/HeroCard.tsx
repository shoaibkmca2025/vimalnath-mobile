import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';

import { colors, fonts } from '@/theme';

const SLIDES = [
  { image: require('../../assets/images/hero/hero-slide-1.webp') },
  { image: require('../../assets/images/hero/hero-slide-2.webp') },
  { image: require('../../assets/images/hero/hero-slide-3.webp') },
  { image: require('../../assets/images/hero/hero-slide-4.webp') },
];

const AUTO_ADVANCE_MS = 4500;

export function HeroCard() {
  const [cardWidth, setCardWidth] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const scrollRef = useRef<ScrollView>(null);

  const goToSlide = (index: number) => {
    setActiveIndex(index);
    scrollRef.current?.scrollTo({ x: index * cardWidth, animated: true });
  };

  // Auto-advance to the next slide; always reads the latest index so a manual swipe isn't undone.
  useEffect(() => {
    if (!cardWidth) return;
    const timer = setInterval(() => {
      setActiveIndex((current) => {
        const next = (current + 1) % SLIDES.length;
        scrollRef.current?.scrollTo({ x: next * cardWidth, animated: true });
        return next;
      });
    }, AUTO_ADVANCE_MS);
    return () => clearInterval(timer);
  }, [cardWidth]);

  const onMomentumScrollEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!cardWidth) return;
    setActiveIndex(Math.round(event.nativeEvent.contentOffset.x / cardWidth));
  };

  return (
    <View style={styles.card} onLayout={(event) => setCardWidth(event.nativeEvent.layout.width)}>
      {cardWidth > 0 && (
        <ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          decelerationRate="fast"
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={onMomentumScrollEnd}
          scrollEventThrottle={16}
        >
          {SLIDES.map((slide, index) => (
            <View key={index} style={{ width: cardWidth }}>
              <Slide image={slide.image} />
            </View>
          ))}
        </ScrollView>
      )}

      <View style={styles.dots}>
        {SLIDES.map((_, index) => (
          <Pressable key={index} onPress={() => goToSlide(index)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Show slide ${index + 1}`}>
            <View style={[styles.dot, index === activeIndex && styles.dotActive]} />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function Slide({ image }: { image: number }) {
  return (
    <View
      style={styles.slide}
      accessible
      accessibilityLabel="New collection 2026. Systems that move with you. Sliding, folding and slim partition solutions."
    >
      <Image source={image} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} />
      <LinearGradient
        colors={['rgba(9,16,36,0.05)', 'rgba(8,14,32,0.25)', 'rgba(7,12,28,0.65)']}
        locations={[0, 0.5, 1]}
        style={StyleSheet.absoluteFill}
      />

      <View style={styles.copy}>
        <Text style={styles.kicker}>NEW COLLECTION · 2026</Text>
        <Text style={styles.headline}>
          Systems that{'\n'}
          <Text style={{ color: '#98b7ff' }}>move with you.</Text>
        </Text>
        <Text style={styles.body}>Sliding, folding and slim partition solutions.</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { minHeight: 244, overflow: 'hidden', borderRadius: 24 },
  slide: { minHeight: 244, paddingHorizontal: 22, paddingTop: 26, paddingBottom: 32, justifyContent: 'flex-end' },
  copy: { width: '80%' },
  kicker: { color: '#bcd1ff', fontFamily: fonts.bold, fontSize: 10, letterSpacing: 1.3 },
  headline: { marginTop: 14, marginBottom: 10, color: colors.white, fontFamily: fonts.display, fontSize: 26, lineHeight: 28, letterSpacing: -1 },
  body: { maxWidth: 220, color: '#d5e0ff', fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  dots: { position: 'absolute', left: 22, bottom: 20, flexDirection: 'row', gap: 5 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.4)' },
  dotActive: { width: 20, backgroundColor: colors.white },
});
