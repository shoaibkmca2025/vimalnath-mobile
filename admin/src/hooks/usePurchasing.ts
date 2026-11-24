import { useCallback, useEffect, useState } from 'react';

import type { Answer } from '@/data/stock';
import type { Purchase, Supplier } from '@/data/types';
import { api } from '@/lib/api';

/**
 * Suppliers and their bills for the purchase pages (Owners only, so they aren't loaded with the rest of the admin).
 * `apply` takes a save's answer, so the page shows what the server recorded. With `enabled` false nothing is fetched
 * (for staff who can't see purchases).
 */
export function usePurchasing(enabled = true) {
  const [suppliers, setSuppliers] = useState<Supplier[] | null>(null);
  const [purchases, setPurchases] = useState<Purchase[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Raised to fetch everything again, e.g. after a bill changes what a supplier is owed.
  const [attempt, setAttempt] = useState(0);
  const load = useCallback(() => setAttempt((count) => count + 1), []);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    Promise.all([api<Supplier[]>('/suppliers'), api<Purchase[]>('/purchases')]).then(
      ([loadedSuppliers, loadedPurchases]) => {
        if (!active) return;
        setSuppliers(loadedSuppliers);
        setPurchases(loadedPurchases);
        setError(null);
      },
      (problem: unknown) => active && setError(problem instanceof Error ? problem.message : 'Couldn’t load purchases.'),
    );
    return () => {
      active = false;
    };
  }, [enabled, attempt]);

  const apply = useCallback((answer: Answer) => {
    if (answer.purchases?.length || answer.removedPurchases?.length) {
      const removed = new Set(answer.removedPurchases);
      setPurchases((current) => {
        const fresh = new Map(answer.purchases?.map((purchase) => [purchase.id, purchase]));
        const kept = (current ?? []).filter((purchase) => !removed.has(purchase.id)).map((purchase) => {
          const replaced = fresh.get(purchase.id);
          fresh.delete(purchase.id);
          return replaced ?? purchase;
        });
        return [...fresh.values(), ...kept];
      });
    }
    if (answer.supplier) setSuppliers((current) => (current ?? []).map((supplier) => (supplier.id === answer.supplier!.id ? answer.supplier! : supplier)));
  }, []);

  /** Adds or replaces one supplier after the supplier form saves. */
  const keepSupplier = useCallback((saved: Supplier) => {
    setSuppliers((current) => {
      const list = current ?? [];
      return list.some((supplier) => supplier.id === saved.id) ? list.map((supplier) => (supplier.id === saved.id ? saved : supplier)) : [...list, saved].sort((a, b) => a.name.localeCompare(b.name));
    });
  }, []);

  return { suppliers, purchases, error, reload: load, apply, keepSupplier, setSuppliers };
}
