import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useCallback, useDeferredValue, useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { HeroCard } from '@/components/HeroCard';
import { ProductCard } from '@/components/ProductCard';
import { Screen } from '@/components/Screen';
import type { ShopCategoryId, ShopProduct } from '@/data/shop';
import { useAppContent } from '@/lib/content-sync';
import { colors, radius, space, type } from '@/theme';

const PAGE_SIZE = 20;

export default function ShopScreen() {
  const { categories: shopCategories, products: shopProducts } = useAppContent();
  const [picked, setCategory] = useState<ShopCategoryId>();
  // The first category until one is picked, and again if a download from the shop drops the picked one.
  const category = shopCategories.some((item) => item.id === picked) ? picked : shopCategories[0]?.id;
  const [section, setSection] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [visible, setVisible] = useState(PAGE_SIZE);

  const counts = useMemo(() => {
    const map = new Map<ShopCategoryId, number>();
    for (const product of shopProducts) map.set(product.category, (map.get(product.category) ?? 0) + 1);
    return map;
  }, [shopProducts]);

  const sections = useMemo(() => {
    const list: string[] = [];
    for (const product of shopProducts) if (product.category === category && !list.includes(product.section)) list.push(product.section);
    return list;
  }, [category, shopProducts]);

  // The tap or keystroke shows at once; the product grid catches up in a follow-up render that
  // React can interrupt, so a quick run of taps never queues up grid renders.
  const shownQuery = useDeferredValue(query);
  const shownCategory = useDeferredValue(category);
  const shownSection = useDeferredValue(section);

  const searching = query.trim().length > 0;
  const trimmed = shownQuery.trim().toLowerCase();
  const results = useMemo(() => {
    if (trimmed) {
      return shopProducts.filter((product) =>
        [product.code, product.name, product.section].some((field) => field.toLowerCase().includes(trimmed)),
      );
    }
    return shopProducts.filter((product) => product.category === shownCategory && (!shownSection || product.section === shownSection));
  }, [trimmed, shownCategory, shownSection, shopProducts]);
  const page = useMemo(() => results.slice(0, visible), [results, visible]);
  const renderProduct = useCallback(({ item }: { item: ShopProduct }) => <ProductCard product={item} />, []);

  const selectCategory = (id: ShopCategoryId) => {
    setCategory(id);
    setSection(null);
    setVisible(PAGE_SIZE);
  };

  const activeCategory = shopCategories.find((item) => item.id === shownCategory);

  return (
    <Screen
      title="Shop"
      subtitle="Architectural systems and hardware"
      // A virtualized grid: only cards near the screen are drawn, and new ones are added a few at a time,
      // so Show More stays smooth however many products are loaded.
      list={{
        data: page,
        renderItem: renderProduct,
        keyExtractor: productKey,
        numColumns: 2,
        columnWrapperStyle: styles.gridRow,
        initialNumToRender: 6,
        maxToRenderPerBatch: 6,
        updateCellsBatchingPeriod: 40,
        windowSize: 7,
        removeClippedSubviews: Platform.OS === 'android',
        ListFooterComponent:
          results.length > visible ? (
            <Button
              label={`Show More (${results.length - visible})`}
              onPress={() => setVisible((count) => count + PAGE_SIZE)}
              variant="gray"
              size="medium"
              style={styles.more}
            />
          ) : null,
      }}
    >
      <View style={styles.search}>
        <Ionicons name="search" size={18} color={colors.secondaryLabel} />
        <TextInput
          value={query}
          onChangeText={(text) => {
            setQuery(text);
            setVisible(PAGE_SIZE);
          }}
          placeholder="Products or codes, e.g. TGH-55"
          placeholderTextColor={colors.secondaryLabel}
          selectionColor={colors.tint}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          clearButtonMode="while-editing"
          accessibilityLabel="Search products"
          style={styles.searchInput}
        />
        {/* iOS draws its own clear button inside the field. */}
        {query.length > 0 && Platform.OS !== 'ios' && (
          <Pressable onPress={() => setQuery('')} accessibilityRole="button" accessibilityLabel="Clear search" hitSlop={12}>
            <Ionicons name="close-circle" size={18} color={colors.tertiaryLabel} />
          </Pressable>
        )}
      </View>

      {!searching && (
        <>
          <HeroCard />

          <Text style={styles.sectionTitle} accessibilityRole="header">
            Shop by Category
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.bleed} contentContainerStyle={styles.categoryRow}>
            {shopCategories.map((item) => {
              const selected = item.id === category;
              return (
                <Pressable
                  key={item.id}
                  onPress={() => selectCategory(item.id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`${item.label}, ${counts.get(item.id) ?? 0} products`}
                  style={({ pressed }) => [styles.categoryTile, pressed && styles.pressed]}
                >
                  <View style={[styles.categoryImageFrame, selected && styles.categoryImageSelected]}>
                    <Image cachePolicy="memory-disk" source={item.image} style={[styles.categoryImage, item.fit === 'contain' && styles.categoryImageProduct]} contentFit={item.fit} />
                  </View>
                  <Text style={[styles.categoryName, selected && { color: colors.tint }]} numberOfLines={2}>
                    {item.label}
                  </Text>
                  <Text style={styles.categoryCount}>{counts.get(item.id) ?? 0} products</Text>
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
                    hitSlop={{ top: 4, bottom: 4 }}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    style={({ pressed }) => [styles.chip, selected && styles.chipSelected, pressed && styles.pressed]}
                  >
                    <Text style={[styles.chipText, selected && { color: colors.white }]}>{item ?? 'All'}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          )}
        </>
      )}

      {results.length === 0 ? (
        <EmptyState icon="search" title="No Results" message={`No products match “${shownQuery.trim()}”. Check the spelling or try a product code.`} />
      ) : (
        <View style={styles.resultsHeader}>
          <Text style={styles.resultsTitle} accessibilityRole="header">
            {trimmed ? 'Results' : (shownSection ?? activeCategory?.label)}
          </Text>
          <Text style={styles.resultsCount}>
            {results.length} product{results.length === 1 ? '' : 's'}
          </Text>
        </View>
      )}
    </Screen>
  );
}

const productKey = (product: ShopProduct) => product.id;

const styles = StyleSheet.create({
  search: {
    height: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginBottom: 20,
    paddingHorizontal: 10,
    backgroundColor: colors.tertiaryFill,
    borderRadius: radius.md,
  },
  searchInput: { ...type.body, flex: 1, height: '100%', padding: 0 },
  pressed: { opacity: 0.7 },
  sectionTitle: { ...type.title3, marginTop: 28, marginBottom: 12 },
  // Let horizontal rows run to the screen edges past the page gutter.
  bleed: { marginHorizontal: -space.gutter },
  categoryRow: { gap: 12, paddingHorizontal: space.gutter },
  categoryTile: { width: 128 },
  categoryImageFrame: { padding: 3, borderWidth: 2, borderColor: 'transparent', borderRadius: radius.md + 3 },
  categoryImageSelected: { borderColor: colors.tint },
  categoryImage: { width: '100%', height: 80, borderRadius: radius.md - 2, backgroundColor: colors.groupedBackground },
  categoryImageProduct: { backgroundColor: colors.white },
  categoryName: { ...type.footnote, minHeight: 36, marginTop: 6, marginHorizontal: 3, fontWeight: '600' },
  categoryCount: { ...type.caption1, marginHorizontal: 3, color: colors.secondaryLabel },
  chipRow: { gap: 8, paddingHorizontal: space.gutter, paddingTop: 16 },
  chip: { height: 34, justifyContent: 'center', paddingHorizontal: 14, backgroundColor: colors.tertiaryFill, borderRadius: 17 },
  chipSelected: { backgroundColor: colors.tint },
  chipText: { ...type.subheadline, fontWeight: '500' },
  resultsHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, marginTop: 28, marginBottom: 12 },
  resultsTitle: { ...type.title3, flexShrink: 1 },
  resultsCount: { ...type.footnote, color: colors.secondaryLabel },
  gridRow: { justifyContent: 'space-between', marginBottom: 20 },
  more: { marginTop: 4, alignSelf: 'center' },
});
