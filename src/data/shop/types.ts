import type { ImageSourcePropType } from 'react-native';

export type ShopCategoryId = 'hardware' | 'office' | 'folding' | 'telescopic' | 'synchro';

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
