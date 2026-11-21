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

export type StockUnit = 'pcs' | 'box' | 'packet' | 'set' | 'feet' | 'rft' | 'meter' | 'sqft' | 'sqm' | 'kg' | 'sheet' | 'length';

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
  kind: 'opening' | 'count' | 'adjust' | 'delivered' | 'undelivered' | 'purchase' | 'purchase_cancelled';
  reason: string;
  note: string;
  orderId?: string | null;
  orderNumber?: string | null;
  purchaseId?: string | null;
  purchaseNumber?: string | null;
  by: string;
  at: string;
};

/** Phase 2: someone the shop buys from. Money is rupees and paise; outstanding is what the shop still owes them. */
export type Supplier = {
  id: number;
  name: string;
  company: string;
  contactPerson: string;
  phone: string;
  email: string;
  gstin: string;
  address: string;
  state: string;
  openingBalance: number;
  paymentDays: number | null;
  bankDetails: string;
  notes: string;
  archived: boolean;
  createdAt: string;
  /** Received bills. */
  bills: number;
  billed: number;
  paid: number;
  /** Opening balance + received bills − payments. Below zero: an advance. */
  outstanding: number;
  lastPurchase: string | null;
  drafts: number;
};

export type PurchaseStatus = 'draft' | 'received' | 'cancelled';

/** One line of a supplier's bill: a copy of the item as bought. Rates are before GST. */
export type PurchaseItem = { productId: string; option: string; name: string; code: string; qty: number; unit: StockUnit; rate: number; discountPct: number; gstRate: number };

export type SupplierPayment = { id: string; amount: number; method: PaymentMethod; paidOn: string; note?: string; by: string; at: string };

/** A supplier's bill. Its figures are worked out by the server from the items and charges. */
export type Purchase = {
  id: string;
  /** The shop's own number, PUR-0001. */
  number: string;
  supplier: { id: number; name: string };
  /** The number on the supplier's bill. */
  supplierInvoice?: string;
  billDate: string;
  status: PurchaseStatus;
  items: PurchaseItem[];
  freight: number;
  otherCharges: number;
  discount: number;
  roundOff: number;
  subtotal: number;
  tax: number;
  total: number;
  notes?: string;
  attachment?: string;
  payments?: SupplierPayment[];
  createdBy: string;
  createdAt: string;
  receivedBy?: string;
  receivedAt?: string;
  cancelledBy?: string;
  cancelledAt?: string;
  supplierGstin?: string;
  /** IGST (another state) rather than CGST + SGST, fixed when the bill was saved. */
  interstate: boolean;
  /** Input tax credit as the accountant reviewed it; every bill starts pending. */
  itcStatus: ItcStatus;
  /** The return month (YYYY-MM) it was claimed or reversed in. */
  itcPeriod?: string;
  itcNote?: string;
  itcBy?: string;
  itcAt?: string;
};

export type ItcStatus = 'pending' | 'eligible' | 'ineligible' | 'claimed' | 'reversed';

/** The shop's GST registration and invoice numbering (GST Settings). */
export type GstSettings = {
  legalName: string;
  tradeName: string;
  gstin: string;
  address: string;
  pincode: string;
  registrationType: 'regular' | 'composition';
  invoicePrefix: string;
  terms: string;
  updatedBy?: string | null;
  updatedAt?: string | null;
};

/** One line of a tax invoice: what the buyer pays for it (GST included), and the tax worked out of that. */
export type InvoiceItem = {
  productId: string;
  option: string;
  description: string;
  hsn: string;
  qty: number;
  unit: StockUnit;
  amount: number;
  gstRate: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
};

/** A GST tax invoice made from an order. Drafts have no number; posted ones are cancelled, never deleted. */
export type SalesInvoice = {
  id: string;
  orderId: string;
  orderNumber: string;
  number?: string;
  financialYear?: string;
  invoiceDate: string;
  status: 'draft' | 'posted' | 'cancelled';
  customerId?: number;
  customerName: string;
  /** Empty for an unregistered buyer (B2C). */
  customerGstin?: string;
  billingAddress?: string;
  placeOfSupply?: string;
  posCode?: string;
  interstate: boolean;
  sellerGstin?: string;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  roundOff: number;
  total: number;
  notes?: string;
  items: InvoiceItem[];
  createdBy: string;
  createdAt: string;
  postedBy?: string;
  postedAt?: string;
  cancelledBy?: string;
  cancelledAt?: string;
  cancelReason?: string;
};

/** GST paid to the government, entered from the challan. */
export type GstPayment = {
  id: string;
  period: string;
  paidOn: string;
  challan: string;
  cpin: string;
  cin: string;
  cgst: number;
  sgst: number;
  igst: number;
  cess: number;
  interest: number;
  penalty: number;
  note: string;
  attachment: string | null;
  by: string;
  at: string;
};

/** From the app's menu: a rating, a problem report, a suggestion or other feedback. */
export type AppFeedback = {
  id: string;
  rating: number | null;
  kind: 'feedback' | 'problem' | 'suggestion';
  message: string;
  appVersion: string;
  platform: string;
  status: 'new' | 'seen' | 'resolved';
  staffNote: string;
  handledBy: string | null;
  handledAt: string | null;
  createdAt: string;
  appUser: { id: number; label: string; name: string; business: string; phone: string };
  customer: { id: number; name: string } | null;
};

export type ActivityArea = 'orders' | 'purchases' | 'catalogue' | 'calculators' | 'content' | 'settings';

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
