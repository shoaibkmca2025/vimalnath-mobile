import type { ImageSourcePropType } from 'react-native';

import { catalogPages as extractedPages, catalogProducts } from './catalog.generated';
import { catalogPrices, extraPages, extraProducts } from './catalog.prices.generated';
import { systemProducts } from './systems';
import type { ShopCategoryId, ShopProduct } from './types';

export type { ProductOption, ShopCategoryId, ShopProduct } from './types';

export const catalogPages: Record<string, ImageSourcePropType> = { ...extractedPages, ...extraPages };

const HARDWARE_IMAGE = require('../../../assets/shop/systems/hardware.webp');
const OFFICE_IMAGE = require('../../../assets/shop/systems/office-partition.webp');

export type ShopCategory = { id: ShopCategoryId; label: string; short: string; image: ImageSourcePropType };

// In the order Vimalnath asked for on the home screen.
export const shopCategories: ShopCategory[] = [
  { id: 'hardware', label: 'Hardware', short: 'Hardware', image: HARDWARE_IMAGE },
  { id: 'office', label: 'Office Partition', short: 'Office Partition', image: OFFICE_IMAGE },
  { id: 'folding', label: 'Sliding Folding System', short: 'Sliding Folding', image: require('../../../assets/images/sliding-folding-photo.webp') },
  { id: 'telescopic', label: 'Telescopic Sliding', short: 'Telescopic', image: require('../../../assets/images/telescopic-sliding-photo.webp') },
  { id: 'synchro', label: 'Synchronized Systems', short: 'Synchronized', image: require('../../../assets/images/synchronized-system-photo.webp') },
];

/**
 * Curated systems first, then everything read from the catalogues, with the MRP options typed from
 * the price lists attached (products without a printed price keep the "price in catalogue" flow).
 */
export const shopProducts: ShopProduct[] = [
  ...systemProducts,
  ...[...catalogProducts, ...extraProducts].map((product) => {
    const options = catalogPrices[product.id];
    return options ? { ...product, options } : product;
  }),
];

const byId = new Map(shopProducts.map((product) => [product.id, product]));

export function findShopProduct(id: string): ShopProduct | undefined {
  return byId.get(id);
}

export function productTitle(product: ShopProduct): string {
  return product.name || product.section;
}

export function lowestPrice(product: ShopProduct): number | undefined {
  return product.options?.length ? Math.min(...product.options.map((option) => option.mrp)) : undefined;
}

/** ₹1,04,500 — Indian digit grouping, done by hand so it doesn't depend on the engine's Intl data. */
export function formatINR(amount: number): string {
  const whole = String(Math.round(amount));
  const lastThree = whole.slice(-3);
  const rest = whole.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `₹${rest ? `${rest},` : ''}${lastThree}`;
}
