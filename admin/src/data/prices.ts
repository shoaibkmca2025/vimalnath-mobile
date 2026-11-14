import type { CatalogSource, Product } from './types';

/** One orderable option and its MRP, as a row on the Prices page. */
export type PriceRow = { key: string; productId: string; code: string; name: string; category: string; source: CatalogSource; option: string; optionCode?: string; mrp: number };

/** Option names are unique within a product, so product + option name finds one price. */
export const priceKey = (productId: string, option: string) => `${productId}\u0000${option}`;

export function priceRows(products: Product[]): PriceRow[] {
  return products.flatMap((product) =>
    product.options.map((option) => ({
      key: priceKey(product.id, option.label),
      productId: product.id,
      code: product.code,
      name: product.name || product.section,
      category: product.category,
      source: product.catalogPage.source,
      option: option.label,
      optionCode: option.code,
      mrp: option.mrp,
    })),
  );
}

export type BulkChange = { direction: 'up' | 'down'; by: 'percent' | 'rupees'; amount: number; roundTo: 1 | 10 | 50 | 100 };

/** The new MRP in whole rupees, or null when the change would take it to ₹0 or below. */
export function bulkPrice(mrp: number, change: BulkChange): number | null {
  const sign = change.direction === 'up' ? 1 : -1;
  const raw = change.by === 'percent' ? mrp * (1 + (sign * change.amount) / 100) : mrp + sign * change.amount;
  const rounded = Math.round(raw / change.roundTo) * change.roundTo;
  return rounded > 0 ? rounded : null;
}

/** The products with new MRPs applied. Only products with a changed price become new objects, so only they are saved. */
export function withPrices(products: Product[], prices: Map<string, number>): Product[] {
  return products.map((product) => {
    if (!product.options.some((option) => prices.get(priceKey(product.id, option.label)) !== undefined)) return product;
    return { ...product, options: product.options.map((option) => ({ ...option, mrp: prices.get(priceKey(product.id, option.label)) ?? option.mrp })) };
  });
}
