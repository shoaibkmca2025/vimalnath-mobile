import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { BootScreen } from '@/components/BootScreen';
import { useToast } from '@/components/useToast';
import { api } from '@/lib/api';
import { readSession } from './session';
import { changed, serverRequests, type Calculators, type Catalogue, type Content, type ServerKey } from './server';
import type { Activity, Database, Order } from './types';
import { DataContext, type DataContextValue } from './useData';

/**
 * The admin's data, read from and saved to the server, with the activity log of who changed what (Module 12).
 * Pages only use `db` and `update`.
 */

type State = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; base: Database };

export function DataProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const toast = useToast();
  /** What the server has: each catalogue save is worked out against this. */
  const server = useRef<Pick<Database, ServerKey> | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  /** How many times each whole list had been saved when this tab read it; the server refuses a save from an older copy. */
  const versions = useRef<Record<string, number>>({});

  useEffect(() => {
    let active = true;
    // Catalogue editors don't work with orders, and the server refuses them.
    const orders = readSession()?.role === 'catalogue' ? Promise.resolve<Order[]>([]) : api<Order[]>('/orders');
    // Versions before the lists: a save that lands in between then makes this tab ask for a reload, never overwrite it.
    api<Record<string, number>>('/versions')
      .then((loaded) => {
        versions.current = loaded;
        return Promise.all([api<Catalogue>('/catalogue'), orders, api<Calculators>('/calculators'), api<Content>('/content'), api<Activity[]>('/activity')]);
      })
      .then(([catalogue, orders, { cutlist, sections }, content, activity]) => {
        if (!active) return;
        if (!catalogue.products.length) throw new Error('The catalogue isn’t in the database yet. In the server folder, run npm run import-data, then try again.');
        const { products, categories, catalogues } = catalogue;
        server.current = { products, categories, catalogues, orders, cutlist, sections, ...content };
        const base: Database = { ...catalogue, sections, cutlist, ...content, orders, activity };
        setState({ status: 'ready', base });
      })
      .catch((error: unknown) => {
        if (active) setState({ status: 'error', message: error instanceof Error ? error.message : 'Something went wrong.' });
      });
    return () => {
      active = false;
    };
  }, [attempt]);

  const update = useCallback<DataContextValue['update']>(
    (key, change, log) => {
      // One save at a time, shown only once the server has it, so a refused edit leaves the screen and any form as they were.
      const saving = queue.current.then(async () => {
        const saved = server.current!;
        const before = saved[key];
        let after = change(before as never) as typeof before;
        try {
          for (const request of serverRequests<ServerKey>(key, before, after, log?.summary)) {
            const seen = versions.current[key];
            const result = await api<{ orders?: Order[] } | undefined>(request.path, request.method, seen === undefined ? request.body : { ...(request.body as object), version: seen });
            if (seen !== undefined) versions.current[key] = seen + 1;
            // Order changes come back as the server recorded them (who, when), which is what the history should show.
            const fresh = new Map(result?.orders?.map((order) => [order.id, order]));
            if (fresh.size) after = (after as Order[]).map((order) => fresh.get(order.id) ?? order) as typeof before;
          }
        } catch (error) {
          toast({ tone: 'error', message: `${error instanceof Error ? error.message : 'Something went wrong.'} Your change wasn’t saved.` });
          return false;
        }
        server.current = { ...saved, [key]: after };
        setState((previous) => (previous.status === 'ready' ? { ...previous, base: { ...previous.base, [key]: after } } : previous));
        // The server adds who and when. The change itself is saved either way, so a failed entry is not an error to show.
        const entry = log && (await api<Activity>('/activity', 'POST', { ...log, ...changed(before, after) }).catch(() => null));
        if (entry) setState((previous) => (previous.status === 'ready' ? { ...previous, base: { ...previous.base, activity: [entry, ...previous.base.activity] } } : previous));
        return true;
      });
      queue.current = saving.catch(() => false);
      return saving;
    },
    [toast],
  );

  // Phones keep sending orders while the admin is open, so fetch them again regularly and when the window comes
  // back to the front. Through the save queue, so a refresh never lands in the middle of a save.
  const ready = state.status === 'ready';
  useEffect(() => {
    if (!ready || readSession()?.role === 'catalogue') return;
    const refresh = () => {
      queue.current = queue.current.then(async () => {
        const orders = await api<Order[]>('/orders').catch(() => null);
        if (!orders || !server.current) return;
        server.current = { ...server.current, orders };
        setState((previous) => (previous.status === 'ready' ? { ...previous, base: { ...previous.base, orders } } : previous));
      });
    };
    // Every 30 seconds, so a customer confirming an order request shows up quickly.
    const timer = setInterval(refresh, 30_000);
    window.addEventListener('focus', refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, [ready]);

  const value = useMemo<DataContextValue | null>(() => (state.status === 'ready' ? { db: state.base, update } : null), [state, update]);

  if (state.status === 'loading') return <BootScreen />;
  if (state.status === 'error')
    return (
      <BootScreen
        error={state.message}
        onRetry={() => {
          setState({ status: 'loading' });
          setAttempt((count) => count + 1);
        }}
      />
    );
  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}
