import { customerKey, itemCount } from './orders';
import type { Category, Order, Product } from './types';

export const DAY = 86_400_000;

export type Totals = { value: number; orders: number; items: number; average: number };
export type DayPoint = { date: Date; value: number; orders: number };
/** `unpriced` counts units priced from the catalogue page, which add nothing to `value`. */
export type Ranked = { id: string; label: string; sub?: string; value: number; qty: number; unpriced: number; orders: number };

const startOfDay = (time: number) => {
  const date = new Date(time);
  date.setHours(0, 0, 0, 0);
  return date;
};

/** Orders placed within [from, to), cancelled ones left out, as every money figure in the admin does. */
export const ordersBetween = (orders: Order[], from: number, to: number) =>
  orders.filter((order) => {
    const time = new Date(order.createdAt).getTime();
    return order.status !== 'cancelled' && time >= from && time < to;
  });

export function totals(orders: Order[]): Totals {
  const value = orders.reduce((sum, order) => sum + order.total, 0);
  return { value, orders: orders.length, items: orders.reduce((sum, order) => sum + itemCount(order), 0), average: orders.length ? value / orders.length : 0 };
}

/** Percentage change, or null when there's nothing to compare with. */
export const change = (current: number, previous: number) => (previous > 0 ? ((current - previous) / previous) * 100 : null);

/** One point per calendar day, oldest first, ending today. */
export function dailySeries(orders: Order[], days: number, now: number): DayPoint[] {
  const today = startOfDay(now);
  const points = Array.from({ length: days }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() - (days - 1 - index));
    return { date, value: 0, orders: 0 };
  });
  const first = points[0]!.date.getTime();
  for (const order of orders) {
    if (order.status === 'cancelled') continue;
    const day = startOfDay(new Date(order.createdAt).getTime());
    const index = Math.round((day.getTime() - first) / DAY);
    const point = points[index];
    if (point) {
      point.value += order.total;
      point.orders += 1;
    }
  }
  return points;
}

/** Folds daily points into `buckets` equal groups, for sparklines. */
export function bucket(points: DayPoint[], buckets: number, pick: (point: DayPoint) => number) {
  const size = Math.max(1, Math.ceil(points.length / buckets));
  const values: number[] = [];
  for (let start = 0; start < points.length; start += size) values.push(points.slice(start, start + size).reduce((sum, point) => sum + pick(point), 0));
  return values;
}

export function salesByCategory(orders: Order[], products: Product[], categories: Category[]): Ranked[] {
  const categoryOf = new Map(products.map((product) => [product.id, product.category]));
  const labels = new Map(categories.map((category) => [category.id, category.label]));
  const rows = new Map<string, Ranked>();
  for (const order of orders) {
    const seen = new Set<string>();
    for (const line of order.lines) {
      const id = categoryOf.get(line.productId) ?? 'other';
      const row = rows.get(id) ?? { id, label: labels.get(id) ?? 'Other', value: 0, qty: 0, unpriced: 0, orders: 0 };
      row.value += (line.mrp ?? 0) * line.qty;
      row.qty += line.qty;
      if (line.mrp === undefined) row.unpriced += line.qty;
      if (!seen.has(id)) row.orders += 1;
      seen.add(id);
      rows.set(id, row);
    }
  }
  return [...rows.values()].sort((a, b) => b.value - a.value);
}

export function topProducts(orders: Order[]): Ranked[] {
  const rows = new Map<string, Ranked>();
  for (const order of orders) {
    for (const line of order.lines) {
      const row = rows.get(line.productId) ?? { id: line.productId, label: line.name, sub: line.code, value: 0, qty: 0, unpriced: 0, orders: 0 };
      row.value += (line.mrp ?? 0) * line.qty;
      row.qty += line.qty;
      if (line.mrp === undefined) row.unpriced += line.qty;
      row.orders += 1;
      rows.set(line.productId, row);
    }
  }
  return [...rows.values()].sort((a, b) => b.value - a.value || b.qty - a.qty);
}

export function topCustomers(orders: Order[]): Ranked[] {
  const rows = new Map<string, Ranked>();
  for (const order of orders) {
    const id = customerKey(order.customer);
    const row = rows.get(id) ?? { id, label: order.customer, value: 0, qty: 0, unpriced: 0, orders: 0 };
    row.value += order.total;
    row.qty += itemCount(order);
    row.orders += 1;
    rows.set(id, row);
  }
  return [...rows.values()].sort((a, b) => b.value - a.value);
}

/** Hours from one status to the next, averaged over the orders that made that step. */
export function averageStepHours(orders: Order[], from: Order['status'], to: Order['status']) {
  const gaps: number[] = [];
  for (const order of orders) {
    const start = order.history.find((event) => event.status === from);
    const end = order.history.find((event) => event.status === to);
    if (start && end) gaps.push((new Date(end.at).getTime() - new Date(start.at).getTime()) / 3_600_000);
  }
  return gaps.length ? gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length : null;
}
