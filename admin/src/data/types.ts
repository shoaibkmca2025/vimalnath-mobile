/** Shapes mirror the mobile app's data (src/data in the app), with images as URLs instead of require()s. */

export type CatalogSource = 'master' | 'office' | 'tavic';

export type ProductOption = { label: string; code?: string; mrp: number };
export type Spec = { label: string; value: string };

export type Product = {
  id: string;
  code: string;
  /** Empty when the catalogue only prints the code; the section title stands in for it. */
  name: string;
  category: string;
  section: string;
  image: string | null;
  catalogPage: { source: CatalogSource; page: number };
  options: ProductOption[];
  specs: Spec[];
  featured: boolean;
  /** Hidden products stay in the admin but aren't shown in the app. */
  visible: boolean;
};

export type Category = { id: string; label: string; image: string; fit: 'cover' | 'contain'; visible: boolean };

export type PriceList = { number: string; kicker: string; title: string; meta: string; tone: string; url: string };

export type Section = { code: string; name: string; system: string; bar: number; dimensions: string; description: string };

export type Video = { title: string; detail: string; url: string };
export type VideoSection = { title: string; videos: Video[] };

export type CutlistSystemId = 'telescopic' | 'synchronized' | 'folding';
export type CutlistSystem = { id: CutlistSystemId; name: string; subtitle: string; photo: string | null };
export type Configuration = { name: string; image: string };

export type Banner = { id: string; image: string; kicker: string; headline: string; body: string; active: boolean };

export type Settings = {
  companyName: string;
  tagline: string;
  phone: string;
  email: string;
  website: string;
  address: string;
  defaultUnit: 'mm' | 'in';
  priceListEdition: string;
  developer: string;
  appVersion: string;
  logo: string;
};

export type OrderStatus = 'placed' | 'confirmed' | 'dispatched' | 'delivered' | 'cancelled';

/** Same fields as an order line in the app (OrdersProvider): a snapshot of the product when it was ordered. */
export type OrderLine = {
  productId: string;
  code: string;
  name: string;
  option?: string;
  optionCode?: string;
  /** The note typed on the cart line in the app. */
  note?: string;
  qty: number;
  /** MRP per unit; missing when the product is priced from its catalogue page. */
  mrp?: number;
};

export type OrderEvent = {
  status: OrderStatus;
  at: string;
  /** Who made the change: "App" for the order itself, otherwise the admin's name. */
  by: string;
};

/** The app's order (customer or site name, optional phone and notes) plus what the admin tracks. */
export type Order = {
  id: string;
  number: string;
  createdAt: string;
  customer: string;
  phone?: string;
  /** "Delivery address, timing…" from the app's Place Order sheet. */
  notes?: string;
  status: OrderStatus;
  lines: OrderLine[];
  /** Sum of the priced lines only, as in the app. */
  total: number;
  history: OrderEvent[];
  /** Only seen in the admin, never by the customer. */
  internalNote?: { text: string; at: string; by: string };
};

export type ActivityArea = 'orders' | 'catalogue' | 'calculators' | 'content' | 'settings';

/** One change made in the admin, newest first in the log. */
export type Activity = { id: string; at: string; by: string; area: ActivityArea; summary: string; to?: string };

export type Seed = {
  generatedAt: string;
  products: Product[];
  catalogPages: Record<string, string>;
  categories: Category[];
  catalogues: PriceList[];
  sections: Section[];
  videoSections: VideoSection[];
  cutlist: { systems: CutlistSystem[]; configurations: Record<CutlistSystemId, Configuration[]> };
  banners: Banner[];
  settings: Settings;
};

/** Everything the admin edits. Orders are sample data until the app sends real ones to a server. */
export type Database = Omit<Seed, 'generatedAt'> & { orders: Order[]; activity: Activity[] };
