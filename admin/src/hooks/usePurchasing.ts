import { useCallback, useEffect, useState } from 'react';

import type { Answer } from '@/data/stock';
import type { Purchase, Supplier } from '@/data/types';
import { api } from '@/lib/api';

/**
 * Suppliers and their bills for the purchase pages (Owners only, so they aren't loaded with the rest of the admin).
 * `apply` takes a save's answer, so the page shows what the server recorded.
 */
export function usePurchasing() {
  const [suppliers, setSuppliers] = useState<Supplier[] | null>(null);
  const [purchases, setPurchases] = useState<Purchase[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [loadedSuppliers, loadedPurchases] = await Promise.all([api<Supplier[]>('/suppliers'), api<Purchase[]>('/purchases')]);
      setSuppliers(loadedSuppliers);
      setPurchases(loadedPurchases);
      setError(null);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Couldn’t load purchases.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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
