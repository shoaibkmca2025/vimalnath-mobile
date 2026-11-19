import type { Product } from './types';

/** The app shows the section title when the catalogue only printed a code. */
export const productTitle = (product: Product) => product.name || product.section;

export const lowestPrice = (product: Product) => (product.options.length ? Math.min(...product.options.map((option) => option.mrp)) : undefined);

/** "TFS-8400 Floor Spring" → ["tfs", "8400", "floor", "spring"]. */
const wordsOf = (text: string) => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

/** Letters to change, add or drop to turn one word into the other (swapping two neighbours counts as one). Stops once past `limit`. */
function editsBetween(a: string, b: string, limit: number) {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let twoBack: number[] = [];
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      let edits = Math.min(previous[j]! + 1, row[j - 1]! + 1, previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) edits = Math.min(edits, twoBack[j - 2]! + 1);
      row.push(edits);
    }
    if (Math.min(...row) > limit) return limit + 1;
    twoBack = previous;
    previous = row;
  }
  return previous[b.length]!;
}

/**
 * A typing slip in one word: a letter wrong, missing, extra or swapped (two in a long word). Checked against the start
 * of the word too, so a half-typed word still counts ("sprng" → "springs"). Short words and numbers have to be exact.
 */
function isSlipOf(typed: string, word: string) {
  if (/^\d+$/.test(typed)) return false;
  const limit = typed.length >= 8 ? 2 : typed.length >= 4 ? 1 : 0;
  if (!limit) return false;
  for (let length = Math.max(1, typed.length - limit); length <= Math.min(word.length, typed.length + limit); length++) {
    if (editsBetween(typed, word.slice(0, length), limit) <= limit) return true;
  }
  return false;
}

export type ProductSearch = {
  products: Product[];
  /** Nothing matched as typed, so these are the close matches (spelling slips allowed). */
  close: boolean;
};

/**
 * Products with every word typed, in any order ("spring floor", "TFS 8400" and "tfs8400" all work). Best first: the
 * exact code, codes starting with what was typed, the words side by side, then the rest in catalogue order. When nothing
 * matches as typed, the close matches instead, allowing a slip in each word ("florr spring" finds the floor springs).
 */
export function searchProducts(products: Product[], query: string): ProductSearch {
  const typed = wordsOf(query);
  if (!typed.length) return { products: [], close: false };
  const together = typed.join('');

  const indexed = products.map((product) => {
    const text = [product.code, product.name, product.section, ...product.options.map((option) => option.code ?? '')].join(' ');
    return { product, code: wordsOf(product.code).join(''), words: wordsOf(text), compact: wordsOf(text).join('') };
  });

  const rank = ({ code, compact }: (typeof indexed)[number]) => (code === together ? 0 : code.startsWith(together) ? 1 : compact.includes(together) ? 2 : 3);
  const exact = indexed
    .filter((entry) => typed.every((word) => entry.compact.includes(word)))
    .map((entry, order) => ({ entry, order, rank: rank(entry) }))
    .sort((a, b) => a.rank - b.rank || a.order - b.order)
    .map(({ entry }) => entry.product);
  if (exact.length) return { products: exact, close: false };

  const close = indexed.filter((entry) => typed.every((word) => entry.compact.includes(word) || entry.words.some((candidate) => isSlipOf(word, candidate))));
  return { products: close.map((entry) => entry.product), close: close.length > 0 };
}
