import { ArrowRightIcon, ChatCircleTextIcon, CheckIcon, FilePdfIcon, NotePencilIcon, PaperPlaneTiltIcon, PencilSimpleIcon, PrinterIcon, XCircleIcon } from '@phosphor-icons/react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

import { Badge } from '@/components/Badge';
import { BillDocument } from '@/components/BillDocument';
import { Button, ButtonLink } from '@/components/Button';
import { Card } from '@/components/Card';
import { ConfirmDialog } from '@/components/Dialog';
import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';
import { useToast } from '@/components/useToast';
import { QUOTATION_STATUS, pageRule, quotationState } from '@/data/billing';
import { invoiceDay } from '@/data/gst';
import { whatsappLink } from '@/data/orders';
import { localDay } from '@/data/payments';
import { formatMoney } from '@/data/purchases';
import { readSession } from '@/data/session';
import type { Quotation, SalesInvoice } from '@/data/types';
import { useData } from '@/data/useData';
import { useBilling } from '@/hooks/useBilling';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';

/** A quotation in the bill's shape, so it prints in the same templates. */
const asInvoice = (quote: Quotation): SalesInvoice => ({
  id: quote.id,
  number: quote.number,
  invoiceDate: quote.quoteDate,
  status: 'draft',
  customerId: quote.customerId,
  customerName: quote.customerName,
  customerPhone: quote.customerPhone,
  customerGstin: quote.customerGstin,
  billingAddress: quote.billingAddress,
  placeOfSupply: quote.placeOfSupply,
  posCode: quote.posCode,
  interstate: quote.interstate,
  pricesIncludeGst: quote.pricesIncludeGst,
  billDiscount: quote.billDiscount,
  billDiscountPct: quote.billDiscountPct,
  taxable: quote.taxable,
  cgst: quote.cgst,
  sgst: quote.sgst,
  igst: quote.igst,
  roundOff: quote.roundOff,
  total: quote.total,
  notes: quote.notes,
  items: quote.items,
  createdBy: quote.createdBy,
  createdAt: quote.createdAt,
});

export default function QuotationPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { db } = useData();
  const role = readSession()?.role;
  const maker = role === 'owner' || role === 'sales';
  const { setup } = useBilling({ invoices: false });
  const [quote, setQuote] = useState<Quotation | null | undefined>(undefined);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'convert' | 'cancelled' | null>(null);

  const load = useCallback(() => {
    let active = true;
    api<Quotation[]>('/billing/quotations').then(
      (all) => active && setQuote(all.find((one) => one.id === id) ?? null),
      () => active && setQuote(null),
    );
    return () => {
      active = false;
    };
  }, [id]);
  useEffect(load, [load]);
  useEffect(() => {
    if (!quote) return;
    const before = document.title;
    document.title = quote.number;
    return () => {
      document.title = before;
    };
  }, [quote]);

  if (!quote || !setup)
    return (
      <>
        <PageHeader title="Quotation" crumbs={[{ label: 'Quotations', to: '/billing/quotations' }]} />
        <Card>
          <EmptyState icon={NotePencilIcon} title={quote === null ? 'This quotation doesn’t exist' : 'Loading…'} />
        </Card>
      </>
    );

  const state = quotationState(quote, localDay());
  const settings = setup.settings;
  const paper = settings.paperSize;
  const editable = ['draft', 'sent'].includes(quote.status);
  const convertible = !quote.invoiceId && ['draft', 'sent', 'accepted', 'expired'].includes(quote.status);

  const mark = async (to: 'sent' | 'accepted' | 'cancelled') => {
    setBusy(to);
    setConfirm(null);
    try {
      const answer = await api<{ quotations: Quotation[] }>(`/billing/quotations/${quote.id}/status`, 'POST', { to, version: quote.version });
      setQuote(answer.quotations[0]!);
      toast({ message: `${quote.number} marked ${QUOTATION_STATUS[to].label.toLowerCase()}.` });
    } catch (problem) {
      toast({ tone: 'error', message: problem instanceof Error ? problem.message : 'Something went wrong.' });
    } finally {
      setBusy(null);
    }
  };
  const convert = async () => {
    setBusy('convert');
    setConfirm(null);
    try {
      const answer = await api<{ invoices: SalesInvoice[] }>(`/billing/quotations/${quote.id}/convert`, 'POST', { version: quote.version });
      await api('/activity', 'POST', { area: 'orders', summary: `Made a bill from quotation ${quote.number} for ${quote.customerName}`, to: `/billing/${answer.invoices[0]!.id}` }).catch(() => null);
      toast({ message: 'A draft bill is ready: check it and finalize.' });
      navigate(`/billing/${answer.invoices[0]!.id}/edit`);
    } catch (problem) {
      toast({ tone: 'error', message: problem instanceof Error ? problem.message : 'Couldn’t convert it.' });
      setBusy(null);
    }
  };
  const share = () => {
    const text = [
      `Dear ${quote.customerName},`,
      `Quotation ${quote.number} dated ${invoiceDay(quote.quoteDate)}: ${formatMoney(quote.total)} for ${quote.items.filter((item) => item.lineType !== 'charge').length} items.`,
      quote.validUntil ? `Valid until ${invoiceDay(quote.validUntil)}.` : '',
      settings.tradeName || settings.legalName,
    ].filter(Boolean);
    window.open(`${quote.customerPhone ? whatsappLink(quote.customerPhone) : 'https://wa.me/'}?text=${encodeURIComponent(text.join('\n'))}`, '_blank', 'noopener');
    if (quote.status === 'draft' && maker) void mark('sent');
  };

  return (
    <>
      <style>{pageRule(paper)}</style>
      <PageHeader
        title={`Quotation ${quote.number}`}
        crumbs={[{ label: 'Quotations', to: '/billing/quotations' }]}
        description={
          <span className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <Badge tone={QUOTATION_STATUS[state].tone}>{QUOTATION_STATUS[state].label}</Badge>
            <span>
              {quote.customerName} · {formatMoney(quote.total)} · made by {quote.createdBy} {formatDateTime(quote.createdAt)}
              {quote.invoiceId && (
                <>
                  {' · bill '}
                  <Link to={`/billing/${quote.invoiceId}`}>{quote.invoiceNumber ?? 'draft'}</Link>
                </>
              )}
            </span>
          </span>
        }
        actions={
          <span className="row no-print" style={{ gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            {maker && convertible && (
              <Button variant="primary" icon={ArrowRightIcon} loading={busy === 'convert'} onClick={() => setConfirm('convert')}>
                Convert to Invoice
              </Button>
            )}
            {maker && editable && (
              <ButtonLink to={`/billing/quotations/${quote.id}/edit`} icon={PencilSimpleIcon}>
                Edit
              </ButtonLink>
            )}
            {maker && quote.status === 'draft' && (
              <Button icon={PaperPlaneTiltIcon} loading={busy === 'sent'} onClick={() => mark('sent')}>
                Mark Sent
              </Button>
            )}
            {maker && ['draft', 'sent'].includes(quote.status) && (
              <Button icon={CheckIcon} loading={busy === 'accepted'} onClick={() => mark('accepted')}>
                Mark Accepted
              </Button>
            )}
            <Button icon={PrinterIcon} onClick={() => window.print()}>
              Print
            </Button>
            <Button icon={FilePdfIcon} onClick={() => window.print()} title="Choose Save as PDF in the print window">
              PDF
            </Button>
            <Button icon={ChatCircleTextIcon} onClick={share}>
              WhatsApp
            </Button>
            {maker && ['draft', 'sent', 'accepted', 'expired'].includes(quote.status) && (
              <Button variant="danger-plain" icon={XCircleIcon} onClick={() => setConfirm('cancelled')}>
                Cancel
              </Button>
            )}
          </span>
        }
      />
      <BillDocument invoice={asInvoice(quote)} settings={settings} company={db.settings} quote={{ validUntil: quote.validUntil }} />
      <ConfirmDialog
        open={confirm === 'convert'}
        title={`Make a bill from ${quote.number}?`}
        body={`A draft bill dated today with the same customer and lines (${formatMoney(quote.total)}). Rates and discounts are checked again; nothing leaves stock until you finalize it.`}
        confirmLabel="Convert to Invoice"
        onCancel={() => setConfirm(null)}
        onConfirm={convert}
      />
      <ConfirmDialog
        open={confirm === 'cancelled'}
        title={`Cancel ${quote.number}?`}
        body="It stays in the list as cancelled, and can’t be converted afterwards."
        confirmLabel="Cancel Quotation"
        destructive
        onCancel={() => setConfirm(null)}
        onConfirm={() => mark('cancelled')}
      />
    </>
  );
}
