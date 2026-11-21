import { CheckCircleIcon, PrinterIcon, ReceiptIcon, TrashIcon, WarningCircleIcon, XCircleIcon } from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

import { Badge } from '@/components/Badge';
import { Button, ButtonLink } from '@/components/Button';
import { Card, CardHeader } from '@/components/Card';
import { ConfirmDialog } from '@/components/Dialog';
import { Drawer } from '@/components/Drawer';
import { EmptyState } from '@/components/EmptyState';
import { SelectField, TextAreaField, TextField } from '@/components/Field';
import { PageHeader } from '@/components/PageHeader';
import { useToast } from '@/components/useToast';
import { INVOICE_STATUS } from '@/data/gst';
import { GSTIN, GST_STATES, STATES, stateOfGstin } from '@/data/india';
import { dayLabel, localDay } from '@/data/payments';
import { formatMoney, parseMoney, r2 } from '@/data/purchases';
import { GST_RATES, UNITS } from '@/data/stock';
import type { GstSettings, SalesInvoice, StockUnit } from '@/data/types';
import { useData } from '@/data/useData';
import { useGst } from '@/hooks/useGst';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { rupeesInWords } from '@/lib/words';

type Line = { productId: string; option: string; description: string; hsn: string; qty: string; unit: StockUnit; amount: string; gstRate: string };
type Draft = { invoiceDate: string; customerName: string; customerGstin: string; billingAddress: string; placeOfSupply: string; notes: string; lines: Line[] };

const draftOf = (invoice: SalesInvoice): Draft => ({
  invoiceDate: invoice.invoiceDate,
  customerName: invoice.customerName,
  customerGstin: invoice.customerGstin ?? '',
  billingAddress: invoice.billingAddress ?? '',
  placeOfSupply: invoice.placeOfSupply ?? '',
  notes: invoice.notes ?? '',
  lines: invoice.items.map((item) => ({ productId: item.productId, option: item.option, description: item.description, hsn: item.hsn, qty: String(item.qty), unit: item.unit, amount: String(item.amount), gstRate: String(item.gstRate) })),
});

const codeOfState = (state: string) => Object.entries(GST_STATES).find(([, name]) => name.toLowerCase() === state.trim().toLowerCase())?.[0] ?? '';

/** Each line's tax from its GST-inclusive amount, as the server works it out (server/src/gst.ts taxLines). */
function preview(draft: Draft, sellerGstin: string) {
  const own = GSTIN.test(sellerGstin) ? sellerGstin.slice(0, 2) : '';
  const pos = GSTIN.test(draft.customerGstin.toUpperCase()) && stateOfGstin(draft.customerGstin.toUpperCase()) ? draft.customerGstin.slice(0, 2) : codeOfState(draft.placeOfSupply);
  const interstate = Boolean(own && pos && own !== pos);
  const lines = draft.lines.map((line) => {
    const amount = parseMoney(line.amount) || 0;
    const rate = Number(line.gstRate) || 0;
    const taxable = r2(amount / (1 + rate / 100));
    const tax = r2(amount - taxable);
    const cgst = interstate ? 0 : r2(tax / 2);
    return { amount, taxable, cgst, sgst: interstate ? 0 : r2(tax - cgst), igst: interstate ? tax : 0 };
  });
  const exact = r2(lines.reduce((total, line) => total + line.amount, 0));
  const sum = (key: 'taxable' | 'cgst' | 'sgst' | 'igst') => r2(lines.reduce((total, line) => total + line[key], 0));
  return { pos, interstate, lines, taxable: sum('taxable'), cgst: sum('cgst'), sgst: sum('sgst'), igst: sum('igst'), roundOff: r2(Math.round(exact) - exact), total: Math.round(exact) };
}

export default function InvoicePage() {
  const { id } = useParams();
  const { data, error, keepInvoices } = useGst();
  const invoice = data?.invoices.find((one) => one.id === id);
  if (!data)
    return (
      <>
        <PageHeader title="Invoice" crumbs={[{ label: 'Sales Register', to: '/gst/sales' }]} />
        <Card>
          <EmptyState icon={ReceiptIcon} title={error ? 'Couldn’t load the invoice' : 'Loading…'}>
            {error}
          </EmptyState>
        </Card>
      </>
    );
  if (!invoice)
    return (
      <>
        <PageHeader title="Invoice not found" crumbs={[{ label: 'Sales Register', to: '/gst/sales' }]} />
        <Card>
          <EmptyState icon={ReceiptIcon} title="This invoice doesn’t exist" action={<ButtonLink to="/gst/sales" variant="primary">Back to the Sales Register</ButtonLink>}>
            It may have been a draft that was deleted.
          </EmptyState>
        </Card>
      </>
    );
  return invoice.status === 'draft' ? <DraftEditor key={invoice.id} invoice={invoice} settings={data.settings} onSaved={keepInvoices} /> : <PostedInvoice invoice={invoice} settings={data.settings} onSaved={keepInvoices} />;
}

function DraftEditor({ invoice, settings, onSaved }: { invoice: SalesInvoice; settings: GstSettings; onSaved: (fresh?: SalesInvoice[], removed?: string[]) => void }) {
  const toast = useToast();
  const navigate = useNavigate();
  const { db } = useData();
  const [draft, setDraft] = useState<Draft>(() => draftOf(invoice));
  const [saving, setSaving] = useState<'save' | 'post' | null>(null);
  const [confirmPost, setConfirmPost] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [touched, setTouched] = useState(false);
  const figures = useMemo(() => preview(draft, settings.gstin), [draft, settings.gstin]);
  const set = <K extends keyof Draft>(field: K, value: Draft[K]) => setDraft((current) => ({ ...current, [field]: value }));
  const setLine = (index: number, patch: Partial<Line>) => set('lines', draft.lines.map((line, at) => (at === index ? { ...line, ...patch } : line)));
  const dirty = JSON.stringify(draft) !== JSON.stringify(draftOf(invoice));
  const order = db.orders.find((one) => one.id === invoice.orderId);

  const gstin = draft.customerGstin.trim().toUpperCase();
  const errors: Record<string, string | null> = {
    customerName: draft.customerName.trim() ? null : 'Enter the buyer’s name.',
    customerGstin: gstin && !GSTIN.test(gstin) ? 'Enter the 15-character GSTIN, e.g. 27AAPFU0939F1ZV.' : null,
    placeOfSupply: figures.pos ? null : 'Choose the buyer’s state: the place of supply.',
    invoiceDate: !/^\d{4}-\d{2}-\d{2}$/.test(draft.invoiceDate) ? 'Pick the invoice date.' : draft.invoiceDate > localDay() ? 'The date can’t be in the future.' : null,
    ...Object.fromEntries(
      draft.lines.flatMap((line, index) => [
        [`line-${index}-amount`, Number.isNaN(parseMoney(line.amount)) || (parseMoney(line.amount) || 0) <= 0 ? 'Enter what the buyer pays for this line, GST included.' : null],
        [`line-${index}-hsn`, /^(\d{4}|\d{6}|\d{8})?$/.test(line.hsn.trim()) ? null : 'HSN is 4, 6 or 8 digits.'],
      ]),
    ),
  };
  const firstError = Object.entries(errors).find(([, message]) => message);
  const missingHsn = draft.lines.filter((line) => !line.hsn.trim()).length;
  const shown = (key: string) => (touched ? errors[key] : null);

  const body = () => ({
    invoiceDate: draft.invoiceDate,
    customerName: draft.customerName.trim(),
    customerGstin: gstin,
    billingAddress: draft.billingAddress.trim(),
    placeOfSupply: figures.pos ? GST_STATES[figures.pos]! : draft.placeOfSupply.trim(),
    notes: draft.notes.trim(),
    items: draft.lines.map((line) => ({ productId: line.productId, option: line.option, description: line.description.trim(), hsn: line.hsn.trim(), qty: Number(line.qty), unit: line.unit, amount: parseMoney(line.amount) || 0, gstRate: Number(line.gstRate) })),
  });

  const save = async (post: boolean) => {
    setTouched(true);
    setConfirmPost(false);
    if (firstError && (post || firstError[0] !== 'placeOfSupply')) {
      toast({ tone: 'error', message: firstError[1]! });
      return;
    }
    setSaving(post ? 'post' : 'save');
    try {
      const saved = await api<{ invoices: SalesInvoice[] }>(`/gst/invoices/${invoice.id}`, 'PUT', body());
      onSaved(saved.invoices);
      if (post) {
        const posted = await api<{ invoices: SalesInvoice[] }>(`/gst/invoices/${invoice.id}/post`, 'POST');
        onSaved(posted.invoices);
        await api('/activity', 'POST', { area: 'orders', summary: `Posted tax invoice ${posted.invoices[0]!.number} for ${invoice.orderNumber} (${formatMoney(posted.invoices[0]!.total)})`, to: `/gst/invoices/${invoice.id}` }).catch(() => null);
        toast({ message: `Invoice ${posted.invoices[0]!.number} posted.` });
      } else toast({ message: 'Draft saved.' });
    } catch (problem) {
      toast({ tone: 'error', message: problem instanceof Error ? problem.message : 'Something went wrong.' });
    } finally {
      setSaving(null);
    }
  };

  const remove = async () => {
    setConfirmDelete(false);
    try {
      await api(`/gst/invoices/${invoice.id}`, 'DELETE');
      onSaved([], [invoice.id]);
      toast({ message: 'Draft deleted.' });
      navigate('/gst/sales?status=draft', { replace: true });
    } catch (problem) {
      toast({ tone: 'error', message: problem instanceof Error ? problem.message : 'Couldn’t delete it.' });
    }
  };

  return (
    <>
      <PageHeader
        title="Draft invoice"
        crumbs={[{ label: 'Sales Register', to: '/gst/sales' }]}
        description={
          <>
            From order <Link to={`/orders/${invoice.orderId}`}>{invoice.orderNumber}</Link>. Check the buyer, HSN and rates, then post it: posting gives it the next number.
          </>
        }
        actions={
          <Button variant="danger-plain" icon={TrashIcon} onClick={() => setConfirmDelete(true)}>
            Delete Draft
          </Button>
        }
      />
      {!settings.gstin && (
        <p className="notice notice--warning" style={{ marginBottom: 'var(--space-4)' }}>
          <WarningCircleIcon size={16} weight="bold" aria-hidden />
          <span>
            The shop’s GSTIN isn’t set, so the tax split can’t be worked out and the invoice can’t be posted. <Link to="/gst/settings">Fill in GST Settings</Link>.
          </span>
        </p>
      )}
      <div className="editor">
        <div className="stack">
          <Card aria-labelledby="buyer-title">
            <CardHeader id="buyer-title" title="Buyer" description="As it will print. A GSTIN makes it a B2B invoice and sets the place of supply." />
            <div className="card__body form-grid">
              <TextField label="Buyer’s name" required value={draft.customerName} onChange={(event) => set('customerName', event.target.value)} error={shown('customerName')} maxLength={150} />
              <TextField
                label="Buyer’s GSTIN"
                value={draft.customerGstin}
                onChange={(event) => {
                  const value = event.target.value.toUpperCase();
                  const state = value.length >= 2 ? stateOfGstin(value) : undefined;
                  setDraft((current) => ({ ...current, customerGstin: value, placeOfSupply: state ?? current.placeOfSupply }));
                }}
                error={shown('customerGstin')}
                maxLength={15}
                hint="Empty for an unregistered buyer (B2C)."
                spellCheck={false}
              />
              <TextAreaField className="span-2" label="Billing address" value={draft.billingAddress} onChange={(event) => set('billingAddress', event.target.value)} rows={2} maxLength={500} />
              <SelectField
                label="Place of supply"
                value={figures.pos ? GST_STATES[figures.pos]! : draft.placeOfSupply}
                onChange={(event) => set('placeOfSupply', event.target.value)}
                error={shown('placeOfSupply')}
                options={[{ value: '', label: 'Choose the buyer’s state…' }, ...STATES.map((state) => ({ value: state, label: `${state} (${codeOfState(state)})` }))]}
                hint={figures.interstate ? 'Another state: IGST.' : figures.pos ? 'Same state as the shop: CGST + SGST.' : undefined}
              />
              <TextField label="Invoice date" type="date" max={localDay()} value={draft.invoiceDate} onChange={(event) => set('invoiceDate', event.target.value)} error={shown('invoiceDate')} />
            </div>
          </Card>

          <Card aria-labelledby="lines-title" className="table-card">
            <CardHeader id="lines-title" title="Lines" description="Amounts are what the buyer pays, GST included; the order’s bill was shared over them. HSN and rate come from Stock." />
            <div className="table-scroll">
              <table className="table bill-lines">
                <caption className="visually-hidden">Invoice lines</caption>
                <thead>
                  <tr>
                    <th scope="col">Description</th>
                    <th scope="col">HSN</th>
                    <th scope="col">Qty</th>
                    <th scope="col">GST</th>
                    <th scope="col">Amount (₹)</th>
                    <th scope="col" className="is-num">
                      Taxable
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {draft.lines.map((line, index) => (
                    <tr key={`${line.productId}-${line.option}-${index}`}>
                      <td>
                        <input className="input" aria-label={`Description of line ${index + 1}`} value={line.description} onChange={(event) => setLine(index, { description: event.target.value })} style={{ minWidth: 220 }} />
                        {(shown(`line-${index}-amount`) || shown(`line-${index}-hsn`)) && (
                          <p className="field__error" role="alert">
                            {shown(`line-${index}-amount`) ?? shown(`line-${index}-hsn`)}
                          </p>
                        )}
                      </td>
                      <td>
                        <input className="input" aria-label={`HSN of line ${index + 1}`} inputMode="numeric" value={line.hsn} onChange={(event) => setLine(index, { hsn: event.target.value })} placeholder="8302" style={{ width: 92 }} />
                      </td>
                      <td className="num" style={{ whiteSpace: 'nowrap' }}>
                        {line.qty} {UNITS[line.unit]}
                      </td>
                      <td>
                        <select className="select" aria-label={`GST rate of line ${index + 1}`} value={line.gstRate} onChange={(event) => setLine(index, { gstRate: event.target.value })} style={{ width: 92 }}>
                          {GST_RATES.map((rate) => (
                            <option key={rate} value={String(rate)}>
                              {rate}%
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input className="input" aria-label={`Amount of line ${index + 1}, GST included`} inputMode="decimal" value={line.amount} onChange={(event) => setLine(index, { amount: event.target.value })} style={{ width: 120 }} />
                      </td>
                      <td className="is-num">
                        {formatMoney(figures.lines[index]!.taxable)}
                        <div className="cell-sub">+ {formatMoney(figures.lines[index]!.cgst + figures.lines[index]!.sgst + figures.lines[index]!.igst)} GST</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {missingHsn > 0 && <p className="card__body field__hint">{missingHsn === 1 ? 'One line has' : `${missingHsn} lines have`} no HSN. GST invoices need it: add it here, or under Stock for next time.</p>}
          </Card>

          <Card aria-labelledby="notes-title">
            <CardHeader id="notes-title" title="Notes" />
            <div className="card__body">
              <TextAreaField label="Printed under the lines" value={draft.notes} onChange={(event) => set('notes', event.target.value)} rows={2} maxLength={1000} placeholder="e.g. Transport: VRL Logistics, LR 4471" />
            </div>
          </Card>
        </div>

        <div className="stack editor__aside">
          <Card aria-labelledby="draft-total">
            <CardHeader id="draft-total" title="Total" />
            <div className="card__body stack">
              <dl className="kv kv--compact kv--split" style={{ margin: 0 }}>
                <dt>Taxable value</dt>
                <dd className="num">{formatMoney(figures.taxable)}</dd>
                {figures.interstate ? (
                  <>
                    <dt>IGST</dt>
                    <dd className="num">{formatMoney(figures.igst)}</dd>
                  </>
                ) : (
                  <>
                    <dt>CGST</dt>
                    <dd className="num">{formatMoney(figures.cgst)}</dd>
                    <dt>SGST</dt>
                    <dd className="num">{formatMoney(figures.sgst)}</dd>
                  </>
                )}
                {figures.roundOff !== 0 && (
                  <>
                    <dt>Round off</dt>
                    <dd className="num">{formatMoney(figures.roundOff)}</dd>
                  </>
                )}
                <dt style={{ fontWeight: 600, color: 'var(--text)' }}>Total</dt>
                <dd className="num" style={{ fontWeight: 700, fontSize: 'var(--text-lg)' }}>
                  {formatMoney(figures.total)}
                </dd>
              </dl>
              {order && figures.total !== (order.bill ?? order.total) && (
                <p className="field__hint" style={{ margin: 0 }}>
                  Posting makes this the order’s bill (now {formatMoney(order.bill ?? order.total)}), so payments follow the invoice.
                </p>
              )}
              <Button variant="primary" icon={CheckCircleIcon} block loading={saving === 'post'} disabled={saving !== null} onClick={() => setConfirmPost(true)}>
                Post Invoice
              </Button>
              <Button block loading={saving === 'save'} disabled={saving !== null || !dirty} onClick={() => save(false)}>
                Save Draft
              </Button>
            </div>
          </Card>
        </div>
      </div>

      <ConfirmDialog
        open={confirmPost}
        title="Post this invoice?"
        body={`It gets the next number in the ${settings.invoicePrefix || 'invoice'} series for this financial year, and can’t be edited after: to correct it, you cancel it. Total ${formatMoney(figures.total)}.`}
        confirmLabel="Post Invoice"
        onCancel={() => setConfirmPost(false)}
        onConfirm={() => save(true)}
      />
      <ConfirmDialog open={confirmDelete} title="Delete this draft?" body="It has no number yet, so nothing else changes. You can make it again from the order." confirmLabel="Delete Draft" destructive onCancel={() => setConfirmDelete(false)} onConfirm={remove} />
    </>
  );
}

function PostedInvoice({ invoice, settings, onSaved }: { invoice: SalesInvoice; settings: GstSettings; onSaved: (fresh?: SalesInvoice[]) => void }) {
  const toast = useToast();
  const { db } = useData();
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const cancelled = invoice.status === 'cancelled';
  const tax = r2(invoice.cgst + invoice.sgst + invoice.igst);

  const cancel = async () => {
    if (!reason.trim()) return;
    setBusy(true);
    try {
      const answer = await api<{ invoices: SalesInvoice[] }>(`/gst/invoices/${invoice.id}/cancel`, 'POST', { reason: reason.trim() });
      onSaved(answer.invoices);
      await api('/activity', 'POST', { area: 'orders', summary: `Cancelled tax invoice ${invoice.number}: ${reason.trim()}`, to: `/gst/invoices/${invoice.id}` }).catch(() => null);
      toast({ message: `Invoice ${invoice.number} cancelled. Its number stays used.` });
      setCancelling(false);
    } catch (problem) {
      toast({ tone: 'error', message: problem instanceof Error ? problem.message : 'Couldn’t cancel it.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title={`Invoice ${invoice.number}`}
        crumbs={[{ label: 'Sales Register', to: '/gst/sales' }]}
        description={
          <>
            <Badge tone={INVOICE_STATUS[invoice.status].tone}>{INVOICE_STATUS[invoice.status].label}</Badge> · order <Link to={`/orders/${invoice.orderId}`}>{invoice.orderNumber}</Link>
            {invoice.postedAt && ` · posted ${formatDateTime(invoice.postedAt)} by ${invoice.postedBy}`}
          </>
        }
        actions={
          <>
            <Button icon={PrinterIcon} onClick={() => window.print()} className="no-print">
              Print
            </Button>
            {!cancelled && (
              <Button variant="danger-plain" icon={XCircleIcon} onClick={() => setCancelling(true)} className="no-print">
                Cancel Invoice
              </Button>
            )}
          </>
        }
      />
      {cancelled && (
        <p className="notice notice--warning no-print" style={{ marginBottom: 'var(--space-4)' }}>
          <XCircleIcon size={16} weight="bold" aria-hidden />
          <span>
            Cancelled {invoice.cancelledAt ? formatDateTime(invoice.cancelledAt) : ''} by {invoice.cancelledBy}: {invoice.cancelReason}. It stays in the register as cancelled; the order can be invoiced again.
          </span>
        </p>
      )}

      <article className="tax-invoice card" aria-label={`Tax invoice ${invoice.number}`}>
        <header className="tax-invoice__head">
          <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
            <img src={db.settings.logo} alt="" width={44} height={44} />
            <div>
              <strong style={{ fontSize: 16 }}>{settings.legalName || db.settings.companyName}</strong>
              {settings.tradeName && settings.tradeName !== settings.legalName && <div>Trade name: {settings.tradeName}</div>}
              <div style={{ whiteSpace: 'pre-line' }}>{[settings.address, settings.pincode].filter(Boolean).join(' ')}</div>
              <div>GSTIN: {invoice.sellerGstin}</div>
              <div>{[db.settings.phone, db.settings.email].filter(Boolean).join(' · ')}</div>
            </div>
          </div>
          <div className="tax-invoice__title">
            <strong>{cancelled ? 'TAX INVOICE (CANCELLED)' : 'TAX INVOICE'}</strong>
            <div>Original for recipient</div>
            <dl>
              <dt>Invoice no.</dt>
              <dd>{invoice.number}</dd>
              <dt>Date</dt>
              <dd>{dayLabel(invoice.invoiceDate)}</dd>
              <dt>Place of supply</dt>
              <dd>
                {invoice.placeOfSupply} ({invoice.posCode})
              </dd>
              <dt>Reverse charge</dt>
              <dd>No</dd>
            </dl>
          </div>
        </header>

        <section className="tax-invoice__buyer">
          <div className="field__label">Bill to</div>
          <strong>{invoice.customerName}</strong>
          {invoice.billingAddress && <div style={{ whiteSpace: 'pre-line' }}>{invoice.billingAddress}</div>}
          <div>{invoice.customerGstin ? `GSTIN: ${invoice.customerGstin}` : 'Unregistered buyer'}</div>
        </section>

        <table className="table tax-invoice__lines">
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Description</th>
              <th scope="col">HSN</th>
              <th scope="col" className="is-num">
                Qty
              </th>
              <th scope="col" className="is-num">
                Rate
              </th>
              <th scope="col" className="is-num">
                Taxable
              </th>
              <th scope="col" className="is-num">
                GST %
              </th>
              {invoice.interstate ? (
                <th scope="col" className="is-num">
                  IGST
                </th>
              ) : (
                <>
                  <th scope="col" className="is-num">
                    CGST
                  </th>
                  <th scope="col" className="is-num">
                    SGST
                  </th>
                </>
              )}
              <th scope="col" className="is-num">
                Amount
              </th>
            </tr>
          </thead>
          <tbody>
            {invoice.items.map((item, index) => (
              <tr key={index}>
                <td>{index + 1}</td>
                <td>{item.description}</td>
                <td className="mono">{item.hsn || '—'}</td>
                <td className="is-num">
                  {item.qty} {UNITS[item.unit]}
                </td>
                <td className="is-num">{formatMoney(r2(item.taxable / item.qty))}</td>
                <td className="is-num">{formatMoney(item.taxable)}</td>
                <td className="is-num">{item.gstRate}%</td>
                {invoice.interstate ? (
                  <td className="is-num">{formatMoney(item.igst)}</td>
                ) : (
                  <>
                    <td className="is-num">{formatMoney(item.cgst)}</td>
                    <td className="is-num">{formatMoney(item.sgst)}</td>
                  </>
                )}
                <td className="is-num">{formatMoney(item.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <footer className="tax-invoice__foot">
          <div>
            <div className="field__label">Amount in words</div>
            <div>{rupeesInWords(invoice.total)}</div>
            {invoice.notes && <p style={{ whiteSpace: 'pre-line' }}>{invoice.notes}</p>}
            {settings.terms && (
              <>
                <div className="field__label" style={{ marginTop: 12 }}>
                  Terms
                </div>
                <div style={{ whiteSpace: 'pre-line' }}>{settings.terms}</div>
              </>
            )}
          </div>
          <div>
            <dl className="kv kv--compact kv--split" style={{ margin: 0 }}>
              <dt>Taxable value</dt>
              <dd className="num">{formatMoney(invoice.taxable)}</dd>
              {invoice.interstate ? (
                <>
                  <dt>IGST</dt>
                  <dd className="num">{formatMoney(invoice.igst)}</dd>
                </>
              ) : (
                <>
                  <dt>CGST</dt>
                  <dd className="num">{formatMoney(invoice.cgst)}</dd>
                  <dt>SGST</dt>
                  <dd className="num">{formatMoney(invoice.sgst)}</dd>
                </>
              )}
              <dt>Total GST</dt>
              <dd className="num">{formatMoney(tax)}</dd>
              {invoice.roundOff !== 0 && (
                <>
                  <dt>Round off</dt>
                  <dd className="num">{formatMoney(invoice.roundOff)}</dd>
                </>
              )}
              <dt style={{ fontWeight: 700, color: 'var(--text)' }}>Invoice total</dt>
              <dd className="num" style={{ fontWeight: 700 }}>
                {formatMoney(invoice.total)}
              </dd>
            </dl>
            <div className="tax-invoice__sign">
              For {settings.legalName || db.settings.companyName}
              <br />
              <br />
              Authorised signatory
            </div>
          </div>
        </footer>
      </article>

      <Drawer
        open={cancelling}
        title={`Cancel invoice ${invoice.number}?`}
        description="It stays in the register as cancelled and keeps its number; the order’s bill unlocks and the order can be invoiced again."
        dirty={Boolean(reason.trim())}
        onClose={() => setCancelling(false)}
        onSubmit={() => (reason.trim() ? void cancel() : toast({ tone: 'error', message: 'Give the reason for cancelling.' }))}
        footer={
          <>
            <Button onClick={() => setCancelling(false)}>Keep It</Button>
            <Button type="submit" variant="danger" loading={busy}>
              Cancel Invoice
            </Button>
          </>
        }
      >
        <div className="stack">
          <TextField label="Reason for cancelling" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={300} placeholder="e.g. Wrong buyer GSTIN" required />
          <p className="field__hint" style={{ margin: 0 }}>
            If the goods were delivered and paid for, a credit note may be what’s needed instead: ask your accountant.
          </p>
        </div>
      </Drawer>
    </>
  );
}
