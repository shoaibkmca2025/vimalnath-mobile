import type { Database, Order, OrderStatus } from './types';

/** The parts of the admin's data that are saved on the server. Everything else is still preview data in this browser. */
export const SERVER_KEYS = ['products', 'categories', 'catalogues', 'orders'] as const;
export type ServerKey = (typeof SERVER_KEYS)[number];
export type Catalogue = Pick<Database, 'products' | 'categories' | 'catalogues' | 'catalogPages'>;

export const isServerKey = (key: keyof Database): key is ServerKey => (SERVER_KEYS as readonly string[]).includes(key);

type Request = { path: string; method: 'PUT' | 'DELETE' | 'POST'; body?: unknown };

/** The API calls that turn `before` into `after`: only what changed, or the whole list when it is short. `reason` goes into the price history. */
export function serverRequests<K extends ServerKey>(key: K, before: Database[K], after: Database[K], reason?: string): Request[] {
  if (before === after) return [];
  if (key === 'categories') return [{ path: '/categories', method: 'PUT', body: { categories: after } }];
  if (key === 'catalogues') return [{ path: '/price-lists', method: 'PUT', body: { priceLists: after } }];
  if (key === 'orders') return orderRequests(before as Order[], after as Order[]);

  const old = before as Database['products'];
  const now = after as Database['products'];
  const saved = new Map(old.map((product) => [product.id, JSON.stringify(product)]));
  const changed = now.filter((product) => saved.get(product.id) !== JSON.stringify(product));
  const kept = new Set(now.map((product) => product.id));
  return [
    ...(changed.length ? [{ path: '/products', method: 'PUT' as const, body: reason ? { products: changed, reason } : { products: changed } }] : []),
    ...old.filter((product) => !kept.has(product.id)).map((product) => ({ path: `/products/${encodeURIComponent(product.id)}`, method: 'DELETE' as const })),
  ];
}

/** Staff change only an order's status and internal note: one request per new status, so 20 orders confirmed at once is one call. */
function orderRequests(before: Order[], after: Order[]): Request[] {
  const old = new Map(before.map((order) => [order.id, order]));
  const moved = new Map<OrderStatus, string[]>();
  const notes: Request[] = [];
  for (const order of after) {
    const was = old.get(order.id);
    if (!was) continue;
    if (was.status !== order.status) moved.set(order.status, [...(moved.get(order.status) ?? []), order.id]);
    const text = order.internalNote?.text ?? '';
    if ((was.internalNote?.text ?? '') !== text) notes.push({ path: `/orders/${encodeURIComponent(order.id)}/internal-note`, method: 'PUT', body: { text } });
  }
  return [...[...moved].map(([status, ids]) => ({ path: '/orders/status', method: 'POST' as const, body: { ids, status } })), ...notes];
}
