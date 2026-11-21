import { FilePlusIcon, ReceiptIcon } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';

import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Card, CardHeader } from '@/components/Card';
import { useToast } from '@/components/useToast';
import { INVOICE_STATUS } from '@/data/gst';
import { dayLabel } from '@/data/payments';
import { formatMoney } from '@/data/purchases';
import type { Order, SalesInvoice } from '@/data/types';
import { api } from '@/lib/api';

/** An order's GST tax invoice: the one it has, or a button to make a draft once the order is confirmed. Owners only. */
export function TaxInvoiceCard({ order }: { order: Order }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [invoices, setInvoices] = useState<SalesInvoice[] | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let active = true;
    api<SalesInvoice[]>(`/gst/invoices?orderId=${encodeURIComponent(order.id)}`).then(
      (loaded) => active && setInvoices(loaded),
      () => active && setInvoices([]),
    );
    return () => {
      active = false;
    };
  }, [order.id]);

  const current = invoices?.find((invoice) => invoice.status !== 'cancelled');
  const cancelled = invoices?.filter((invoice) => invoice.status === 'cancelled') ?? [];
  const confirmed = ['confirmed', 'packed', 'dispatched', 'delivered'].includes(order.status);

  const create = async () => {
    setCreating(true);
    try {
      const { invoices: [draft] } = await api<{ invoices: SalesInvoice[] }>('/gst/invoices', 'POST', { orderId: Number(order.id) });
      navigate(`/gst/invoices/${draft!.id}`);
    } catch (problem) {
      toast({ tone: 'error', message: problem instanceof Error ? problem.message : 'Couldn’t make the invoice.' });
      setCreating(false);
    }
  };

  return (
    <Card aria-labelledby="tax-invoice-title" className="no-print">
      <CardHeader id="tax-invoice-title" title="Tax invoice" action={current && <Badge tone={INVOICE_STATUS[current.status].tone}>{INVOICE_STATUS[current.status].label}</Badge>} />
      <div className="card__body stack">
        {invoices === null ? (
          <p className="muted">Loading…</p>
        ) : current ? (
          <Link to={`/gst/invoices/${current.id}`} className="row" style={{ gap: 8 }}>
            <ReceiptIcon size={18} aria-hidden />
            <span>
              <strong className="num">{current.number ?? 'Draft invoice'}</strong>
              <span className="cell-sub" style={{ display: 'block' }}>
                {dayLabel(current.invoiceDate)} · {formatMoney(current.total)}
              </span>
            </span>
          </Link>
        ) : confirmed ? (
          <>
            <p className="muted" style={{ margin: 0 }}>
              Not invoiced yet. The draft takes the bill, HSN and GST rates from Stock, for you to check before posting.
            </p>
            <Button icon={FilePlusIcon} loading={creating} onClick={create}>
              Make Tax Invoice
            </Button>
          </>
        ) : (
          <p className="muted" style={{ margin: 0 }}>
            {order.status === 'cancelled' || order.status === 'declined' ? 'Not invoiced: the order isn’t going ahead.' : 'Can be invoiced once the order is confirmed.'}
          </p>
        )}
        {cancelled.length > 0 && (
          <p className="cell-sub" style={{ margin: 0 }}>
            Cancelled: {cancelled.map((invoice) => invoice.number).join(', ')}
          </p>
        )}
      </div>
    </Card>
  );
}
