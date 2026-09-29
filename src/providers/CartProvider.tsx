import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { findShopProduct } from '@/data/shop';

/**
 * `optionIndex` picks one of the product's priced options; products without prices carry a free-text
 * `note` (size / finish / requirement) instead. Each distinct option or note is its own line.
 */
export type CartLine = { productId: string; optionIndex?: number; note?: string; qty: number };

type LineKey = Pick<CartLine, 'productId' | 'optionIndex' | 'note'>;

type Cart = {
  lines: CartLine[];
  /** Total units across all lines, shown on the header badge. */
  count: number;
  add: (line: LineKey, qty?: number) => void;
  setQty: (line: LineKey, qty: number) => void;
  replace: (lines: CartLine[]) => void;
  clear: () => void;
};

const STORAGE_KEY = 'vimalnath:cart:v2';
const CartContext = createContext<Cart | null>(null);

const sameLine = (a: LineKey, b: LineKey) => a.productId === b.productId && a.optionIndex === b.optionIndex && (a.note ?? '') === (b.note ?? '');

export function unitPrice(line: Pick<CartLine, 'productId' | 'optionIndex'>): number | undefined {
  if (line.optionIndex === undefined) return undefined;
  return findShopProduct(line.productId)?.options?.[line.optionIndex]?.mrp;
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const restored = useRef(false);
  // Set by any change made in this session, so a slow restore never overwrites it
  // (e.g. a cart emptied by placing an order coming back with the old items).
  const changed = useRef(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (!raw || changed.current) return;
        const saved = JSON.parse(raw) as CartLine[];
        // Drop lines for products that are no longer in the shop.
        setLines(saved.filter((line) => findShopProduct(line.productId) && line.qty > 0));
      })
      .catch(() => {})
      .finally(() => {
        restored.current = true;
      });
  }, []);

  useEffect(() => {
    if (!restored.current && !changed.current) return;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(lines)).catch(() => {});
  }, [lines]);

  const add = useCallback((key: LineKey, qty = 1) => {
    changed.current = true;
    const note = key.note?.trim() || undefined;
    const line = { ...key, note };
    setLines((current) =>
      current.some((existing) => sameLine(existing, line))
        ? current.map((existing) => (sameLine(existing, line) ? { ...existing, qty: existing.qty + qty } : existing))
        : [...current, { ...line, qty }],
    );
  }, []);

  const setQty = useCallback((key: LineKey, qty: number) => {
    changed.current = true;
    setLines((current) =>
      qty <= 0 ? current.filter((line) => !sameLine(line, key)) : current.map((line) => (sameLine(line, key) ? { ...line, qty } : line)),
    );
  }, []);

  const replace = useCallback((next: CartLine[]) => {
    changed.current = true;
    setLines(next);
  }, []);
  const clear = useCallback(() => {
    changed.current = true;
    setLines([]);
  }, []);

  const value = useMemo(
    () => ({ lines, count: lines.reduce((sum, line) => sum + line.qty, 0), add, setQty, replace, clear }),
    [lines, add, setQty, replace, clear],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const context = useContext(CartContext);
  if (!context) throw new Error('useCart must be used inside CartProvider');
  return context;
}
