import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { BootScreen } from '@/components/BootScreen';
import { useToast } from '@/components/useToast';
import { api } from '@/lib/api';
import { readSession } from './session';
import { isServerKey, SERVER_KEYS, serverRequests, type Catalogue, type ServerKey } from './server';
import type { Activity, Database, Order, Seed } from './types';
import { DataContext, type DataContextValue, type LogEntry } from './useData';

/**
 * The admin's data. Orders and the catalogue (products, categories, price lists) are read from and saved to the server.
 * Everything else still comes from public/data/seed.json (built from the mobile app's data by scripts/seed.mjs),
 * with edits kept in this browser's localStorage until its own module reaches the server.
 * Pages only use `db`, `update` and `reset`.
 */

// v2: orders follow the app's fields (phone and notes, no city) and every change is logged.
const STORAGE_KEY = 'vimalnath-admin:changes:v2';
/** Older entries drop off so the log can't outgrow the browser's storage. */
const ACTIVITY_LIMIT = 400;

type Changes = Partial<Database>;

function readChanges(): Changes {
  try {
    const changes = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Changes;
    // Catalogue edits made before it had a server are dropped: the server's copy is the real one now.
    for (const key of SERVER_KEYS) delete changes[key];
    return changes;
  } catch {
    return {};
  }
}

/** False when the browser refused, usually because its storage is full. */
function writeChanges(changes: Changes) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(changes));
    return true;
  } catch {
    return false;
  }
}

function withLog(changes: Changes, base: Database, log?: LogEntry): Changes {
  if (!log) return changes;
  const entry: Activity = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, at: new Date().toISOString(), by: readSession()?.name ?? 'Admin', ...log };
  return { ...changes, activity: [entry, ...(changes.activity ?? base.activity)].slice(0, ACTIVITY_LIMIT) };
}

type State = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; base: Database; changes: Changes };

export function DataProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const toast = useToast();
  /** What the server has: each catalogue save is worked out against this. */
  const server = useRef<Pick<Database, ServerKey> | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  const changes = state.status === 'ready' ? state.changes : null;
  useEffect(() => {
    if (changes && !writeChanges(changes)) toast({ tone: 'error', message: 'This browser’s storage is full, so your latest changes aren’t saved. Download a copy from Settings.' });
  }, [changes, toast]);

  useEffect(() => {
    let active = true;
    const seed = fetch('/data/seed.json').then((response) => {
      if (!response.ok) throw new Error(`The app’s data file couldn’t be loaded (HTTP ${response.status}).`);
      return response.json() as Promise<Seed>;
    });
    // Catalogue editors don't work with orders, and the server refuses them.
    const orders = readSession()?.role === 'catalogue' ? Promise.resolve<Order[]>([]) : api<Order[]>('/orders');
    Promise.all([seed, api<Catalogue>('/catalogue'), orders])
      .then(([{ sections, videoSections, cutlist, banners, settings }, catalogue, orders]) => {
        if (!active) return;
        if (!catalogue.products.length) throw new Error('The catalogue isn’t in the database yet. In the server folder, run npm run import-data, then try again.');
        const { products, categories, catalogues } = catalogue;
        server.current = { products, categories, catalogues, orders };
        const base: Database = { ...catalogue, sections, videoSections, cutlist, banners, settings, orders, activity: [] };
        setState({ status: 'ready', base, changes: readChanges() });
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
      if (!isServerKey(key)) {
        setState((previous) => {
          if (previous.status !== 'ready') return previous;
          const current = (previous.changes[key] ?? previous.base[key]) as Database[typeof key];
          return { ...previous, changes: withLog({ ...previous.changes, [key]: change(current) }, previous.base, log) };
        });
        return Promise.resolve(true);
      }
      // One save at a time, shown only once the server has it, so a refused edit leaves the screen and any form as they were.
      const saving = queue.current.then(async () => {
        const saved = server.current!;
        const before = saved[key];
        let after = change(before as never) as typeof before;
        try {
          for (const request of serverRequests<ServerKey>(key, before, after)) {
            const result = await api<{ orders?: Order[] } | undefined>(request.path, request.method, request.body);
            // Order changes come back as the server recorded them (who, when), which is what the history should show.
            const fresh = new Map(result?.orders?.map((order) => [order.id, order]));
            if (fresh.size) after = (after as Order[]).map((order) => fresh.get(order.id) ?? order) as typeof before;
          }
        } catch (error) {
          toast({ tone: 'error', message: `${error instanceof Error ? error.message : 'Something went wrong.'} Your change wasn’t saved.` });
          return false;
        }
        server.current = { ...saved, [key]: after };
        setState((previous) => (previous.status === 'ready' ? { ...previous, base: { ...previous.base, [key]: after }, changes: withLog(previous.changes, previous.base, log) } : previous));
        return true;
      });
      queue.current = saving.catch(() => false);
      return saving;
    },
    [toast],
  );

  // Phones keep sending orders while the admin is open, so fetch them again every minute and when the window comes
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
    const timer = setInterval(refresh, 60_000);
    window.addEventListener('focus', refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, [ready]);

  const reset = useCallback(() => {
    setState((previous) => (previous.status === 'ready' ? { ...previous, changes: {} } : previous));
  }, []);

  const value = useMemo<DataContextValue | null>(() => {
    if (state.status !== 'ready') return null;
    return { db: { ...state.base, ...state.changes }, update, reset, hasChanges: Object.keys(state.changes).length > 0 };
  }, [state, update, reset]);

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
