import { useCallback, useEffect, useState } from 'react';

import type { GstPayment, GstSettings, Purchase, SalesInvoice } from '@/data/types';
import { api } from '@/lib/api';

type Loaded = { settings: GstSettings; invoices: SalesInvoice[]; purchases: Purchase[]; payments: GstPayment[] };

/** Everything the GST pages work from: settings, invoices, purchase bills and GST paid. Owners only. */
export function useGst() {
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const reload = useCallback(() => setAttempt((count) => count + 1), []);

  useEffect(() => {
    let active = true;
    Promise.all([api<GstSettings>('/gst/settings'), api<SalesInvoice[]>('/gst/invoices'), api<Purchase[]>('/purchases'), api<GstPayment[]>('/gst/payments')]).then(
      ([settings, invoices, purchases, payments]) => active && setData({ settings, invoices, purchases, payments }),
      (problem: unknown) => active && setError(problem instanceof Error ? problem.message : 'Couldn’t load GST records.'),
    );
    return () => {
      active = false;
    };
  }, [attempt]);

  /** Puts a saved or removed invoice in place, as the server returned it. */
  const keepInvoices = useCallback((fresh: SalesInvoice[] = [], removed: string[] = []) => {
    setData((current) => {
      if (!current) return current;
      const byId = new Map(fresh.map((invoice) => [invoice.id, invoice]));
      const kept = current.invoices.filter((invoice) => !removed.includes(invoice.id)).map((invoice) => {
        const replaced = byId.get(invoice.id);
        byId.delete(invoice.id);
        return replaced ?? invoice;
      });
      return { ...current, invoices: [...byId.values(), ...kept] };
    });
  }, []);

  return { data, error, reload, keepInvoices, setData };
}
