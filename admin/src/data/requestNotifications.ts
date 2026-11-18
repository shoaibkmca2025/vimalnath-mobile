import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';

import { isRequest, requestUpdates, time } from './requests';
import { readSession } from './session';
import type { Order } from './types';

// ---- New updates since this staff member last opened Order Requests, kept in this browser.

const listeners = new Set<() => void>();
const memory = new Map<string, number>();
const keyOf = () => `vimalnath-admin:requests-seen:${readSession()?.id ?? 0}`;

function readSeen(): number | null {
  const key = keyOf();
  if (memory.has(key)) return memory.get(key)!;
  try {
    const saved = localStorage.getItem(key);
    if (saved !== null) memory.set(key, Number(saved) || 0);
  } catch {
    // Storage blocked: remembered for this visit only.
  }
  return memory.has(key) ? memory.get(key)! : null;
}

function writeSeen(value: number) {
  const key = keyOf();
  if (memory.get(key) === value) return;
  memory.set(key, value);
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // Kept in memory.
  }
  listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** The time of the newest customer update, by the server's clock, so a slow or fast computer clock can't hide one. */
const newestFromCustomer = (orders: Order[]) =>
  orders.filter(isRequest).reduce((newest, order) => Math.max(newest, ...requestUpdates(order).filter((update) => update.fromCustomer).map((update) => time(update.at))), 0);

/**
 * How many customer updates (received, confirmed, declined) arrived since Order Requests was last open, and
 * `markSeen` for that page to call. The first time, everything already there counts as seen.
 */
export function useRequestNotifications(orders: Order[]) {
  const seen = useSyncExternalStore(subscribe, readSeen, readSeen);
  const newest = useMemo(() => newestFromCustomer(orders), [orders]);

  useEffect(() => {
    if (seen === null) writeSeen(newest);
  }, [seen, newest]);

  const count = useMemo(() => {
    if (seen === null) return 0;
    return orders.filter(isRequest).reduce((sum, order) => sum + requestUpdates(order).filter((update) => update.fromCustomer && time(update.at) > seen).length, 0);
  }, [orders, seen]);

  const markSeen = useCallback(() => writeSeen(Math.max(newest, readSeen() ?? 0)), [newest]);
  return { count, seen: seen ?? newest, markSeen };
}

