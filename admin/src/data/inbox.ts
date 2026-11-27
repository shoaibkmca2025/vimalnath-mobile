import { useEffect, useState } from 'react';

import { api } from '@/lib/api';

/**
 * Each staff member's notification center (/v1/admin/inbox): new orders, payments, stock alerts, bills, returns,
 * discount approvals and announcements, for the roles that handle them. The unread count is the server's.
 */

export type InboxCategory = 'orders' | 'payments' | 'inventory' | 'billing' | 'returns' | 'customers' | 'announcements' | 'system';
export type InboxItem = { id: string; event: string; category: InboxCategory; title: string; body: string; entityType?: string | null; entityId?: string | null; data: { to?: string }; createdAt: string; read: boolean };
export type InboxPage = { notifications: InboxItem[]; next: string | null; unread: number };
export type InboxQuery = { filter?: 'all' | 'unread' | 'read'; category?: InboxCategory; q?: string; before?: string; limit?: number };
export type InboxPreferences = Record<'orders_enabled' | 'payments_enabled' | 'inventory_enabled' | 'billing_enabled' | 'returns_enabled' | 'customers_enabled' | 'announcements_enabled' | 'sound_enabled' | 'vibration_enabled', boolean>;

export const CATEGORY_LABEL: Record<InboxCategory, string> = {
  orders: 'Orders',
  payments: 'Payments',
  inventory: 'Stock',
  billing: 'Billing',
  returns: 'Returns',
  customers: 'Customers',
  announcements: 'Announcements',
  system: 'Important',
};

/** Fired after reading or deleting, so the bell's count catches up at once. */
export const INBOX_CHANGED = 'vimalnath:inbox-changed';
const changed = () => window.dispatchEvent(new Event(INBOX_CHANGED));

export const inboxPath = (query: InboxQuery = {}) => {
  const params = Object.entries(query)
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`)
    .join('&');
  return `/inbox${params ? `?${params}` : ''}`;
};

export const fetchInbox = (query: InboxQuery = {}) => api<InboxPage>(inboxPath(query));
export async function readInbox(ids?: string[]) {
  const answer = await (ids ? api<{ unread: number }>('/inbox/read', 'POST', { ids: ids.map(Number) }) : api<{ unread: number }>('/inbox/read-all', 'POST'));
  changed();
  return answer.unread;
}
export async function deleteFromInbox(ids: string[]) {
  const answer = await api<{ removed: number; unread: number }>('/inbox/delete', 'POST', { ids: ids.map(Number) });
  changed();
  return answer.unread;
}

/** The bell's count: fetched now, every 30 seconds, when the window comes back, and after a read or delete. */
export function useInboxCount(enabled = true) {
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const load = () => {
      api<{ unread: number }>('/inbox/count').then(
        (result) => active && setUnread(result.unread),
        () => {},
      );
    };
    load();
    const timer = setInterval(load, 30_000);
    window.addEventListener('focus', load);
    window.addEventListener(INBOX_CHANGED, load);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener('focus', load);
      window.removeEventListener(INBOX_CHANGED, load);
    };
  }, [enabled]);
  return enabled ? unread : 0;
}

/** "Just now", "12 min ago", "3 h ago", then the date. */
export function sinceLabel(iso: string, now = Date.now()) {
  const minutes = Math.round((now - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)} h ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
