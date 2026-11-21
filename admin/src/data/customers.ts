import { customerKey } from './orders.ts';

/** A customer as the server keeps it (Module 7). Money leaves out cancelled orders. */
export type CustomerRecord = {
  id: number;
  name: string;
  tags: string[];
  note: string;
  createdAt: string;
  /** From the profile their app sent most recently; empty until it sends one. */
  phone: string;
  business: string;
  email: string;
  city: string;
  appUsers: { id: number; label: string; phone: string; lastSeenAt: string | null; blocked: boolean }[];
  orders: number;
  spent: number;
  open: number;
  firstOrder: string | null;
  lastOrder: string | null;
  /** GST details for tax invoices; an empty GSTIN is an unregistered buyer. */
  gstin: string;
  legalName: string;
  billingAddress: string;
  state: string;
  pincode: string;
};

export type DuplicatePair = { keep: CustomerRecord; merge: CustomerRecord; reason: string };

/** The last 10 digits, so "+91 98200 12345" and "098200-12345" match. */
const phoneKey = (phone: string) => {
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : null;
};

/**
 * Records that look like one customer: a phone number in common, or the same name however it's typed.
 * The one with more orders is kept (the older one on a tie). Grouped by key, not compared pair by pair, so it stays quick.
 */
export function duplicatePairs(customers: CustomerRecord[]): DuplicatePair[] {
  const groups = new Map<string, { reason: string; members: CustomerRecord[] }>();
  const add = (key: string, reason: string, customer: CustomerRecord) => {
    const group = groups.get(key) ?? { reason, members: [] };
    if (!group.members.includes(customer)) group.members.push(customer);
    groups.set(key, group);
  };
  for (const customer of customers) {
    for (const phone of [customer.phone, ...customer.appUsers.map((user) => user.phone)]) {
      const key = phoneKey(phone);
      if (key) add(`phone:${key}`, `Same phone number, ${phone}`, customer);
    }
    add(`name:${customerKey(customer.name)}`, 'Same name', customer);
  }
  const pairs = new Map<string, DuplicatePair>();
  for (const { reason, members } of groups.values()) {
    if (members.length < 2) continue;
    const [keep, ...rest] = [...members].sort((a, b) => b.orders - a.orders || a.id - b.id);
    for (const merge of rest) {
      const id = `${keep!.id}-${merge.id}`;
      if (!pairs.has(id)) pairs.set(id, { keep: keep!, merge, reason });
    }
  }
  return [...pairs.values()];
}
