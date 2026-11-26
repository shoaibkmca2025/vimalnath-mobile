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
/** return: a return's refund set against the order. store_credit: paid from credit the customer holds. */
export type PaymentMethod = 'cash' | 'upi' | 'bank' | 'cheque' | 'return' | 'store_credit';

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
  /** What can be sold. Below zero when more was delivered than counted. */
  quantity: number;
  /** Not for sale: goods back from customers waiting for the quality check, and damaged or defective goods. */
  held?: number;
  damaged?: number;
  defective?: number;
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
  kind:
    | 'opening'
    | 'count'
    | 'adjust'
    | 'delivered'
    | 'undelivered'
    | 'purchase'
    | 'purchase_cancelled'
    | 'return_received'
    | 'return_inspected'
    | 'return_reversed'
    | 'replacement'
    | 'replacement_reversed'
    | 'written_off'
    | 'supplier_return'
    | 'supplier_return_reversed';
  /** Which stock it moved; missing for what can be sold. */
  bucket?: StockBucket;
  returnId?: string | null;
  returnNumber?: string | null;
  supplierReturnId?: string | null;
  supplierReturnNumber?: string | null;
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
  /** Supplier returns: credit notes received, and money they refunded. */
  credited?: number;
  refunded?: number;
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
  /** Printed under the shop's address: phone numbers and email. */
  phone: string;
  email: string;
  bankName: string;
  bankAccount: string;
  bankBranchIfsc: string;
  declaration: string;
  /** e.g. SUBJECT TO NASHIK JURISDICTION */
  jurisdiction: string;
  updatedBy?: string | null;
  updatedAt?: string | null;
  /** This financial year (26-27) and the last invoice number used in it. */
  financialYear?: string;
  lastInvoiceNumber?: number;
};

/** One line of a tax invoice, as the shop bills: qty × rate (before GST) less a discount, with its share of the tax. */
export type InvoiceItem = {
  productId: string;
  option: string;
  /** The item's code, as the invoice prints it. */
  description: string;
  /** The smaller line under it, e.g. its name or profile series. */
  detail: string;
  /** Product code or SKU, on counter bills. */
  sku?: string;
  hsn: string;
  qty: number;
  /** A stock unit, PAIR, or one of the shop's own units (measurement_units). */
  unit: StockUnit | (string & {});
  /** Per unit, before GST (with GST when the bill's prices include it). */
  rate: number;
  discountPct: number;
  /** A fixed ₹ off the line, after its %. */
  discountAmount?: number;
  /** charge: transport or another charge, taxed like a line. */
  lineType?: 'goods' | 'charge';
  /** qty × rate less the line's discounts: its value before GST. */
  amount: number;
  /** Its share of the bill discount; taxable is amount less it. */
  billDiscount?: number;
  gstRate: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
};

/** A GST tax invoice made from an order. Drafts have no number; posted ones are cancelled, never deleted. */
export type SalesInvoice = {
  id: string;
  /** Missing for a counter bill, made without an order. */
  orderId?: string;
  orderNumber?: string;
  source?: 'order' | 'counter' | 'replacement';
  customerPhone?: string;
  dueDate?: string;
  pricesIncludeGst?: boolean;
  billDiscount?: number;
  billDiscountPct?: number;
  allowNegativeStock?: boolean;
  quotationId?: string;
  quotationNumber?: string;
  duplicateOf?: string;
  version?: number;
  reopenedBy?: string;
  reopenedAt?: string;
  reopenReason?: string;
  /** Paid so far: through the order for an order's invoice, on the bill for a counter bill. Missing for a replacement's. */
  paid?: number;
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
  details?: InvoiceDetails;
  /** What the buyer owed just before this invoice, fixed when it was posted. */
  previousBalance?: number;
  /** A replacement's tax invoice: the return it gives goods for. */
  returnId?: string;
  returnNumber?: string;
  items: InvoiceItem[];
  createdBy: string;
  createdAt: string;
  postedBy?: string;
  postedAt?: string;
  cancelledBy?: string;
  cancelledAt?: string;
  cancelReason?: string;
};

/** What a tax invoice prints besides the buyer's GST details: contacts, ship-to, and delivery and order references. */
export type InvoiceDetails = Partial<
  Record<
    | 'buyerContact'
    | 'buyerPhone'
    | 'buyerEmail'
    | 'shipName'
    | 'shipAddress'
    | 'shipGstin'
    | 'shipState'
    | 'shipContact'
    | 'shipPhone'
    | 'shipEmail'
    | 'deliveryNote'
    | 'paymentTerms'
    | 'reference'
    | 'otherReferences'
    | 'buyerOrderNo'
    | 'buyerOrderDate'
    | 'dispatchDocNo'
    | 'deliveryNoteDate'
    | 'dispatchedThrough'
    | 'destination'
    | 'deliveryTerms',
    string
  >
>;

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

export type ActivityArea = 'orders' | 'returns' | 'purchases' | 'catalogue' | 'calculators' | 'content' | 'settings';

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

// ---------- Phase 4: Returns & Replacements ----------

export type StockBucket = 'available' | 'held' | 'damaged' | 'defective';
export type ReturnKind = 'refund' | 'replacement';
export type ReturnStatus = 'pending' | 'under_review' | 'approved' | 'rejected' | 'received' | 'inspected' | 'refunded' | 'replaced' | 'closed' | 'cancelled';
export type ReturnReason = 'wrong_product' | 'damaged' | 'defective' | 'wrong_size' | 'changed_mind' | 'duplicate_order' | 'quality' | 'other';
export type ReturnCondition = 'unopened' | 'good' | 'opened' | 'damaged' | 'defective' | 'used' | 'incomplete';
/** Where a returned item goes after the quality check. */
export type ReturnOutcome = 'restock' | 'damaged' | 'defective' | 'write_off';
export type RefundMethod = 'cash' | 'upi' | 'bank' | 'cheque' | 'original' | 'store_credit' | 'adjustment';
export type RefundStatus = 'pending' | 'approved' | 'processing' | 'completed' | 'failed' | 'cancelled';
export type ReturnAction = 'create' | 'approve' | 'receive' | 'inspect' | 'refund';

/** A returned item: a copy of the line as it was sold (the invoice line when the order was invoiced). */
export type ReturnItem = {
  position: number;
  source: 'invoice' | 'order';
  sourcePosition: number;
  productId: string;
  option: string;
  description: string;
  name: string;
  hsn: string;
  unit: StockUnit;
  qty: number;
  /** Per unit: before GST when invoiced, the price billed otherwise. */
  rate: number;
  gstRate: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  /** Taxable value and GST. */
  amount: number;
  condition: ReturnCondition;
  outcome?: ReturnOutcome;
  outcomeNote?: string;
  inspectedBy?: string;
  inspectedAt?: string;
};

/** Goods given in exchange. */
export type ReplacementItem = {
  position: number;
  productId: string;
  option: string;
  description: string;
  name: string;
  hsn: string;
  unit: StockUnit;
  qty: number;
  rate: number;
  discountPct: number;
  gstRate: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  amount: number;
};

/** Money settling a return. out: paid to the customer. in: the difference they paid for a dearer replacement. */
export type RefundTransaction = {
  id: string;
  direction: 'out' | 'in';
  amount: number;
  method: RefundMethod;
  orderId?: string;
  orderNumber?: string;
  reference?: string;
  paidOn?: string;
  status: RefundStatus;
  note?: string;
  createdBy: string;
  createdAt: string;
  approvedBy?: string;
  approvedAt?: string;
  completedBy?: string;
  completedAt?: string;
};
export type RefundRow = RefundTransaction & { returnId: string; returnNumber: string; kind: ReturnKind; customerName: string };

export type SalesReturn = {
  id: string;
  number: string;
  kind: ReturnKind;
  orderId: string;
  orderNumber: string;
  /** The order's posted tax invoice, when there was one. */
  invoiceId?: string;
  invoiceNumber?: string;
  invoiceDate?: string;
  interstate?: boolean;
  /** The buyer as the original invoice has them. */
  customerGstin?: string;
  billingAddress?: string;
  placeOfSupply?: string;
  posCode?: string;
  customerId?: number;
  customerName: string;
  customerPhone?: string;
  returnDate: string;
  reason: ReturnReason;
  reasonNote?: string;
  status: ReturnStatus;
  /** Whole rupees, GST included. */
  returnValue: number;
  replacementValue: number;
  charges: number;
  chargesNote?: string;
  /** returnValue − charges − replacementValue: above 0 the shop owes the customer, below 0 the customer owes the shop. */
  settleAmount: number;
  /** late: after the return period. category: not a returnable category. */
  flags: ('late' | 'category')[];
  attachments: string[];
  notes?: string;
  /** Sent back with every action: an older one was decided on an out-of-date screen. */
  version: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  items: ReturnItem[];
  replacementItems?: ReplacementItem[];
  refunds?: RefundTransaction[];
  creditNote?: { id: string; number: string; date: string; status: 'posted' | 'cancelled'; taxable: number; cgst: number; sgst: number; igst: number; roundOff: number; total: number; cancelReason?: string };
  replacementInvoice?: { id: string; number?: string; status: SalesInvoice['status']; total: number };
};

export type ReturnEvent = {
  id: string;
  kind: 'created' | 'edited' | 'status' | 'received' | 'inspected' | 'replaced' | 'credit_note' | 'refund' | 'note' | 'attachment';
  from?: ReturnStatus;
  to?: ReturnStatus;
  note?: string;
  by: string;
  at: string;
};
export type ReturnStockMove = { id: string; productId: string; option: string; change: number; balance: number; bucket: StockBucket; kind: StockMove['kind']; by: string; at: string };

export type ReturnSettings = {
  eligibilityDays: number;
  requireApproval: boolean;
  allowReplacements: boolean;
  refundApproval: boolean;
  eligibleCategories: string[];
  restockRule: 'inspect' | 'unopened';
  damagedHandling: 'keep' | 'write_off';
  allowNegativeStock: boolean;
  replacementTax: 'invoice' | 'none';
  creditNoteOnReceipt: boolean;
  returnPrefix: string;
  creditNotePrefix: string;
  supplierReturnPrefix: string;
  refundMethods: RefundMethod[];
  terms: string;
  permissions: Record<ReturnAction, ('sales' | 'catalogue' | 'inventory')[]>;
  updatedBy?: string | null;
  updatedAt?: string | null;
};

/** A delivered order as a return starts from it (GET /returns/orders/:id). */
export type ReturnSource = {
  order: { id: string; number: string; status: OrderStatus; customer: string; phone?: string; customerId?: number; bill: number; deliveredAt?: string; lastDay: string | null };
  invoice: { id: string; number: string; date: string; interstate: boolean } | null;
  lines: {
    source: 'invoice' | 'order';
    position: number;
    productId: string;
    option: string;
    description: string;
    name: string;
    hsn: string;
    unit: StockUnit;
    qty: number;
    rate: number;
    gstRate: number;
    taxable: number;
    cgst: number;
    sgst: number;
    igst: number;
    returned: number;
    returnable: number;
    eligible: boolean;
  }[];
};
export type ReturnableOrder = { id: string; number: string; customer: string; phone?: string; placedAt: string; bill: number; invoiceNumber?: string | null; deliveredAt?: string | null };

/** A GST credit note against a posted tax invoice, for goods returned. */
export type CreditNote = {
  id: string;
  number: string;
  noteDate: string;
  status: 'posted' | 'cancelled';
  returnId: string;
  returnNumber: string;
  invoiceId: string;
  invoiceNumber: string;
  invoiceDate: string;
  orderId: string;
  customerName: string;
  customerGstin?: string;
  placeOfSupply: string;
  posCode: string;
  interstate: boolean;
  sellerGstin: string;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  roundOff: number;
  total: number;
  createdBy: string;
  createdAt: string;
  cancelledBy?: string;
  cancelledAt?: string;
  cancelReason?: string;
  items: { productId: string; option: string; description: string; hsn: string; qty: number; unit: StockUnit; rate: number; gstRate: number; taxable: number; cgst: number; sgst: number; igst: number }[];
};

export type SupplierReturnStatus = 'draft' | 'approved' | 'dispatched' | 'supplier_received' | 'credited' | 'settled' | 'closed' | 'cancelled';
export type SupplierReturnReason = 'wrong_product' | 'damaged' | 'defective' | 'wrong_size' | 'excess' | 'quality' | 'other';
export type SupplierReturnItem = {
  position: number;
  purchasePosition: number;
  productId: string;
  option: string;
  name: string;
  code: string;
  qty: number;
  unit: StockUnit;
  rate: number;
  gstRate: number;
  taxable: number;
  tax: number;
  bucket: 'available' | 'damaged' | 'defective';
};
export type SupplierReturn = {
  id: string;
  number: string;
  supplier: { id: number; name: string; gstin?: string };
  purchaseId: string;
  purchaseNumber: string;
  supplierInvoice?: string;
  billDate: string;
  returnDate: string;
  reason: SupplierReturnReason;
  reasonNote?: string;
  status: SupplierReturnStatus;
  challan?: string;
  transport?: string;
  interstate: boolean;
  taxable: number;
  tax: number;
  total: number;
  creditNoteNumber?: string;
  creditNoteDate?: string;
  creditNoteAmount?: number;
  creditNoteTax?: number;
  settlement?: 'adjust' | 'refund';
  refundAmount?: number;
  refundMethod?: 'cash' | 'upi' | 'bank' | 'cheque';
  refundReference?: string;
  refundedOn?: string;
  attachments: string[];
  notes?: string;
  version: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  items: SupplierReturnItem[];
  events?: { id: string; kind: string; from?: SupplierReturnStatus; to?: SupplierReturnStatus; note?: string; by: string; at: string }[];
};
export type SupplierReturnSource = {
  purchase: { id: string; number: string; status: PurchaseStatus; interstate: boolean };
  lines: { position: number; productId: string; option: string; name: string; code: string; qty: number; unit: StockUnit; rate: number; gstRate: number; returned: number; returnable: number }[];
};

/** The shop as a return receipt prints it (GET /returns/shop). */
export type ShopDetails = { legalName: string; tradeName: string; gstin: string; address: string; pincode: string; phone: string; email: string; jurisdiction: string };

// ---------- Custom billing ----------

/** A unit a bill line can be in: the stock units, PAIR and the shop's own. `print` is what bills print. */
export type MeasurementUnit = { code: string; label: string; print: string; builtIn: boolean };

export type BillPaymentMethod = 'cash' | 'upi' | 'bank' | 'cheque' | 'card';
/** Money received against a counter bill. Voided ones stay on record. */
export type BillPayment = {
  id: string;
  amount: number;
  method: BillPaymentMethod;
  paidOn: string;
  reference?: string;
  note?: string;
  by: string;
  at: string;
  voidedBy?: string;
  voidedAt?: string;
  voidReason?: string;
};
export type BillEvent = {
  id: string;
  kind: 'created' | 'edited' | 'finalized' | 'reopened' | 'payment' | 'payment_voided' | 'cancelled' | 'duplicated' | 'converted' | 'credit_note';
  note?: string;
  before?: { date: string; customer: string; total: number; discount: number; lines: { item: string; qty: number; unit: string; rate: number; gst: number }[] } | null;
  after?: BillEvent['before'];
  by: string;
  at: string;
};
export type BillDetail = {
  invoice: SalesInvoice;
  payments: BillPayment[];
  events: BillEvent[];
  moves: { id: string; productId: string; option: string; change: number; balance: number; kind: StockMove['kind']; by: string; at: string }[];
};

/** How bills look and behave (Invoice Settings), with the shop's details they print. */
export type BillingSettings = {
  legalName: string;
  tradeName: string;
  gstin: string;
  address: string;
  pincode: string;
  phone: string;
  email: string;
  registrationType: 'regular' | 'composition';
  invoicePrefix: string;
  bankName: string;
  bankAccount: string;
  bankBranchIfsc: string;
  terms: string;
  declaration: string;
  jurisdiction: string;
  heading: string;
  footer: string;
  logo: string | null;
  signature: string | null;
  themeColor: string;
  paperSize: 'A4' | 'A5' | 'thermal';
  template: 'classic' | 'modern' | 'compact';
  dueDays: number;
  pricesIncludeGst: boolean;
  allowNegativeStock: boolean;
  quotationDays: number;
  updatedBy?: string | null;
  updatedAt?: string | null;
};
export type BillingSetup = { settings: BillingSettings; units: MeasurementUnit[]; financialYear: string; lastInvoiceNumber: number };

/** A customer to bill, as the billing search finds them. */
export type BillCustomer = { id: number; name: string; legalName: string; gstin: string; billingAddress: string; state: string; pincode: string; phone: string };

export type QuotationStatus = 'draft' | 'sent' | 'accepted' | 'converted' | 'expired' | 'cancelled';
export type Quotation = {
  id: string;
  number: string;
  quoteDate: string;
  validUntil?: string;
  status: QuotationStatus;
  customerId?: number;
  customerName: string;
  customerPhone?: string;
  customerGstin?: string;
  billingAddress?: string;
  placeOfSupply: string;
  posCode: string;
  interstate: boolean;
  pricesIncludeGst: boolean;
  billDiscount: number;
  billDiscountPct?: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  roundOff: number;
  total: number;
  notes?: string;
  invoiceId?: string;
  invoiceNumber?: string;
  version: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  items: InvoiceItem[];
};

// ---------- Category-wise discounts ----------

export type DiscountRule = {
  id: number;
  scope: 'default' | 'category' | 'product';
  categoryId: string | null;
  productId: string | null;
  option: string;
  label: string;
  enabled: boolean;
  type: 'percentage' | 'amount' | 'both';
  minPct: number;
  maxPct: number;
  defaultPct: number;
  minAmount: number;
  maxAmount: number | null;
  defaultAmount: number;
  staffMaxPct: number | null;
  staffMaxAmount: number | null;
  requiresApproval: boolean;
  startsOn: string | null;
  endsOn: string | null;
  note: string;
  updatedBy: string | null;
  updatedAt: string;
};
export type DiscountLevel = 'owner' | 'admin' | 'manager' | 'staff';
export type DiscountSetup = { rules: DiscountRule[]; categories: { id: string; label: string }[]; productRules: boolean; me: { name: string; level: DiscountLevel; limitPct: number | null } };
export type DiscountApproval = {
  id: string;
  invoiceId: string;
  invoiceNumber?: string;
  invoiceStatus: SalesInvoice['status'];
  customerName: string;
  productId: string;
  option: string;
  description: string;
  categoryId?: string;
  categoryLabel?: string;
  discountPct: number;
  discountAmount: number;
  effectivePct: number;
  qty: number;
  rate: number;
  ruleMin: number;
  ruleMax: number;
  authority: number;
  status: 'pending' | 'approved' | 'rejected' | 'withdrawn';
  requestedBy: string;
  requestedAt: string;
  decidedBy?: string;
  decidedAt?: string;
  reason?: string;
};
export type DiscountReport = {
  from: string;
  to: string;
  lines: {
    day: string;
    invoiceId: string;
    number: string;
    customer: string;
    productId: string;
    option: string;
    description: string;
    detail: string;
    categoryId: string | null;
    categoryLabel: string;
    qty: number;
    base: number;
    discount: number;
    effectivePct: number;
    discountPct: number;
    discountAmount: number;
    billDiscount: number;
    source: DiscountRule['scope'] | null;
    ruleMin: number | null;
    ruleMax: number | null;
    by: string;
    status: 'ok' | 'pending' | 'approved' | 'rejected';
  }[];
  decisions: { id: string; number?: string; description: string; effectivePct: number; status: DiscountApproval['status']; requestedBy: string; requestedAt: string; decidedBy?: string; decidedAt?: string; reason?: string }[];
  changes: { id: string; kind: string; subject: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null; reason?: string; by: string; at: string }[];
};
