import { api } from '@/lib/api';

export type Role = 'owner' | 'sales' | 'catalogue' | 'inventory' | 'accountant';

// Who does what, as the server allows it (server/src: orders, customers, gst, purchases, returns, stock).
/** Bills and payments, GST invoices, purchases, suppliers, and purchase prices: the Owner and the Accountant. */
export const handlesMoney = (role: Role | undefined) => role === 'owner' || role === 'accountant';
/** Moving orders along, their notes and order requests: the Owner and Sales. Cancelling is the Owner's alone. */
export const movesOrders = (role: Role | undefined) => role === 'owner' || role === 'sales';
export type Session = { id: number; name: string; email: string; role: Role };

// Filled from the server before any signed-in page renders, so screens can read it without waiting.
let current: Session | null = null;

export const readSession = () => current;

/** Route loader: asks the server who is signed in. Any failure just means the sign-in page. */
export async function restoreSession() {
  current = await api<Session>('/me').catch(() => null);
  return null;
}

export async function startSession(email: string, password: string) {
  current = await api<Session>('/auth/sign-in', 'POST', { email, password });
}

export async function endSession() {
  await api('/auth/sign-out', 'POST').catch(() => {});
  current = null;
}
