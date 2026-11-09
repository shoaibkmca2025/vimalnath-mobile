import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { findShopProduct, productTitle } from '@/data/shop';
import { unitPrice, type CartLine } from '@/providers/CartProvider';

/** A snapshot of the product at order time, so later catalogue updates don't rewrite past orders. */
export type OrderLine = {
  productId: string;
  code: string;
  name: string;
  option?: string;
  optionCode?: string;
  optionIndex?: number;
  note?: string;
  qty: number;
  /** MRP per unit; undefined when the product is priced from the catalogue page. */
  mrp?: number;
};

export type Order = {
  id: string;
  number: string;
  createdAt: string;
  customer: string;
  phone?: string;
  notes?: string;
  status: 'Placed';
  lines: OrderLine[];
  /** Sum of the priced lines only. */
  total: number;
};

export type OrderDetails = { customer: string; phone?: string; notes?: string };

type Orders = {
  orders: Order[];
  placeOrder: (lines: CartLine[], details: OrderDetails) => Order;
  removeOrder: (id: string) => void;
  clearOrders: () => void;
};

const STORAGE_KEY = 'vimalnath:orders';
/** The last number given out, kept apart from the list so a deleted order's number is never reused. */
const LAST_NUMBER_KEY = 'vimalnath:orders:last-number';
const OrdersContext = createContext<Orders | null>(null);

const numberOf = (order: Order) => Number(order.number.replace(/\D/g, '')) || 0;

export function orderLineTotal(line: Pick<OrderLine, 'qty' | 'mrp'>): number | undefined {
  return line.mrp === undefined ? undefined : line.mrp * line.qty;
}

export function OrdersProvider({ children }: { children: ReactNode }) {
  const [orders, setOrders] = useState<Order[]>([]);
  const restored = useRef(false);
  const lastNumber = useRef(0);

  useEffect(() => {
    AsyncStorage.multiGet([STORAGE_KEY, LAST_NUMBER_KEY])
      .then(async ([[, raw], [, last]]) => {
        let saved: Order[] = [];
        try {
          if (raw) saved = JSON.parse(raw) as Order[];
        } catch {
          // Unreadable, but maybe recoverable by hand: keep a copy before the list below replaces it.
          await AsyncStorage.setItem(`${STORAGE_KEY}:damaged`, raw!);
        }
        lastNumber.current = Math.max(lastNumber.current, Number(last) || 0, ...saved.map(numberOf));
        // Keep any order placed before the saved list finished loading. This also saves the merged list.
        setOrders((current) => [...current, ...saved.filter((order) => !current.some((placed) => placed.id === order.id))]);
        restored.current = true;
      })
      // A failed read leaves `restored` false, so nothing saves over the orders still on the phone.
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!restored.current) return;
    AsyncStorage.multiSet([
      [STORAGE_KEY, JSON.stringify(orders)],
      [LAST_NUMBER_KEY, String(lastNumber.current)],
    ]).catch(() => {});
  }, [orders]);

  const placeOrder = useCallback(
    (cartLines: CartLine[], details: OrderDetails): Order => {
      const lines: OrderLine[] = cartLines.flatMap((line) => {
        const product = findShopProduct(line.productId);
        if (!product) return [];
        const option = line.optionIndex === undefined ? undefined : product.options?.[line.optionIndex];
        return [
          {
            productId: product.id,
            code: product.code,
            name: productTitle(product),
            option: option?.label,
            optionCode: option?.code,
            optionIndex: line.optionIndex,
            note: line.note,
            qty: line.qty,
            mrp: unitPrice(line),
          },
        ];
      });
      const now = new Date();
      // Sequential per device: VSC-0001, VSC-0002, … and never reused, even after an order is deleted.
      const next = ++lastNumber.current;
      const order: Order = {
        id: `${now.getTime()}`,
        number: `VSC-${String(next).padStart(4, '0')}`,
        createdAt: now.toISOString(),
        customer: details.customer,
        phone: details.phone || undefined,
        notes: details.notes || undefined,
        status: 'Placed',
        lines,
        total: lines.reduce((sum, line) => sum + (orderLineTotal(line) ?? 0), 0),
      };
      setOrders((current) => [order, ...current]);
      return order;
    },
    [],
  );

  const removeOrder = useCallback((id: string) => setOrders((current) => current.filter((order) => order.id !== id)), []);
  const clearOrders = useCallback(() => setOrders([]), []);

  const value = useMemo(() => ({ orders, placeOrder, removeOrder, clearOrders }), [orders, placeOrder, removeOrder, clearOrders]);
  return <OrdersContext.Provider value={value}>{children}</OrdersContext.Provider>;
}

export function useOrders() {
  const context = useContext(OrdersContext);
  if (!context) throw new Error('useOrders must be used inside OrdersProvider');
  return context;
}
