import type { Role } from './session';
import type { Order, Product, StockItem, StockMove, StockUnit } from './types';

/**
 * Stock, stage 1 of inventory. Each product option is an item the shop counts (a product without options is one item,
 * under option ''). An item is tracked once it has stock details; delivered orders then take from it.
 */

export const seesStock = (role: Role | undefined) => role === 'owner' || role === 'inventory' || role === 'sales';
export const editsStock = (role: Role | undefined) => role === 'owner' || role === 'inventory';

export const UNITS: Record<StockUnit, string> = { pcs: 'PCS', box: 'BOX', kg: 'KG', meter: 'METER', feet: 'FEET', set: 'SET' };
export const GST_RATES = [0, 0.25, 3, 5, 12, 18, 28, 40] as const;
export const ADJUST_REASONS = { damaged: 'Damaged', lost: 'Lost or stolen', returned: 'Returned by a customer', used: 'Used in the shop', found: 'Found', correction: 'Correction', other: 'Other' } as const;
export type AdjustReason = keyof typeof ADJUST_REASONS;

export const MOVE_LABEL: Record<StockMove['kind'], string> = { opening: 'Opening stock', count: 'Counted', adjust: 'Adjusted', delivered: 'Delivered', undelivered: 'Delivery undone' };

export const itemKey = (productId: string, option: string) => `${productId}\u0000${option}`;

/** What the server answers a stock or order change with: the items and orders as they are now. */
export type Answer = { orders?: Order[]; stock?: StockItem[]; removedStock?: { productId: string; option: string }[] };

/** The stock list with the server's answer applied: changed items replaced, new ones added, removed ones gone. */
export function mergeStock(stock: StockItem[], answer: Answer | undefined): StockItem[] {
  if (!answer?.stock?.length && !answer?.removedStock?.length) return stock;
  const fresh = new Map(answer.stock?.map((item) => [itemKey(item.productId, item.option), item]));
  const removed = new Set(answer.removedStock?.map((item) => itemKey(item.productId, item.option)));
  const kept = stock.filter((item) => !removed.has(itemKey(item.productId, item.option))).map((item) => {
    const key = itemKey(item.productId, item.option);
    const replaced = fresh.get(key);
    fresh.delete(key);
    return replaced ?? item;
  });
  return [...kept, ...fresh.values()];
}

export type StockState = 'out' | 'low' | 'over' | 'ok' | 'untracked';

/** Out at 0 or below; low at or under the minimum; over above the maximum. */
export function stockState(item: StockItem | undefined): StockState {
  if (!item) return 'untracked';
  if (item.quantity <= 0) return 'out';
  if (item.minStock !== null && item.quantity <= item.minStock) return 'low';
  if (item.maxStock !== null && item.quantity > item.maxStock) return 'over';
  return 'ok';
}

export const STATE_LABEL: Record<StockState, { label: string; tone: 'danger' | 'warning' | 'info' | 'success' | 'neutral' }> = {
  out: { label: 'Out of stock', tone: 'danger' },
  low: { label: 'Low stock', tone: 'warning' },
  over: { label: 'Over max', tone: 'info' },
  ok: { label: 'In stock', tone: 'success' },
  untracked: { label: 'Not set up', tone: 'neutral' },
};

/** One row of the stock list: a catalogue item and its stock, or stock whose option no longer exists. */
export type StockRow = {
  key: string;
  productId: string;
  option: string;
  product?: Product;
  /** "H Type Handle · SSS". */
  title: string;
  code: string;
  mrp?: number;
  stock?: StockItem;
  state: StockState;
};

const productName = (product: Product) => product.name || product.section;

/** Every item in the catalogue, in its order, then stock left behind by renamed options. */
export function stockRows(products: Product[], stock: StockItem[]): StockRow[] {
  const byKey = new Map(stock.map((item) => [itemKey(item.productId, item.option), item]));
  const rows: StockRow[] = [];
  const shown = new Set<string>();
  for (const product of products) {
    const options = product.options.length ? product.options : [undefined];
    for (const option of options) {
      const key = itemKey(product.id, option?.label ?? '');
      const item = byKey.get(key);
      shown.add(key);
      rows.push({
        key,
        productId: product.id,
        option: option?.label ?? '',
        product,
        title: option ? `${productName(product)} · ${option.label}` : productName(product),
        code: option?.code ?? product.code,
        mrp: option?.mrp,
        stock: item,
        state: stockState(item),
      });
    }
  }
  const names = new Map(products.map((product) => [product.id, product]));
  for (const item of stock) {
    const key = itemKey(item.productId, item.option);
    if (shown.has(key)) continue;
    const product = names.get(item.productId);
    rows.push({ key, productId: item.productId, option: item.option, product, title: `${product ? productName(product) : item.productId}${item.option ? ` · ${item.option}` : ''}`, code: product?.code ?? '', stock: item, state: stockState(item) });
  }
  return rows;
}

/** What tracked stock cost, at purchase price. Items below zero count as none; items without a price aren't counted. */
export function stockValue(stock: StockItem[]) {
  let value = 0;
  let priced = 0;
  for (const item of stock) {
    if (item.purchasePrice === null) continue;
    priced += 1;
    value += Math.max(0, item.quantity) * item.purchasePrice;
  }
  return { value: Math.round(value), priced };
}

/** Counts for the badges and the dashboard. */
export function stockAlerts(stock: StockItem[]) {
  const states = stock.map(stockState);
  return { out: states.filter((state) => state === 'out').length, low: states.filter((state) => state === 'low').length, over: states.filter((state) => state === 'over').length };
}

/** "12", "2.5", "−3": quantities as people write them, without trailing zeros. */
export const formatQty = (value: number) => `${value < 0 ? '−' : ''}${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 }).format(Math.abs(value))}`;

/** ₹1,350 or ₹812.50: paise only when there are some. */
export const formatPrice = (value: number) =>
  `₹${new Intl.NumberFormat('en-IN', { minimumFractionDigits: Number.isInteger(value) ? 0 : 2, maximumFractionDigits: 2 }).format(value)}`;

// ---- CSV import: the export's own columns, read back.

export const CSV_HEADER = [
  'Product ID',
  'Option',
  'Product',
  'Code',
  'SKU',
  'Barcode',
  'Unit',
  'Brand',
  'Manufacturer',
  'HSN',
  'GST %',
  'Purchase price',
  'Selling price',
  'Wholesale price',
  'In stock',
  'Min stock',
  'Max stock',
  'Rack',
  'Warehouse',
] as const;

/**
 * A CSV file's text. Excel's plain "CSV" save writes Windows-1252, not UTF-8, which would garble · and × in option
 * names; when the bytes aren't valid UTF-8 they are read that way instead.
 */
export function decodeCsv(bytes: ArrayBuffer) {
  const utf8 = new TextDecoder('utf-8').decode(bytes);
  return utf8.includes('�') ? new TextDecoder('windows-1252').decode(bytes) : utf8;
}

/** Splits CSV text into rows of cells: quoted cells, doubled quotes, commas and line breaks inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const body = text.replace(/^﻿/, '');
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index]!;
    if (quoted) {
      if (char === '"' && body[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && body[index + 1] === '\n') index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += char;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((value) => value.trim()));
}

/** What a stock save sends for one item. `quantity` only when it should change. */
export type ItemSave = Omit<StockItem, 'updatedAt' | 'orphan' | 'quantity' | 'purchasePrice'> & { purchasePrice?: number | null; quantity?: number };

/** A cell back to what the export wrote: Excel's text guard (a leading ') and spaces removed. */
const clean = (value: string | undefined) => (value ?? '').trim().replace(/^'(?=[=+\-@])/, '');

function number(value: string, label: string, { decimals, allowEmpty = true }: { decimals: number; allowEmpty?: boolean }): { value: number | null; error?: string } {
  const text = value.replace(/[₹,\s]/g, '');
  if (!text) return allowEmpty ? { value: null } : { value: null, error: `${label} is empty` };
  if (!/^\d+(\.\d+)?$/.test(text)) return { value: null, error: `${label} “${value}” isn’t a number` };
  const parsed = Number(text);
  if (Math.abs(parsed * 10 ** decimals - Math.round(parsed * 10 ** decimals)) > 1e-6) return { value: null, error: `${label} has more than ${decimals} decimal places` };
  return { value: parsed };
}

export type ImportPlan = { saves: ItemSave[]; added: number; changed: number; unchanged: number; errors: string[] };

/**
 * Reads an edited export: each row is matched to its item by Product ID and Option, checked like the drawer checks it,
 * and compared with what's saved. Rows with no change are left out; a different "In stock" becomes a count.
 */
export function planImport(text: string, rows: StockRow[], owner: boolean): ImportPlan {
  const [header, ...lines] = parseCsv(text);
  const plan: ImportPlan = { saves: [], added: 0, changed: 0, unchanged: 0, errors: [] };
  if (!header) return { ...plan, errors: ['The file is empty.'] };
  const column = new Map(header.map((name, index) => [name.trim().toLowerCase(), index]));
  const missing = ['Product ID', 'Option', 'In stock'].filter((name) => !column.has(name.toLowerCase()));
  if (missing.length) return { ...plan, errors: [`The file needs the ${missing.join(', ')} column${missing.length === 1 ? '' : 's'}. Start from Export CSV.`] };
  const byKey = new Map(rows.map((row) => [row.key, row]));
  const seen = new Set<string>();
  const units = new Map(Object.entries(UNITS).map(([unit, label]) => [label.toLowerCase(), unit as StockUnit]));
  const has = (name: string) => column.has(name.toLowerCase());

  lines.forEach((cells, index) => {
    const line = index + 2;
    const cell = (name: (typeof CSV_HEADER)[number]) => clean(cells[column.get(name.toLowerCase()) ?? -1]);
    const key = itemKey(cell('Product ID'), cell('Option'));
    const row = byKey.get(key);
    if (!row) return void plan.errors.push(`Row ${line}: no item with Product ID “${cell('Product ID')}” and option “${cell('Option')}”.`);
    if (seen.has(key)) return void plan.errors.push(`Row ${line}: ${row.title} is in the file twice.`);
    seen.add(key);
    const current = row.stock;
    const problems: string[] = [];
    const read = (name: (typeof CSV_HEADER)[number], decimals: number, fallback: number | null) => {
      if (!has(name)) return fallback;
      const result = number(cell(name), name, { decimals });
      if (result.error) problems.push(result.error);
      return result.value;
    };
    const text = (name: (typeof CSV_HEADER)[number], fallback: string, max: number) => {
      if (!has(name)) return fallback;
      const value = cell(name);
      if (value.length > max) problems.push(`${name} is longer than ${max} characters`);
      return value;
    };
    const unitText = has('Unit') ? cell('Unit').toLowerCase() : '';
    const unit = unitText ? units.get(unitText) : (current?.unit ?? 'pcs');
    if (!unit) problems.push(`Unit “${cell('Unit')}” isn’t one of ${Object.values(UNITS).join(', ')}`);
    const gstRate = read('GST %', 2, current?.gstRate ?? null);
    if (gstRate !== null && !(GST_RATES as readonly number[]).includes(gstRate)) problems.push(`GST % ${gstRate} isn’t a GST rate`);
    const hsn = text('HSN', current?.hsn ?? '', 8);
    if (hsn && !/^(\d{4}|\d{6}|\d{8})$/.test(hsn)) problems.push(`HSN “${hsn}” isn’t 4, 6 or 8 digits`);
    // Below zero only as exported (more delivered than counted); a new count is 0 or more.
    const quantityText = cell('In stock').replace(/^−/, '-');
    const negative = quantityText.startsWith('-');
    const parsed = quantityText ? number(negative ? quantityText.slice(1) : quantityText, 'In stock', { decimals: 3 }) : { value: null };
    const quantity = { ...parsed, value: parsed.value !== null && negative ? -parsed.value : parsed.value };
    if (quantity.error) problems.push(quantity.error);
    else if (quantity.value !== null && quantity.value < 0 && quantity.value !== current?.quantity) problems.push('In stock can’t be below 0');
    const minStock = read('Min stock', 3, current?.minStock ?? null);
    const maxStock = read('Max stock', 3, current?.maxStock ?? null);
    if (minStock !== null && maxStock !== null && maxStock < minStock) problems.push('Max stock is below Min stock');
    const save: ItemSave = {
      productId: row.productId,
      option: row.option,
      sku: text('SKU', current?.sku ?? '', 60),
      barcode: text('Barcode', current?.barcode ?? '', 60),
      unit: unit ?? 'pcs',
      brand: text('Brand', current?.brand ?? '', 100),
      manufacturer: text('Manufacturer', current?.manufacturer ?? '', 100),
      hsn,
      gstRate,
      ...(owner && has('Purchase price') ? { purchasePrice: read('Purchase price', 2, null) } : {}),
      sellingPrice: read('Selling price', 2, current?.sellingPrice ?? null),
      wholesalePrice: read('Wholesale price', 2, current?.wholesalePrice ?? null),
      minStock,
      maxStock,
      rack: text('Rack', current?.rack ?? '', 40),
      location: text('Warehouse', current?.location ?? '', 100),
    };
    if (problems.length) return void plan.errors.push(`Row ${line} (${row.title}): ${problems.join('; ')}.`);
    // An empty "In stock" on an item that isn't set up yet leaves it untouched: the export lists every catalogue item.
    if (!current && quantity.value === null) return;
    if (quantity.value !== null && (!current || quantity.value !== current.quantity)) save.quantity = quantity.value;
    const same =
      current &&
      save.quantity === undefined &&
      (Object.keys(save) as (keyof ItemSave)[]).every((field) => field === 'quantity' || JSON.stringify(save[field]) === JSON.stringify(current[field as keyof StockItem]));
    if (same) {
      plan.unchanged += 1;
      return;
    }
    if (current) plan.changed += 1;
    else plan.added += 1;
    plan.saves.push(save);
  });
  return plan;
}

/** The export: one row per catalogue item, tracked or not, in the columns the import reads back. */
export function exportRows(rows: StockRow[], owner: boolean) {
  const header = owner ? [...CSV_HEADER] : CSV_HEADER.filter((name) => name !== 'Purchase price');
  return {
    header,
    rows: rows.map((row) => {
      const item = row.stock;
      const cells: Record<(typeof CSV_HEADER)[number], string | number | null | undefined> = {
        'Product ID': row.productId,
        Option: row.option,
        Product: row.title,
        Code: row.code,
        SKU: item?.sku,
        Barcode: item?.barcode,
        Unit: item ? UNITS[item.unit] : '',
        Brand: item?.brand,
        Manufacturer: item?.manufacturer,
        HSN: item?.hsn,
        'GST %': item?.gstRate,
        'Purchase price': item?.purchasePrice,
        'Selling price': item?.sellingPrice,
        'Wholesale price': item?.wholesalePrice,
        'In stock': item?.quantity,
        'Min stock': item?.minStock,
        'Max stock': item?.maxStock,
        Rack: item?.rack,
        Warehouse: item?.location,
      };
      return header.map((name) => cells[name]);
    }),
  };
}
