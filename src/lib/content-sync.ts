import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { useSyncExternalStore } from 'react';
import { AppState, type ImageSourcePropType } from 'react-native';

import type { Configuration } from '@/components/ConfigurationGridScreen';
import { catalogues, type Catalogue, type CatalogueTone } from '@/data/catalogues';
import { cutlistSystems, foldingConfigurations, synchronizedConfigurations, telescopicConfigurations, type CutlistSystem } from '@/data/cutlist';
import { bundledMedia } from '@/data/media.generated';
import { sections, type Section } from '@/data/sections';
import { catalogPages, setShopProducts, shopCategories, shopProducts, type ProductOption, type ShopCategory, type ShopCategoryId, type ShopProduct } from '@/data/shop';
import type { CatalogSource } from '@/data/shop/types';
import { installationVideoSections, type InstallationVideo } from '@/data/videos';
import { getAdminSyncStatus, initializeAdminSync, request, subscribeAdminSync } from '@/lib/admin-sync';
import type { LengthUnit } from '@/lib/length-units';

/**
 * Module 11, App sync. Phones linked to the shop download what staff edit in the admin (catalogue, prices, cutlist,
 * bar sections, banners, videos, More Apps, company details and app settings), keep the last download, and work
 * from it without signal. Screens read it with useAppContent(); until a phone has a download it uses the data
 * built into the app, so the very first launch works offline too.
 */

export type Banner = { id: string; image?: ImageSourcePropType; kicker: string; headline: string; body: string };
export type MoreApp = { name: string; description: string; icon?: ImageSourcePropType; playStore: string; appStore: string };
export type VideoSection = { title: string; videos: InstallationVideo[] };
export type ShopSettings = {
  companyName: string;
  tagline: string;
  phone: string;
  email: string;
  website: string;
  address: string;
  logo?: ImageSourcePropType;
  defaultUnit: LengthUnit;
  priceListEdition: string;
  /** Older app versions are asked to update before ordering; empty means any version may order. */
  minAppVersion: string;
  /** Module 8.6: the cutting loss the Bar Optimizer starts with, in mm. */
  kerfMm: number;
  /** Module 9.7: a notice for the top of the Shop, shown between these dates (YYYY-MM-DD; empty is open). */
  announcement: string;
  announcementFrom: string;
  announcementTo: string;
  developer: string;
};
/** Items the shop has counted as out or low, by product and option ('' for a product without options). */
export type StockStates = Record<string, Record<string, 'out' | 'low'>>;
export type AppContent = {
  products: ShopProduct[];
  stock: StockStates;
  categories: ShopCategory[];
  catalogPages: Record<string, ImageSourcePropType>;
  catalogues: Catalogue[];
  cutlistSystems: CutlistSystem[];
  configurations: Record<CutlistSystem['id'], Configuration[]>;
  sections: Section[];
  videoSections: VideoSection[];
  banners: Banner[];
  moreApps: MoreApp[];
  settings: ShopSettings;
};

/** What GET /v1/app/content sends: the admin's data, with images named by path. */
type Path = string | null;
type ServerContent = {
  /** Missing from a shop server older than stock tracking. */
  stock?: StockStates;
  products: { id: string; code: string; name: string; category: string; section: string; image: Path; catalogPage: { source: CatalogSource; page: number }; options: ProductOption[]; specs: { label: string; value: string }[]; featured: boolean }[];
  categories: { id: string; label: string; image: Path; fit: 'cover' | 'contain' }[];
  catalogPages: Record<string, string>;
  priceLists: { number: string; kicker: string; title: string; meta: string; tone: CatalogueTone; url: string }[];
  cutlist: { systems: { id: CutlistSystem['id']; name: string; subtitle: string; photo: Path }[]; configurations: Record<CutlistSystem['id'], { name: string; image: string }[]> };
  sections: Section[];
  banners: { id: string; image: string; kicker: string; headline: string; body: string }[];
  videoSections: VideoSection[];
  moreApps: { name: string; description: string; icon: Path; playStore: string; appStore: string }[];
  settings: Record<string, string>;
};
type Saved = { version: string; baseUrl: string; content: ServerContent };

const KEY = 'vimalnath:content:v1';

/** Module 11.5: what ships in the app, for the first launch and for phones not linked to the shop. */
const BUILT_IN: AppContent = {
  products: shopProducts,
  stock: {},
  categories: shopCategories,
  catalogPages,
  catalogues,
  cutlistSystems,
  configurations: { telescopic: telescopicConfigurations, synchronized: synchronizedConfigurations, folding: foldingConfigurations },
  sections,
  videoSections: installationVideoSections,
  banners: [1, 2, 3, 4].map((n) => ({
    id: `hero-${n}`,
    image: bundledMedia[`/media/images/hero/hero-slide-${n}.webp`],
    kicker: 'New collection · 2026',
    headline: 'Systems that move with you.',
    body: 'Sliding, folding and slim partition solutions.',
  })),
  moreApps: [],
  settings: {
    companyName: 'Vimalnath Sales Corporation',
    tagline: 'Architectural systems and hardware',
    phone: '',
    email: '',
    website: '',
    address: '',
    logo: bundledMedia['/media/images/logo-mark.png'],
    defaultUnit: 'mm',
    priceListEdition: 'Taiton · Feb 2026',
    minAppVersion: '',
    kerfMm: 0,
    announcement: '',
    announcementFrom: '',
    announcementTo: '',
    developer: '4AM Global Media',
  },
};

/** The app's own pictures come from the app; photos staff uploaded download from the shop, then stay on the phone. */
function imageFrom(path: Path, baseUrl: string): ImageSourcePropType | undefined {
  if (!path) return undefined;
  return path.startsWith('/v1/media/') ? { uri: baseUrl + path } : bundledMedia[path];
}

function fromServer(content: ServerContent, baseUrl: string): AppContent {
  const image = (path: Path) => imageFrom(path, baseUrl);
  const products: ShopProduct[] = content.products.map(({ image: path, options, specs, featured, category, ...product }) => ({
    ...product,
    category: category as ShopCategoryId,
    image: image(path),
    // The app's "price in catalogue" flow is for products without options.
    ...(options.length ? { options } : null),
    ...(specs.length ? { specs } : null),
    ...(featured ? { featured } : null),
  }));
  const configurations = (list: { name: string; image: string }[]) => list.map((item) => ({ name: item.name, image: image(item.image) ?? {} }));
  return {
    products,
    stock: content.stock ?? {},
    categories: content.categories.map(({ id, label, image: path, fit }) => ({
      id: id as ShopCategoryId,
      label,
      fit,
      // A category without its own picture shows its first product's.
      image: image(path) ?? products.find((product) => product.category === id && product.image)?.image ?? BUILT_IN.settings.logo!,
    })),
    catalogPages: Object.fromEntries(Object.entries(content.catalogPages).flatMap(([key, path]) => (image(path) ? [[key, image(path)!]] : []))),
    catalogues: content.priceLists.map(({ url, ...list }) => ({ ...list, ...(url ? { url } : null) })),
    cutlistSystems: content.cutlist.systems.map(({ photo, ...system }) => ({ ...system, photo: image(photo) })),
    configurations: {
      telescopic: configurations(content.cutlist.configurations.telescopic),
      synchronized: configurations(content.cutlist.configurations.synchronized),
      folding: configurations(content.cutlist.configurations.folding),
    },
    // The bar optimizer needs a section to start from, so an emptied list keeps the app's own.
    sections: content.sections.length ? content.sections : BUILT_IN.sections,
    videoSections: content.videoSections,
    banners: content.banners.map((banner) => ({ ...banner, image: image(banner.image) })),
    moreApps: content.moreApps.map(({ icon, ...app }) => ({ ...app, icon: image(icon) })),
    settings: {
      ...BUILT_IN.settings,
      ...content.settings,
      logo: image(content.settings.logo ?? null) ?? BUILT_IN.settings.logo,
      defaultUnit: content.settings.defaultUnit === 'in' ? 'in' : 'mm',
      kerfMm: Number(content.settings.kerfMm) || 0,
    },
  };
}

let saved: Saved | undefined;
let live = BUILT_IN;
const listeners = new Set<() => void>();

/** Converts first, so a download this app can't read leaves the screens as they were. */
function apply(next: Saved) {
  live = fromServer(next.content, next.baseUrl);
  saved = next;
  setShopProducts(live.products);
  listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const snapshot = () => live;

/** 'out', 'low', or undefined when there's enough (or the shop doesn't count it). */
export function stockOf(stock: StockStates, productId: string, option: string | undefined) {
  return stock[productId]?.[option ?? ''];
}

/** Everything the app shows, from the shop's last download or else the app itself. Screens update when a download lands. */
export function useAppContent(): AppContent {
  return useSyncExternalStore(subscribe, snapshot);
}

/** Module 11.4: the saved copy, read before the first screen shows so it never flashes the built-in data. */
export async function loadSavedContent() {
  try {
    const text = await AsyncStorage.getItem(KEY);
    if (text) apply(JSON.parse(text) as Saved);
  } catch {
    // An unreadable copy keeps the built-in data; the next download replaces it.
  }
}

let running: Promise<void> | undefined;

/** Module 11.2: asks the shop for changes since the version this phone has. Quietly does nothing offline or when not linked. */
export function syncContent(): Promise<void> {
  running ??= (async () => {
    await initializeAdminSync();
    const { connection } = getAdminSyncStatus();
    if (!connection.enabled || !connection.customerId) return;
    const download = await request<{ version: string; content?: ServerContent }>(connection, `content?have=${encodeURIComponent(saved?.version ?? '')}`);
    if (!download.content) return;
    const next = { version: download.version, baseUrl: connection.baseUrl, content: download.content };
    apply(next);
    await AsyncStorage.setItem(KEY, JSON.stringify(next));
  })()
    // No signal is normal: the saved copy stays, and the next foreground tries again.
    .catch(() => {})
    .finally(() => {
      running = undefined;
    });
  return running;
}

/** Checks now, whenever the app comes back to the front, and as soon as the phone is linked to the shop. */
export function startContentSync() {
  void syncContent();
  const subscription = AppState.addEventListener('change', (state) => {
    if (state === 'active') void syncContent();
  });
  let linked = getAdminSyncStatus().connected;
  const unsubscribe = subscribeAdminSync((status) => {
    if (status.connected && !linked) void syncContent();
    linked = status.connected;
  });
  return () => {
    subscription.remove();
    unsubscribe();
  };
}

/** Module 9.7: the shop's notice if today, on this phone's calendar, is within its dates; otherwise empty. */
export function activeAnnouncement(settings: ShopSettings, now = new Date()) {
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const { announcement, announcementFrom: from, announcementTo: to } = settings;
  return announcement && (!from || from <= today) && (!to || today <= to) ? announcement : '';
}

/** True when the shop needs a newer app than this one to order ("1.9.0" is older than "1.10.0"). */
export function needsUpdate(minimum: string, current = Constants.expoConfig?.version ?? '0.0.0') {
  if (!minimum) return false;
  const [have, need] = [current, minimum].map((version) => version.split('.').map(Number));
  for (let i = 0; i < 3; i++) {
    if ((have![i] ?? 0) !== (need![i] ?? 0)) return (have![i] ?? 0) < (need![i] ?? 0);
  }
  return false;
}
