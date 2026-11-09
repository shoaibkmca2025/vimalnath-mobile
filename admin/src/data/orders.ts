import type { Order, OrderStatus } from './types';

export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

/** Labels and tones for each status. New orders are amber because they're waiting on someone. */
export const ORDER_STATUS: Record<OrderStatus, { label: string; tone: Tone; description: string }> = {
  placed: { label: 'New', tone: 'warning', description: 'Waiting to be confirmed' },
  confirmed: { label: 'Confirmed', tone: 'info', description: 'Accepted and being prepared' },
  dispatched: { label: 'Dispatched', tone: 'info', description: 'On the way to the customer' },
  delivered: { label: 'Delivered', tone: 'success', description: 'Received by the customer' },
  cancelled: { label: 'Cancelled', tone: 'neutral', description: 'Won’t be fulfilled' },
};

export const STATUS_ORDER: OrderStatus[] = ['placed', 'confirmed', 'dispatched', 'delivered', 'cancelled'];

/** The step that usually comes next, offered as the primary action on an order. */
export function nextStatus(status: OrderStatus): OrderStatus | null {
  const flow: OrderStatus[] = ['placed', 'confirmed', 'dispatched', 'delivered'];
  const index = flow.indexOf(status);
  return index >= 0 && index < flow.length - 1 ? flow[index + 1]! : null;
}

export const NEXT_ACTION_LABEL: Partial<Record<OrderStatus, string>> = {
  confirmed: 'Confirm Order',
  dispatched: 'Mark as Dispatched',
  delivered: 'Mark as Delivered',
};

export type Customer = {
  /** URL-safe id made from the name, e.g. crystal-interiors. */
  key: string;
  name: string;
  /** The latest phone number they gave, if any. */
  phone?: string;
  orders: number;
  /** MRP of priced lines, cancelled orders left out. */
  spent: number;
  firstOrder: string;
  lastOrder: string;
  open: number;
};

export const customerKey = (name: string) =>
  name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '');

export const isOpen = (status: OrderStatus) => status === 'placed' || status === 'confirmed' || status === 'dispatched';

export const itemCount = (order: Order) => order.lines.reduce((sum, line) => sum + line.qty, 0);

/** Customers aren't stored separately yet: the app only asks for a customer or site name, so orders are grouped by it. */
export function customersFromOrders(orders: Order[]): Customer[] {
  const byKey = new Map<string, Customer>();
  for (const order of orders) {
    const key = customerKey(order.customer);
    const current = byKey.get(key) ?? { key, name: order.customer, orders: 0, spent: 0, firstOrder: order.createdAt, lastOrder: order.createdAt, open: 0 };
    current.orders += 1;
    if (order.status !== 'cancelled') current.spent += order.total;
    if (isOpen(order.status)) current.open += 1;
    if (order.createdAt < current.firstOrder) current.firstOrder = order.createdAt;
    if (order.createdAt >= current.lastOrder) {
      current.lastOrder = order.createdAt;
      if (order.phone) current.phone = order.phone;
    } else if (!current.phone && order.phone) current.phone = order.phone;
    byKey.set(key, current);
  }
  return [...byKey.values()].sort((a, b) => b.spent - a.spent);
}

/** wa.me wants the number with its country code and nothing else. */
export function whatsappLink(phone: string) {
  const digits = phone.replace(/\D/g, '');
  return `https://wa.me/${digits.length === 10 ? `91${digits}` : digits}`;
}
