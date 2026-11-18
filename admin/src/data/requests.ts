import type { Order } from './types';

/**
 * Order requests: orders staff send to a customer's app. A request stays in Order Requests until the customer
 * confirms it; from then on it's an order like any other and is listed in Orders (it stays in Order Requests too,
 * as Confirmed, so its history is still there).
 */
export type RequestState = 'waiting' | 'confirmed' | 'declined' | 'cancelled';

export const isRequest = (order: Order) => order.source === 'admin';
const wasConfirmed = (order: Order) => order.history.some((event) => event.status === 'confirmed');
/** Orders lists app orders, and requests only once they're confirmed. */
export const inOrders = (order: Order) => !isRequest(order) || wasConfirmed(order);

export function requestState(order: Order): RequestState {
  if (wasConfirmed(order)) return 'confirmed';
  if (order.status === 'declined') return 'declined';
  if (order.status === 'cancelled') return 'cancelled';
  return 'waiting';
}

export const REQUEST_STATE: Record<RequestState, { label: string; tone: 'warning' | 'success' | 'neutral' }> = {
  waiting: { label: 'Waiting for customer', tone: 'warning' },
  confirmed: { label: 'Confirmed · in Orders', tone: 'success' },
  declined: { label: 'Declined', tone: 'neutral' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};

export type RequestUpdate = {
  kind: 'sent' | 'resent' | 'received' | 'confirmed' | 'declined' | 'cancelled';
  at: string;
  /** "App" for the customer, otherwise the staff member's name. */
  by: string;
  /** Something the customer did, which is what the red badge counts. */
  fromCustomer: boolean;
};

export const time = (iso: string) => Date.parse(iso) || 0;

/** A request's updates, oldest first, up to the customer confirming it (what happens after that is in Orders). */
export function requestUpdates(order: Order): RequestUpdate[] {
  const updates: RequestUpdate[] = [];
  let sent = false;
  for (const event of order.history) {
    if (event.status === 'requested') {
      updates.push({ kind: sent ? 'resent' : 'sent', at: event.at, by: event.by, fromCustomer: false });
      sent = true;
    } else if (event.status === 'confirmed') {
      updates.push({ kind: 'confirmed', at: event.at, by: event.by, fromCustomer: event.by === 'App' });
      break;
    } else if (event.status === 'declined') updates.push({ kind: 'declined', at: event.at, by: event.by, fromCustomer: event.by === 'App' });
    else if (event.status === 'cancelled') updates.push({ kind: 'cancelled', at: event.at, by: event.by, fromCustomer: false });
  }
  if (order.customerSeenAt) updates.push({ kind: 'received', at: order.customerSeenAt, by: 'App', fromCustomer: true });
  return updates.sort((a, b) => time(a.at) - time(b.at));
}

export function updateLabel(update: RequestUpdate) {
  switch (update.kind) {
    case 'sent':
      return 'Sent to the customer';
    case 'resent':
      return 'Sent again';
    case 'received':
      return 'Received in their app';
    case 'confirmed':
      return update.by === 'App' ? 'Confirmed by the customer' : 'Confirmed';
    case 'declined':
      return update.by === 'App' ? 'Declined by the customer' : 'Declined';
    case 'cancelled':
      return 'Cancelled';
  }
}

/** The newest update, for sorting: requests the customer just answered come first. */
export const latestUpdate = (order: Order) => requestUpdates(order).at(-1)?.at ?? order.createdAt;

/** Whether this update is new to someone who last looked at `seen`. */
export const isNew = (update: RequestUpdate, seen: number) => update.fromCustomer && time(update.at) > seen;
