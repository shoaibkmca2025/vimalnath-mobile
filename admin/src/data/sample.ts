import type { Activity, Order, OrderEvent, OrderLine, OrderStatus, Product } from './types';

/**
 * Sample orders so the order screens have something to show. The app keeps orders on the phone today,
 * so there is no real order history to load yet; every customer, phone number and note here is invented.
 * Fields match what the app's Place Order sheet collects: a customer or site name, an optional phone,
 * optional notes (delivery address, timing), and a note on any cart line.
 */

/** Status changes in the sample history are credited to this made-up admin. */
export const SAMPLE_ADMIN = 'Sales desk (sample)';

function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Name, phone (blank when the customer skipped it), and where they usually take delivery. */
const CUSTOMERS: [string, string, string][] = [
  ['Shree Ganesh Glass Works', '+91 90000 10231', 'Baner, Pune'],
  ['Om Sai Aluminium', '+91 90000 10472', 'Nashik Road'],
  ['Crystal Interiors', '+91 90000 10518', 'Andheri East, Mumbai'],
  ['Patel Glass & Hardware', '', 'Naroda, Ahmedabad'],
  ['Skyline Facades', '+91 90000 10694', 'Whitefield, Bengaluru'],
  ['Royal Glass House', '+91 90000 10735', 'Vijay Nagar, Indore'],
  ['Modern Fabricators', '', 'Hingna MIDC, Nagpur'],
  ['Kiran Glass Centre', '+91 90000 10859', 'Udhna, Surat'],
  ['Sunrise Architectural Systems', '+91 90000 10913', 'Gachibowli, Hyderabad'],
  ['Mahalaxmi Glass Traders', '+91 90000 11046', 'Shahupuri, Kolhapur'],
  ['Urban Space Interiors', '+91 90000 11187', 'Ghodbunder Road, Thane'],
  ['Deccan Glazing Solutions', '+91 90000 11225', 'Hadapsar, Pune'],
  ['Vision Glass Studio', '', 'CIDCO, Aurangabad'],
  ['Jain Hardware Mart', '+91 90000 11364', 'Sitapura, Jaipur'],
];

const TIMINGS = ['after 10 am', 'before 1 pm', 'call before dispatch', 'site open Monday to Saturday', ''];
const LINE_NOTES = ['Same finish as the last order', 'For the second-floor flat', 'Pack separately', 'Need by Friday', 'Check glass thickness before packing'];

const DAY = 86_400_000;

export function generateSampleOrders(products: Product[], count = 46, now = Date.now()): Order[] {
  const random = mulberry32(20261026);
  const pick = <T,>(items: T[]) => items[Math.floor(random() * items.length)]!;
  // Systems and hardware with checked prices make believable order lines.
  const priced = products.filter((product) => product.options.length > 0);
  const systems = priced.filter((product) => product.featured);
  const catalogueOnly = products.filter((product) => product.options.length === 0);

  const orders: Order[] = [];
  for (let index = 0; index < count; index++) {
    const ageDays = Math.floor(Math.pow(random(), 1.3) * 60);
    const createdAt = new Date(now - ageDays * DAY - Math.floor(random() * 9 * 3_600_000) - 3_600_000).toISOString();
    const lineCount = 1 + Math.floor(random() * 3.2);
    const lines: OrderLine[] = [];
    for (let l = 0; l < lineCount; l++) {
      // Now and then a line the app prices from the catalogue page, which the order total leaves out.
      const fromCatalogue = l > 0 && random() < 0.12 && catalogueOnly.length > 0;
      const product = fromCatalogue ? pick(catalogueOnly) : l === 0 && random() < 0.55 ? pick(systems) : pick(priced);
      if (lines.some((line) => line.productId === product.id)) continue;
      const option = product.options.length ? pick(product.options) : undefined;
      lines.push({
        productId: product.id,
        code: product.code,
        name: product.name || product.section,
        option: product.options.length > 1 ? option?.label : undefined,
        optionCode: option?.code,
        note: random() < 0.22 ? pick(LINE_NOTES) : undefined,
        qty: 1 + Math.floor(random() * (product.featured ? 2 : 6)),
        mrp: option?.mrp,
      });
    }
    const status = statusForAge(ageDays, random());
    const [customer, phone, place] = pick(CUSTOMERS);
    const timing = pick(TIMINGS);
    orders.push({
      id: `sample-${index + 1}`,
      number: '',
      createdAt,
      customer,
      phone: phone || undefined,
      notes: random() < 0.75 ? `Deliver to ${place}${timing ? ` · ${timing}` : ''}` : undefined,
      status,
      lines,
      total: lines.reduce((sum, line) => sum + (line.mrp ?? 0) * line.qty, 0),
      history: historyFor(status, createdAt, now, random),
    });
  }

  // Number oldest first, newest on top — the same VSC-0001 format the app uses.
  orders.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  orders.forEach((order, index) => (order.number = `VSC-${String(index + 1).padStart(4, '0')}`));
  return orders.reverse();
}

function statusForAge(ageDays: number, roll: number): OrderStatus {
  if (roll < 0.06) return 'cancelled';
  if (ageDays <= 1) return roll < 0.75 ? 'placed' : 'confirmed';
  if (ageDays <= 4) return roll < 0.3 ? 'placed' : roll < 0.7 ? 'confirmed' : 'dispatched';
  if (ageDays <= 10) return roll < 0.45 ? 'dispatched' : 'delivered';
  return 'delivered';
}

const FLOW: OrderStatus[] = ['placed', 'confirmed', 'dispatched', 'delivered'];

/** Typical hours from the previous step, as [shortest, longest]: confirmed the same day, delivered within a few days. */
const STEP_HOURS: Partial<Record<OrderStatus, [number, number]>> = { confirmed: [1, 20], dispatched: [6, 52], delivered: [18, 96], cancelled: [2, 30] };

/** Status steps spaced out after the order, never later than now. */
function historyFor(status: OrderStatus, createdAt: string, now: number, random: () => number): OrderEvent[] {
  const steps: OrderStatus[] = status === 'cancelled' ? ['placed', 'cancelled'] : FLOW.slice(0, FLOW.indexOf(status) + 1);
  let at = new Date(createdAt).getTime();
  return steps.map((step, index) => {
    if (index > 0) {
      const [low, high] = STEP_HOURS[step]!;
      // Squeeze the remaining steps in before now for recent orders.
      const room = (now - at) / (steps.length - index + 1);
      at += Math.min(room, (low + random() * (high - low)) * 3_600_000);
    }
    return { status: step, at: new Date(at).toISOString(), by: index === 0 ? 'App' : SAMPLE_ADMIN };
  });
}

/** The activity log starts with the sample orders' history, so it reads like a working week. */
export function activityFromOrders(orders: Order[]): Activity[] {
  const entries: Activity[] = [];
  for (const order of orders) {
    for (const event of order.history) {
      entries.push({
        id: `${order.id}-${event.status}`,
        at: event.at,
        by: event.by === 'App' ? order.customer : event.by,
        area: 'orders',
        summary: event.status === 'placed' ? `Placed order ${order.number} in the app` : `Marked ${order.number} ${event.status}`,
        to: `/orders/${order.id}`,
      });
    }
  }
  return entries.sort((a, b) => b.at.localeCompare(a.at));
}
