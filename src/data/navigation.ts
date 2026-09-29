import type { IconName } from '@/components/Button';

export type NavKey = 'home' | 'catalog' | 'bar' | 'cutlist' | 'orders';

/** Top-level destinations shown in the tab bar. Labels are single words; icons are filled, as on iOS. */
export const primaryNav: { key: NavKey; route: string; href: '/' | '/catalog' | '/bar-optimizer' | '/cutlist' | '/orders'; label: string; icon: IconName }[] = [
  { key: 'home', route: 'index', href: '/', label: 'Shop', icon: 'storefront' },
  { key: 'catalog', route: 'catalog', href: '/catalog', label: 'Catalog', icon: 'book' },
  { key: 'bar', route: 'bar-optimizer', href: '/bar-optimizer', label: 'Optimizer', icon: 'calculator' },
  { key: 'cutlist', route: 'cutlist', href: '/cutlist', label: 'Cutlist', icon: 'cut' },
  { key: 'orders', route: 'orders', href: '/orders', label: 'Orders', icon: 'receipt' },
];
