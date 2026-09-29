import Feather from '@expo/vector-icons/Feather';
import { Image } from 'expo-image';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { HeroCard } from '@/components/HeroCard';
import { ProductCard } from '@/components/ProductCard';
import { Screen } from '@/components/Screen';
import { shopCategories, shopProducts, type ShopCategoryId } from '@/data/shop';
import { colors, fonts, type } from '@/theme';

const PAGE_SIZE = 20;

export default function HomeScreen() {
  const [category, setCategory] = useState<ShopCategoryId>(shopCategories[0].id);
  const [section, setSection] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [visible, setVisible] = useState(PAGE_SIZE);

  const counts = useMemo(() => {
    const map = new Map<ShopCategoryId, number>();
    for (const product of shopProducts) map.set(product.category, (map.get(product.category) ?? 0) + 1);
    return map;
  }, []);

  const sections = useMemo(() => {
    const list: string[] = [];
    for (const product of shopProducts) if (product.category === category && !list.includes(product.section)) list.push(product.section);
    return list;
  }, [category]);

  const trimmed = query.trim().toLowerCase();
  const results = useMemo(() => {
    if (trimmed) {
      return shopProducts.filter((product) =>
        [product.code, product.name, product.section].some((field) => field.toLowerCase().includes(trimmed)),
      );
    }
    return shopProducts.filter((product) => product.category === category && (!section || product.section === section));
  }, [trimmed, category, section]);

  const selectCategory = (id: ShopCategoryId) => {
    setCategory(id);
    setSection(null);
    setVisible(PAGE_SIZE);
  };

  const activeCategory = shopCategories.find((item) => item.id === category)!;

  return (
    <Screen>
      <View style={styles.welcome}>
        <View style={{ flexShrink: 1 }}>
          <Text style={type.eyebrow}>ARCHITECTURAL SYSTEMS</Text>
          <Text style={type.title} accessibilityRole="header">
            Build better.{'\n'}
            <Text style={{ color: colors.blue }}>Cut smarter.</Text>
          </Text>
        </View>
        <View style={styles.avatar} accessibilityLabel="Signed in as guest">
          <Text style={styles.avatarText}>VN</Text>
        </View>
      </View>

      <HeroCard />

      <View style={styles.search}>
        <Feather name="search" size={18} color={colors.muted} />
        <TextInput
          value={query}
          onChangeText={(text) => {
            setQuery(text);
            setVisible(PAGE_SIZE);
          }}
          placeholder="Search code or product, e.g. TGH-55"
          placeholderTextColor={colors.subtle}
          autoCapitalize="characters"
          returnKeyType="search"
          accessibilityLabel="Search products"
          style={styles.searchInput}
        />
        {query.length > 0 && (
          <Pressable onPress={() => setQuery('')} accessibilityRole="button" accessibilityLabel="Clear search" hitSlop={8}>
            <Feather name="x-circle" size={18} color={colors.subtle} />
          </Pressable>
        )}
      </View>

      {!trimmed && (
        <>
          <Text style={[type.label, styles.sectionLabel]}>SHOP BY CATEGORY</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.bleed} contentContainerStyle={styles.categoryRow}>
            {shopCategories.map((item) => {
              const selected = item.id === category;
              return (
                <Pressable
                  key={item.id}
                  onPress={() => selectCategory(item.id)}
                  accessibilityRole="tab"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`${item.label}, ${counts.get(item.id) ?? 0} products`}
                  style={[styles.categoryTile, selected && styles.categoryTileActive]}
                >
                  <Image source={item.image} style={styles.categoryImage} contentFit="cover" />
                  <Text style={[styles.categoryName, selected && { color: colors.white }]} numberOfLines={2}>
                    {item.label}
                  </Text>
                  <Text style={[styles.categoryCount, selected && { color: '#c9d8ff' }]}>{counts.get(item.id) ?? 0} products</Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {sections.length > 1 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.bleed} contentContainerStyle={styles.chipRow}>
              {[null, ...sections].map((item) => {
                const selected = item === section;
                return (
                  <Pressable
                    key={item ?? 'all'}
                    onPress={() => {
                      setSection(item);
                      setVisible(PAGE_SIZE);
                    }}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    style={[styles.chip, selected && styles.chipActive]}
                  >
                    <Text style={[styles.chipText, selected && { color: colors.white }]}>{item ?? 'All'}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          )}
        </>
      )}

      <View style={styles.resultsHeader}>
        <Text style={styles.resultsTitle}>{trimmed ? 'Search results' : (section ?? activeCategory.label)}</Text>
        <Text style={styles.resultsCount}>{results.length} products</Text>
      </View>

      {results.length === 0 ? (
        <View style={styles.empty}>
          <Feather name="search" size={22} color={colors.blue} />
          <Text style={styles.emptyText}>No products match “{query.trim()}”.</Text>
        </View>
      ) : (
        <View style={styles.grid}>
          {results.slice(0, visible).map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </View>
      )}

      {results.length > visible && (
        <Pressable
          onPress={() => setVisible((count) => count + PAGE_SIZE)}
          accessibilityRole="button"
          style={({ pressed }) => [styles.more, pressed && { backgroundColor: colors.blueTint }]}
        >
          <Text style={styles.moreText}>Show more ({results.length - visible} left)</Text>
        </Pressable>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  welcome: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14, marginBottom: 24 },
  avatar: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#eaf0ff',
    borderWidth: 1,
    borderColor: '#dbe5ff',
    borderRadius: 22,
  },
  avatarText: { color: colors.blue, fontFamily: fonts.bold, fontSize: 13 },
  search: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 22,
    paddingHorizontal: 14,
    backgroundColor: colors.soft,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 14,
  },
  searchInput: { flex: 1, height: '100%', padding: 0, color: colors.ink, fontFamily: fonts.semibold, fontSize: 14 },
  sectionLabel: { marginTop: 24, marginBottom: 12 },
  // Let horizontal rows run to the screen edges past the page gutter.
  bleed: { marginHorizontal: -20 },
  categoryRow: { gap: 10, paddingHorizontal: 20 },
  categoryTile: { width: 124, padding: 6, paddingBottom: 10, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, borderRadius: 16 },
  categoryTileActive: { backgroundColor: colors.blue, borderColor: colors.blue },
  categoryImage: { width: '100%', height: 78, borderRadius: 11, backgroundColor: colors.blueTint },
  categoryName: { marginTop: 8, marginHorizontal: 4, minHeight: 34, color: colors.ink, fontFamily: fonts.bold, fontSize: 13, lineHeight: 17 },
  categoryCount: { marginHorizontal: 4, marginTop: 2, color: colors.muted, fontFamily: fonts.regular, fontSize: 11 },
  chipRow: { gap: 8, paddingHorizontal: 20, paddingTop: 14 },
  chip: { paddingHorizontal: 13, height: 34, justifyContent: 'center', backgroundColor: colors.blueTint, borderRadius: 17 },
  chipActive: { backgroundColor: colors.blue },
  chipText: { color: colors.blue, fontFamily: fonts.bold, fontSize: 12 },
  resultsHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, marginTop: 22, marginBottom: 12 },
  resultsTitle: { flexShrink: 1, color: colors.ink, fontFamily: fonts.display, fontSize: 19 },
  resultsCount: { color: colors.muted, fontFamily: fonts.medium, fontSize: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 12 },
  empty: { alignItems: 'center', gap: 8, padding: 26, backgroundColor: colors.blueWash, borderRadius: 16 },
  emptyText: { color: colors.muted, fontFamily: fonts.medium, fontSize: 13 },
  more: { height: 50, alignItems: 'center', justifyContent: 'center', marginTop: 16, borderWidth: 1, borderColor: '#c9d8ff', borderRadius: 14 },
  moreText: { color: colors.blue, fontFamily: fonts.bold, fontSize: 14 },
});
