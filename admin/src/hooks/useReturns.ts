import { useCallback, useEffect, useState } from 'react';

import { RETURNS_CHANGED } from '@/data/returns';
import type { Answer } from '@/data/stock';
import type { ReturnSettings, SalesReturn } from '@/data/types';
import { api } from '@/lib/api';

/**
 * Every return and the Return Settings, for the returns pages (not loaded with the rest of the admin). `apply` takes an
 * action's answer, so the page shows what the server recorded, and tells the sidebar's counts to catch up.
 */
export function useReturns() {
  const [returns, setReturns] = useState<SalesReturn[] | null>(null);
  const [settings, setSettings] = useState<ReturnSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const reload = useCallback(() => setAttempt((count) => count + 1), []);

  useEffect(() => {
    let active = true;
    Promise.all([api<SalesReturn[]>('/returns'), api<ReturnSettings>('/returns/settings')]).then(
      ([loaded, loadedSettings]) => {
        if (!active) return;
        setReturns(loaded);
        setSettings(loadedSettings);
        setError(null);
      },
      (problem: unknown) => active && setError(problem instanceof Error ? problem.message : 'Couldn’t load returns.'),
    );
    return () => {
      active = false;
    };
  }, [attempt]);

  const apply = useCallback((answer: Answer | false | undefined) => {
    if (!answer || !answer.returns?.length) return;
    const fresh = new Map(answer.returns.map((ret) => [ret.id, ret]));
    setReturns((current) => {
      const kept = (current ?? []).map((ret) => {
        const replaced = fresh.get(ret.id);
        fresh.delete(ret.id);
        return replaced ?? ret;
      });
      return [...fresh.values(), ...kept];
    });
    window.dispatchEvent(new Event(RETURNS_CHANGED));
  }, []);

  return { returns, settings, setSettings, error, reload, apply };
}
