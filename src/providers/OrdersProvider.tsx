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
};

const STORAGE_KEY = 'vimalnath:orders';
const OrdersContext = createContext<Orders | null>(null);

export function orderLineTotal(line: Pick<OrderLine, 'qty' | 'mrp'>): number | undefined {
  return line.mrp === undefined ? undefined : line.mrp * line.qty;
}

export function OrdersProvider({ children }: { children: ReactNode }) {
  const [orders, setOrders] = useState<Order[]>([]);
  const restored = useRef(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (!raw) return;
        const saved = JSON.parse(raw) as Order[];
        // Keep any order placed before the saved list finished loading.
        setOrders((current) => [...current, ...saved.filter((order) => !current.some((placed) => placed.id === order.id))]);
      })
      .catch(() => {})
      .finally(() => {
        restored.current = true;
        setOrders((current) => [...current]); // save the merged list
      });
  }, []);

  useEffect(() => {
    if (!restored.current) return;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(orders)).catch(() => {});
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
      // Sequential per device: VSC-0001, VSC-0002, …
      const next = orders.reduce((max, order) => Math.max(max, Number(order.number.replace(/\D/g, '')) || 0), 0) + 1;
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
    [orders],
  );

  const removeOrder = useCallback((id: string) => setOrders((current) => current.filter((order) => order.id !== id)), []);

  const value = useMemo(() => ({ orders, placeOrder, removeOrder }), [orders, placeOrder, removeOrder]);
  return <OrdersContext.Provider value={value}>{children}</OrdersContext.Provider>;
}

export function useOrders() {
  const context = useContext(OrdersContext);
  if (!context) throw new Error('useOrders must be used inside OrdersProvider');
  return context;
}
