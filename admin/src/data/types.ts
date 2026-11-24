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

/** Another 4AM Global Media app, listed under More Apps. A link is empty when the app isn’t in that store. */
export type MoreApp = { name: string; description: string; icon: string | null; playStore: string; appStore: string };

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
  /** The newest version in the stores. */
  appVersion: string;
  /** Older apps ask people to update before ordering; empty means any version may order. */
  minAppVersion: string;
  /** Module 8.6: the cutting loss in mm the Bar Optimizer starts with, e.g. '3'. */
  kerfMm: string;
  /** Module 9.7: a notice at the top of the app, shown from and until these dates (YYYY-MM-DD); empty dates are open. */
  announcement: string;
  announcementFrom: string;
  announcementTo: string;
  /** Payments: a credit order falls due this many days after delivery, e.g. '30'. */
  creditDays: string;
  logo: string;
};

/** requested and declined: sent from the admin, waiting on or turned down by the customer. confirmed is Pending for the inventory team. */
export type OrderStatus = 'requested' | 'declined' | 'placed' | 'confirmed' | 'packed' | 'dispatched' | 'delivered' | 'cancelled';

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
  /** Set by the server when the line didn't match the catalogue, e.g. "No longer in the catalogue". */
  problem?: string;
  /** Ticked on the inventory team's pick list while the order is packed. */
  picked?: { at: string; by: string };
};

export type OrderEvent = {
  status: OrderStatus;
  at: string;
  /** Who made the change: "App" for the customer (placing, confirming or declining), otherwise the staff member's name. */
  by: string;
};

/** Cash is due on delivery; credit, the Settings' credit period after it. */
export type PaymentTerms = 'cash' | 'credit';
export type PaymentMethod = 'cash' | 'upi' | 'bank' | 'cheque';

/** Money received towards an order, in whole rupees, on the day staff say it came in (YYYY-MM-DD). */
export type Payment = { id: string; amount: number; method: PaymentMethod; paidOn: string; note?: string; by: string; at: string };

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
  /** 'app': placed from the cart. 'admin': sent from the admin for the customer to confirm. */
  source?: 'app' | 'admin';
  /** For an order sent from the admin: when the customer's app first received it. */
  customerSeenAt?: string;
  /** The inventory team's note (stock, transport, LR number). Seen by all staff, never by the customer. */
  inventoryNote?: { text: string; at: string; by: string };
  /** The App Users entry whose phone sent it. */
  appUser?: { id: number; label: string };
  /** The customer that app user belongs to (Module 7); customers group orders by this, not by the typed name. */
  customerRecord?: { id: number; name: string };
  /** Payments (Owners and Sales only; the inventory team's copy leaves these three out). Missing means credit. */
  terms?: PaymentTerms;
  /** What the customer owes for it, when staff changed it; missing means the MRP total. */
  bill?: number;
  /** Oldest first. Missing when nothing has been paid. */
  payments?: Payment[];
};

export type StockUnit = 'pcs' | 'box' | 'kg' | 'meter' | 'feet' | 'set';

/**
 * One item the shop counts: a product option, or a product without options (option ''). Prices are rupees and paise
 * before GST; null means not entered. Missing from the list: not tracked yet.
 */
export type StockItem = {
  productId: string;
  option: string;
  sku: string;
  barcode: string;
  unit: StockUnit;
  brand: string;
  manufacturer: string;
  hsn: string;
  gstRate: number | null;
  /** Owners only; null for everyone else. */
  purchasePrice: number | null;
  sellingPrice: number | null;
  wholesalePrice: number | null;
  /** Below zero when more was delivered than counted. */
  quantity: number;
  minStock: number | null;
  maxStock: number | null;
  rack: string;
  location: string;
  updatedAt: string;
  /** Its option was renamed or removed in the product editor. */
  orphan: boolean;
};

/** One change to an item's quantity, newest first. */
export type StockMove = {
  id: string;
  productId: string;
  option: string;
  change: number;
  balance: number;
  kind: 'opening' | 'count' | 'adjust' | 'delivered' | 'undelivered';
  reason: string;
  note: string;
  orderId?: string;
  orderNumber?: string;
  by: string;
  at: string;
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

/** Everything the admin shows and edits. */
export type Database = Omit<Seed, 'generatedAt'> & { orders: Order[]; moreApps: MoreApp[]; activity: Activity[]; stock: StockItem[] };
