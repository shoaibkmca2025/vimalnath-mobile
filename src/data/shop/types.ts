import type { ImageSourcePropType } from 'react-native';

/**
 * Top shop categories, following the catalogue index. 'hardware' is only the extractor's raw bucket for
 * the Master and Tavic catalogues; index.ts files each of those products under one of the finer ids.
 */
export type ShopCategoryId =
  | 'hardware'
  | 'glass'
  | 'doorControl'
  | 'shower'
  | 'automatic'
  | 'locks'
  | 'wardrobe'
  | 'doors'
  | 'office'
  | 'folding'
  | 'telescopic'
  | 'synchro';

export type CatalogSource = 'master' | 'office' | 'tavic';

/** One orderable choice of a product, e.g. a kit in a finish. */
export type ProductOption = { label: string; code?: string; mrp: number };

export type ShopProduct = {
  id: string;
  code: string;
  /** Empty when the catalogue only prints the code; the section title stands in for it. */
  name: string;
  category: ShopCategoryId;
  section: string;
  image?: ImageSourcePropType;
  /** The catalogue page with this product's sizes, finishes and MRP. */
  catalogPage: { source: CatalogSource; page: number };
  /** Exact MRP options, only for products whose prices were checked against the price list. */
  options?: ProductOption[];
  specs?: { label: string; value: string }[];
  featured?: boolean;
};
