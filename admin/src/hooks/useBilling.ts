import { useCallback, useEffect, useState } from 'react';

import { setUnitPrints } from '@/data/gst';
import type { Answer } from '@/data/stock';
import type { BillingSetup, DiscountSetup, SalesInvoice } from '@/data/types';
import { api } from '@/lib/api';

/**
 * Bills (every invoice, counter bills and order invoices), the Invoice Settings and units, and the discount rules, for
 * the billing pages. `apply` takes an action's answer so the page shows what the server recorded.
 */
export function useBilling(load: { invoices?: boolean } = { invoices: true }) {
  const [invoices, setInvoices] = useState<SalesInvoice[] | null>(null);
  const [setup, setSetup] = useState<BillingSetup | null>(null);
  const [discounts, setDiscounts] = useState<DiscountSetup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const reload = useCallback(() => setAttempt((count) => count + 1), []);
  const withInvoices = load.invoices !== false;

  useEffect(() => {
    let active = true;
    Promise.all([withInvoices ? api<SalesInvoice[]>('/billing/invoices') : Promise.resolve([]), api<BillingSetup>('/billing/settings'), api<DiscountSetup>('/discounts/rules')]).then(
      ([loaded, loadedSetup, loadedDiscounts]) => {
        if (!active) return;
        setUnitPrints(loadedSetup.units);
        setInvoices(loaded);
        setSetup(loadedSetup);
        setDiscounts(loadedDiscounts);
        setError(null);
      },
      (problem: unknown) => active && setError(problem instanceof Error ? problem.message : 'Couldn’t load billing.'),
    );
    return () => {
      active = false;
    };
  }, [attempt, withInvoices]);

  const apply = useCallback((answer: (Answer & { invoices?: SalesInvoice[]; removedInvoices?: string[] }) | false | undefined) => {
    if (!answer) return;
    const removed = new Set(answer.removedInvoices ?? []);
    const fresh = new Map((answer.invoices ?? []).map((invoice) => [invoice.id, invoice]));
    setInvoices((current) => {
      const kept = (current ?? []).filter((invoice) => !removed.has(invoice.id)).map((invoice) => {
        const replaced = fresh.get(invoice.id);
        fresh.delete(invoice.id);
        return replaced ?? invoice;
      });
      return [...fresh.values(), ...kept];
    });
  }, []);

  return { invoices, setup, setSetup, discounts, setDiscounts, error, reload, apply };
}
