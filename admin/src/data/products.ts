import type { Product } from './types';

/** The app shows the section title when the catalogue only printed a code. */
export const productTitle = (product: Product) => product.name || product.section;

export const lowestPrice = (product: Product) => (product.options.length ? Math.min(...product.options.map((option) => option.mrp)) : undefined);
