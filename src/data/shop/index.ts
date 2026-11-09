import type { ImageSourcePropType } from 'react-native';

import { catalogPages as extractedPages, catalogProducts } from './catalog.generated';
import { catalogPrices, extraPages, extraProducts } from './catalog.prices.generated';
import { systemProducts } from './systems';
import type { ShopCategoryId, ShopProduct } from './types';

export type { ProductOption, ShopCategoryId, ShopProduct } from './types';

export const catalogPages: Record<string, ImageSourcePropType> = { ...extractedPages, ...extraPages };

/** Which top category each catalogue section of the raw 'hardware' bucket belongs to. */
const HARDWARE_SECTIONS: Record<string, ShopCategoryId> = {
  'Patch Fittings': 'glass',
  'Door Handles': 'glass',
  'Wall Profiles & Door Rails': 'glass',
  'Spider Fittings & Canopy': 'glass',
  'Door Control Hardware': 'doorControl',
  'Floor Springs': 'doorControl',
  'Door Closers': 'doorControl',
  'Concealed Hinges': 'doorControl',
  'Butterfly Soft Close Hinge': 'doorControl',
  'Shower Cubicle Fittings': 'shower',
  'Framed Shower Cubicles': 'shower',
  'Framed Shower Systems': 'shower',
  'Automatic Doors & Sensors': 'automatic',
  'RFID & Hotel Locks': 'locks',
  'Digital Door Locks': 'locks',
  'Wardrobe Systems': 'wardrobe',
  'Wardrobe Sliding Systems': 'wardrobe',
  'Wardrobe Hinges': 'wardrobe',
  'Cube Shelf & Glass Lamp': 'wardrobe',
  'Sliding Door Systems': 'doors',
  'Automatic Slim Framed Sliding': 'doors',
  'Manual Wooden Sliding': 'doors',
  'Slim Framed Swing Door': 'doors',
  'Invisible Sliding Systems': 'doors',
  'Pocket Door Series': 'doors',
  'PT Door Systems': 'doors',
};

/**
 * Names the PDF extraction got wrong: a description picked up, or two columns run together. Corrected by
 * hand from the printed pages. Kept here so re-running scripts/catalog doesn't lose them.
 */
const NAME_FIXES: Record<string, string> = {
  'hardware-tsh-2t': "Double Action 3-Way 'T' Hinge",
  'hardware-tsh-ofs-1': 'Wall to Glass Offset Hinge',
  'hardware-tgl-upr': 'Al. U Channel 19 x 25 x 2400mm',
  'hardware-tsl-wd-100': 'Sliding System Set for Single Framed / Wooden Door of 100kg',
  'hardware-tsl-track-e2': 'Top Track for TSL-WD-100 and TSL-GL-120 (2mt, 3mt & 4mt)',
  'hardware-tsl-44-b3-sc': 'Soft Close Track for TSL-44-A1-SC (Door & Fixed Glass)',
  'hardware-tsl-44-a1-sc': 'Soft Close Sliding Door System 44',
  'hardware-tsl-44-a1': 'Sliding Door System-44 Kit (Door Weight up to 40kg)',
  'hardware-tsl-44-a2': 'Sliding Door System-44 Kit (Door Weight up to 80kg)',
  'folding-tsfs-a14': 'End Sliding Folding Panel Fitting with Guide Locator',
  'folding-tsfs-a18': 'End Panel Fitting with Bottom Pivot (for odd panels)',
  'hardware-tam-ps-01': 'Premium Slide Automatic Sliding Door',
  'hardware-tam-ts-200': 'Terrific Slide Automatic Sliding Door',
  'hardware-tam-es-01': 'Eco Slide Automatic Sliding Door',
  'hardware-tam-gac': 'Aluminium Clamp for Glass (pair)',
  'hardware-tam-rf-leana-r-l': 'Leana Hotel RFID Card Lock',
  'hardware-tam-rf-urbana-r-l': 'Urbana Hotel RFID Card Lock',
  'hardware-tam-rf-magna-r-l': 'Magna Hotel RFID Card Lock',
  'hardware-tam-rf-platina-r-l': 'Platina Hotel RFID Card Lock',
  'hardware-tam-rf-slatina-r-l': 'Slatina Hotel RFID Card Lock',
  'hardware-tam-rf-divina-r-l': 'Divina Hotel RFID Card Lock',
  'hardware-tam-rf-viviana-r-l': 'Viviana Hotel RFID Card Lock',
  'hardware-tam-rf-slim': 'Slim RFID Hotel Lock for Aluminium Framed & UPVC Doors',
  'hardware-tam-rf-ps': 'Power Saver',
  'hardware-tcfh-100': 'Hydraulic Floor Hinge (Max Door Weight up to 100kg)',
  'hardware-tcfh-w-100': 'Hydraulic Floor Hinge (Max Door Weight up to 100kg)',
  'hardware-tfs-8400': 'Double Cylinder Floor Spring (Max Door Weight up to 100kg)',
  'hardware-tfs-10600': 'Double Cylinder Floor Spring for Wooden Door (Max Door Weight up to 600kg)',
  'hardware-tsk-60': 'Overhead Door Closer with Standard Arm (Max Door Weight 60kg)',
  'hardware-tsk-80': 'Overhead Door Closer with Standard Arm (Max Door Weight 80kg)',
  'hardware-tcd-3500': 'Concealed Door Closer with Track Arm (Max Door Weight 60kg)',
};

/**
 * Curated systems first, then everything read from the catalogues, with the MRP options typed from
 * the price lists attached (products without a printed price keep the "price in catalogue" flow).
 */
export const shopProducts: ShopProduct[] = [
  ...systemProducts,
  ...[...catalogProducts, ...extraProducts].map((product) => {
    const options = catalogPrices[product.id];
    const category = product.category === 'hardware' ? (HARDWARE_SECTIONS[product.section] ?? 'glass') : product.category;
    return { ...product, name: NAME_FIXES[product.id] ?? product.name, category, ...(options ? { options } : null) };
  }),
];

export type ShopCategory = {
  id: ShopCategoryId;
  label: string;
  image: ImageSourcePropType;
  /** Product photos are white squares, shown whole; lifestyle photos fill the tile. */
  fit: 'cover' | 'contain';
};

/** The product photo that stands for a category: the preferred product if it has one, else the first. */
function coverImage(category: ShopCategoryId, preferredId: string): ImageSourcePropType {
  const preferred = shopProducts.find((product) => product.id === preferredId && product.image);
  return (preferred ?? shopProducts.find((product) => product.category === category && product.image))!.image!;
}

const photo = (label: string, id: ShopCategoryId, image: ImageSourcePropType): ShopCategory => ({ id, label, image, fit: 'cover' });
const product = (label: string, id: ShopCategoryId, preferredId: string): ShopCategory => ({ id, label, image: coverImage(id, preferredId), fit: 'contain' });

// Follows the order of the Taiton catalogue index.
export const shopCategories: ShopCategory[] = [
  photo('Glass Hardware', 'glass', require('../../../assets/shop/systems/hardware.webp')),
  product('Door Control', 'doorControl', 'hardware-tfs-8400'),
  product('Shower Cubicles', 'shower', 'hardware-tsh-2'),
  product('Automatic Doors', 'automatic', 'hardware-tam-ps-01'),
  product('Smart Locks', 'locks', 'hardware-tam-dl-g2g'),
  product('Wardrobe Systems', 'wardrobe', 'hardware-tvc-whh-hinge'),
  product('Sliding & Swing Doors', 'doors', 'hardware-tsl-11-kit'),
  photo('Office Partition', 'office', require('../../../assets/shop/systems/office-partition.webp')),
  photo('Sliding Folding System', 'folding', require('../../../assets/images/sliding-folding-photo.webp')),
  photo('Telescopic Sliding', 'telescopic', require('../../../assets/images/telescopic-sliding-photo.webp')),
  photo('Synchronized Systems', 'synchro', require('../../../assets/images/synchronized-system-photo.webp')),
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
