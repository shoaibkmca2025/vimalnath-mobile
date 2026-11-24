import { useEffect, useState } from 'react';

import { api } from '@/lib/api';

import { RETURNS_CHANGED } from './returns.ts';

export type ReturnCounts = { decide: number; receive: number; inspect: number; refunds: number };

/** The sidebar's counts: fetched now, every minute, when the window comes back, and after a change. */
export function useReturnCounts(enabled: boolean) {
  const [counts, setCounts] = useState<ReturnCounts>({ decide: 0, receive: 0, inspect: 0, refunds: 0 });
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const load = () => {
      api<ReturnCounts>('/returns/count').then(
        (result) => active && setCounts(result),
        () => {},
      );
    };
    load();
    const timer = setInterval(load, 60_000);
    window.addEventListener('focus', load);
    window.addEventListener(RETURNS_CHANGED, load);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener('focus', load);
      window.removeEventListener(RETURNS_CHANGED, load);
    };
  }, [enabled]);
  return enabled ? counts : { decide: 0, receive: 0, inspect: 0, refunds: 0 };
}
