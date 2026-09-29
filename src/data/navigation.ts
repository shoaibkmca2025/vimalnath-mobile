import type { IconName } from '@/components/Button';

export type NavKey = 'home' | 'catalog' | 'bar' | 'cutlist' | 'orders';

/**
 * Top-level destinations. `label` is the single word shown in the tab bar; `title` is the full name
 * used in the menu drawer, which has room for it. Icons are filled, as on iOS.
 */
export const primaryNav: {
  key: NavKey;
  route: string;
  href: '/' | '/catalog' | '/bar-optimizer' | '/cutlist' | '/orders';
  label: string;
  title: string;
  icon: IconName;
}[] = [
  { key: 'home', route: 'index', href: '/', label: 'Shop', title: 'Shop', icon: 'storefront' },
  { key: 'catalog', route: 'catalog', href: '/catalog', label: 'Catalog', title: 'Catalog', icon: 'book' },
  { key: 'bar', route: 'bar-optimizer', href: '/bar-optimizer', label: 'Optimizer', title: 'Bar Optimizer', icon: 'calculator' },
  { key: 'cutlist', route: 'cutlist', href: '/cutlist', label: 'Cutlist', title: 'Cutlist', icon: 'cut' },
  { key: 'orders', route: 'orders', href: '/orders', label: 'Orders', title: 'Orders', icon: 'receipt' },
];
