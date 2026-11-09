import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import { BootScreen } from '@/components/BootScreen';
import { useToast } from '@/components/useToast';
import { activityFromOrders, generateSampleOrders } from './sample';
import { readSession } from './session';
import type { Activity, Database, Seed } from './types';
import { DataContext, type DataContextValue } from './useData';

/**
 * Preview data layer. The catalogue comes from public/data/seed.json (built from the mobile app's data by
 * scripts/seed.mjs); edits are kept in this browser's localStorage until the admin has a server to save to.
 * Pages only use `db`, `update` and `reset`, so swapping this for API calls doesn't touch them.
 */

// v2: orders follow the app's fields (phone and notes, no city) and every change is logged.
const STORAGE_KEY = 'vimalnath-admin:changes:v2';
/** Older entries drop off so the log can't outgrow the browser's storage. */
const ACTIVITY_LIMIT = 400;

type Changes = Partial<Database>;

function readChanges(): Changes {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Changes;
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

type State = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; base: Database; changes: Changes };

export function DataProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const toast = useToast();

  const changes = state.status === 'ready' ? state.changes : null;
  useEffect(() => {
    if (changes && !writeChanges(changes)) toast({ tone: 'error', message: 'This browser’s storage is full, so your latest changes aren’t saved. Download a copy from Settings.' });
  }, [changes, toast]);

  useEffect(() => {
    let active = true;
    fetch('/data/seed.json')
      .then((response) => {
        if (!response.ok) throw new Error(`The catalogue file couldn’t be loaded (HTTP ${response.status}).`);
        return response.json() as Promise<Seed>;
      })
      .then((seed) => {
        if (!active) return;
        const { products, catalogPages, categories, catalogues, sections, videoSections, cutlist, banners, settings } = seed;
        const orders = generateSampleOrders(products);
        const base: Database = {
          products,
          catalogPages,
          categories,
          catalogues,
          sections,
          videoSections,
          cutlist,
          banners,
          settings,
          orders,
          activity: activityFromOrders(orders),
        };
        setState({ status: 'ready', base, changes: readChanges() });
      })
      .catch((error: unknown) => {
        if (active) setState({ status: 'error', message: error instanceof Error ? error.message : 'Something went wrong.' });
      });
    return () => {
      active = false;
    };
  }, [attempt]);

  const update = useCallback<DataContextValue['update']>((key, change, log) => {
    setState((previous) => {
      if (previous.status !== 'ready') return previous;
      const current = (previous.changes[key] ?? previous.base[key]) as Database[typeof key];
      const changes: Changes = { ...previous.changes, [key]: change(current) };
      if (log) {
        const entry: Activity = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, at: new Date().toISOString(), by: readSession()?.name ?? 'Admin', ...log };
        changes.activity = [entry, ...(changes.activity ?? previous.base.activity)].slice(0, ACTIVITY_LIMIT);
      }
      return { ...previous, changes };
    });
  }, []);

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
