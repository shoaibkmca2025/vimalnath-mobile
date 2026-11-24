import { CheckCircleIcon, CopyIcon, PercentIcon, PrinterIcon, ReceiptIcon, TrashIcon, WarningCircleIcon, XCircleIcon } from '@phosphor-icons/react';
import { useMemo, useState, type ReactNode } from 'react';
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
import { INVOICE_STATUS, PRINT_UNIT, computeInvoice, invoiceAmount, invoiceDay, invoiceHsnTable, invoiceTaxRows } from '@/data/gst';
import { GSTIN, GST_STATES, STATES, stateOfGstin } from '@/data/india';
import { localDay } from '@/data/payments';
import { formatMoney, parseMoney, r2 } from '@/data/purchases';
import { GST_RATES, UNITS } from '@/data/stock';
import type { GstSettings, InvoiceDetails, SalesInvoice, StockUnit } from '@/data/types';
import { useData } from '@/data/useData';
import { useGst } from '@/hooks/useGst';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { rupeesInWords } from '@/lib/words';

const DETAIL_KEYS = [
  'buyerContact',
  'buyerPhone',
  'buyerEmail',
  'shipName',
  'shipAddress',
  'shipGstin',
  'shipState',
  'shipContact',
  'shipPhone',
  'shipEmail',
  'deliveryNote',
  'paymentTerms',
  'reference',
  'otherReferences',
  'buyerOrderNo',
  'buyerOrderDate',
  'dispatchDocNo',
  'deliveryNoteDate',
  'dispatchedThrough',
  'destination',
  'deliveryTerms',
] as const satisfies readonly (keyof InvoiceDetails)[];
type Details = Record<(typeof DETAIL_KEYS)[number], string>;

type Line = { productId: string; option: string; description: string; detail: string; hsn: string; qty: string; unit: StockUnit; rate: string; discountPct: string; gstRate: string };
type Draft = { invoiceDate: string; customerName: string; customerGstin: string; billingAddress: string; placeOfSupply: string; notes: string; details: Details; lines: Line[] };

const detailsOf = (details: InvoiceDetails | undefined) => Object.fromEntries(DETAIL_KEYS.map((key) => [key, details?.[key] ?? ''])) as Details;

const draftOf = (invoice: SalesInvoice): Draft => ({
  invoiceDate: invoice.invoiceDate,
  customerName: invoice.customerName,
  customerGstin: invoice.customerGstin ?? '',
  billingAddress: invoice.billingAddress ?? '',
  placeOfSupply: invoice.placeOfSupply ?? '',
  notes: invoice.notes ?? '',
  details: detailsOf(invoice.details),
  lines: invoice.items.map((item) => ({
    productId: item.productId,
    option: item.option,
    description: item.description,
    detail: item.detail ?? '',
    hsn: item.hsn,
    qty: String(item.qty),
    unit: item.unit,
    rate: String(item.rate),
    discountPct: String(item.discountPct ?? 0),
    gstRate: String(item.gstRate),
  })),
});

const codeOfState = (state: string) => Object.entries(GST_STATES).find(([, name]) => name.toLowerCase() === state.trim().toLowerCase())?.[0] ?? '';
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** A typed rate or discount, or NaN; empty is 0. */
const numberIn = (text: string) => parseMoney(text);
const known = (value: number) => (Number.isNaN(value) ? 0 : value);

/** The figures as the server will post them (server/src/gst.ts computeInvoice): rate less discount, GST on top. */
function preview(draft: Draft, sellerGstin: string) {
  const own = GSTIN.test(sellerGstin) ? sellerGstin.slice(0, 2) : '';
  const gstin = draft.customerGstin.trim().toUpperCase();
  const pos = GSTIN.test(gstin) && stateOfGstin(gstin) ? gstin.slice(0, 2) : codeOfState(draft.placeOfSupply);
  const interstate = Boolean(own && pos && own !== pos);
  const items = draft.lines.map((line) => ({
    qty: Number(line.qty) || 0,
    rate: Math.max(0, known(numberIn(line.rate))),
    discountPct: Math.min(100, Math.max(0, known(numberIn(line.discountPct)))),
    gstRate: Number(line.gstRate) || 0,
  }));
  return { pos, interstate, ...computeInvoice(items, interstate) };
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
  const [everyDiscount, setEveryDiscount] = useState('');
  const figures = useMemo(() => preview(draft, settings.gstin), [draft, settings.gstin]);
  const taxRows = invoiceTaxRows(figures.lines, figures.interstate);
  const set = <K extends keyof Draft>(field: K, value: Draft[K]) => setDraft((current) => ({ ...current, [field]: value }));
  const setDetail = (key: keyof Details, value: string) => setDraft((current) => ({ ...current, details: { ...current.details, [key]: value } }));
  const setLine = (index: number, patch: Partial<Line>) => setDraft((current) => ({ ...current, lines: current.lines.map((line, at) => (at === index ? { ...line, ...patch } : line)) }));
  const dirty = JSON.stringify(draft) !== JSON.stringify(draftOf(invoice));
  const order = db.orders.find((one) => one.id === invoice.orderId);

  const gstin = draft.customerGstin.trim().toUpperCase();
  const shipGstin = draft.details.shipGstin.trim().toUpperCase();
  const email = (value: string) => (value.trim() && !EMAIL.test(value.trim()) ? 'Enter an e-mail like name@example.com.' : null);
  const errors: Record<string, string | null> = {
    customerName: draft.customerName.trim() ? null : 'Enter the buyer’s name.',
    customerGstin: gstin && !GSTIN.test(gstin) ? 'Enter the 15-character GSTIN, e.g. 27AAPFU0939F1ZV.' : null,
    placeOfSupply: figures.pos ? null : 'Choose the buyer’s state: the place of supply.',
    invoiceDate: !/^\d{4}-\d{2}-\d{2}$/.test(draft.invoiceDate) ? 'Pick the invoice date.' : draft.invoiceDate > localDay() ? 'The date can’t be in the future.' : null,
    buyerEmail: email(draft.details.buyerEmail),
    shipGstin: shipGstin && !GSTIN.test(shipGstin) ? 'Enter the 15-character GSTIN, or leave it empty.' : null,
    shipEmail: email(draft.details.shipEmail),
    ...Object.fromEntries(
      draft.lines.flatMap((line, index) => {
        const rate = numberIn(line.rate);
        const discount = numberIn(line.discountPct);
        return [
          [`line-${index}-description`, line.description.trim() ? null : 'Describe this line.'],
          [`line-${index}-rate`, Number.isNaN(rate) || rate <= 0 ? 'Enter the rate per unit, before GST.' : null],
          [`line-${index}-discount`, Number.isNaN(discount) || discount < 0 || discount > 100 ? 'The discount is 0 to 100%.' : null],
          [`line-${index}-hsn`, /^(\d{4}|\d{6}|\d{8})?$/.test(line.hsn.trim()) ? null : 'HSN is 4, 6 or 8 digits.'],
        ];
      }),
    ),
  };
  const firstError = Object.entries(errors).find(([, message]) => message);
  const missingHsn = draft.lines.filter((line) => !line.hsn.trim()).length;
  const shown = (key: string) => (touched ? errors[key] : null);
  const lineError = (index: number) => ['description', 'rate', 'discount', 'hsn'].map((part) => shown(`line-${index}-${part}`)).find(Boolean);

  const body = () => ({
    invoiceDate: draft.invoiceDate,
    customerName: draft.customerName.trim(),
    customerGstin: gstin,
    billingAddress: draft.billingAddress.trim(),
    placeOfSupply: figures.pos ? GST_STATES[figures.pos]! : draft.placeOfSupply.trim(),
    notes: draft.notes.trim(),
    details: { ...Object.fromEntries(DETAIL_KEYS.map((key) => [key, draft.details[key].trim()])), shipGstin },
    items: draft.lines.map((line) => ({
      productId: line.productId,
      option: line.option,
      description: line.description.trim(),
      detail: line.detail.trim(),
      hsn: line.hsn.trim(),
      qty: Number(line.qty),
      unit: line.unit,
      rate: known(numberIn(line.rate)),
      discountPct: known(numberIn(line.discountPct)),
      gstRate: Number(line.gstRate),
    })),
  });

  const save = async (post: boolean) => {
    setTouched(true);
    setConfirmPost(false);
    // A draft may be saved before its state or rates are known; posting needs everything.
    const blocking = post ? firstError : Object.entries(errors).find(([key, message]) => message && key !== 'placeOfSupply' && !/^line-\d+-rate$/.test(key));
    if (blocking) {
      toast({ tone: 'error', message: blocking[1]! });
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

  const discountForAll = () => {
    const value = numberIn(everyDiscount);
    if (Number.isNaN(value) || value < 0 || value > 100) {
      toast({ tone: 'error', message: 'Enter a discount from 0 to 100%.' });
      return;
    }
    setDraft((current) => ({ ...current, lines: current.lines.map((line) => ({ ...line, discountPct: String(value) })) }));
  };

  const sameAsBuyer = () =>
    setDraft((current) => ({
      ...current,
      details: {
        ...current.details,
        shipName: current.customerName,
        shipAddress: current.billingAddress,
        shipGstin: current.customerGstin,
        shipState: figures.pos ? GST_STATES[figures.pos]! : current.placeOfSupply,
        shipContact: current.details.buyerContact,
        shipPhone: current.details.buyerPhone,
        shipEmail: current.details.buyerEmail,
      },
    }));

  return (
    <>
      <PageHeader
        title="Draft invoice"
        crumbs={[{ label: 'Sales Register', to: '/gst/sales' }]}
        description={
          <>
            From order <Link to={`/orders/${invoice.orderId}`}>{invoice.orderNumber}</Link>. Check the buyer, rates and discounts, then post it: posting gives it the next number in your series.
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
      <div className="stack" style={{ marginBottom: 'var(--space-5)' }}>
        <Card aria-labelledby="lines-title" className="table-card">
          <CardHeader
            id="lines-title"
            title="Description of goods"
            description="Rate per unit before GST, less the discount; GST is added on the total. HSN and GST rate come from Stock."
            action={
              <form
                className="row"
                style={{ gap: 'var(--space-2)' }}
                onSubmit={(event) => {
                  event.preventDefault();
                  discountForAll();
                }}
              >
                <input className="input" aria-label="Discount for every line, in percent" inputMode="decimal" placeholder="Disc. %" value={everyDiscount} onChange={(event) => setEveryDiscount(event.target.value)} style={{ width: 84 }} />
                <Button size="sm" type="submit" icon={PercentIcon}>
                  Every Line
                </Button>
              </form>
            }
          />
          <div className="table-scroll">
            <table className="table bill-lines">
              <caption className="visually-hidden">Invoice lines</caption>
              <thead>
                <tr>
                  <th scope="col">Sl</th>
                  <th scope="col">Description</th>
                  <th scope="col">HSN/SAC</th>
                  <th scope="col">Quantity</th>
                  <th scope="col">Rate (₹)</th>
                  <th scope="col">Disc. %</th>
                  <th scope="col">GST</th>
                  <th scope="col" className="is-num">
                    Amount
                  </th>
                </tr>
              </thead>
              <tbody>
                {draft.lines.map((line, index) => (
                  <tr key={`${line.productId}-${line.option}-${index}`}>
                    <td className="num">{index + 1}</td>
                    <td>
                      <input className="input" aria-label={`Description of line ${index + 1}`} value={line.description} onChange={(event) => setLine(index, { description: event.target.value })} style={{ width: '100%', minWidth: 340, fontWeight: 600 }} maxLength={300} />
                      <input className="input input--sub" aria-label={`Second line of line ${index + 1}`} value={line.detail} onChange={(event) => setLine(index, { detail: event.target.value })} placeholder="Second line, e.g. STICON PROFILE" maxLength={200} />
                      {lineError(index) && (
                        <p className="field__error" role="alert">
                          {lineError(index)}
                        </p>
                      )}
                    </td>
                    <td>
                      <input className="input" aria-label={`HSN of line ${index + 1}`} inputMode="numeric" value={line.hsn} onChange={(event) => setLine(index, { hsn: event.target.value })} placeholder="76042100" style={{ width: 104 }} maxLength={8} />
                    </td>
                    <td className="num" style={{ whiteSpace: 'nowrap', paddingTop: 14 }}>
                      {line.qty} {UNITS[line.unit]}
                    </td>
                    <td>
                      <input className="input" aria-label={`Rate of line ${index + 1}, per ${UNITS[line.unit]}, before GST`} inputMode="decimal" value={line.rate} onChange={(event) => setLine(index, { rate: event.target.value })} style={{ width: 110 }} />
                    </td>
                    <td>
                      <input className="input" aria-label={`Discount of line ${index + 1}, in percent`} inputMode="decimal" value={line.discountPct} onChange={(event) => setLine(index, { discountPct: event.target.value })} style={{ width: 72 }} />
                    </td>
                    <td>
                      <select className="select" aria-label={`GST rate of line ${index + 1}`} value={line.gstRate} onChange={(event) => setLine(index, { gstRate: event.target.value })} style={{ width: 84 }}>
                        {GST_RATES.map((rate) => (
                          <option key={rate} value={String(rate)}>
                            {rate}%
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="is-num" style={{ paddingTop: 14 }}>
                      <strong>{invoiceAmount(figures.lines[index]!.amount)}</strong>
                      <div className="cell-sub">+ {formatMoney(r2(figures.lines[index]!.cgst + figures.lines[index]!.sgst + figures.lines[index]!.igst))} GST</div>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row" colSpan={7} className="is-num">
                    Amount before GST
                  </th>
                  <td className="is-num">{formatMoney(figures.taxable)}</td>
                </tr>
                <tr>
                  <th scope="row" colSpan={7} className="is-num">
                    Total with {figures.interstate ? 'IGST' : 'CGST + SGST'}, rounded to the rupee
                  </th>
                  <td className="is-num">
                    <strong>{formatMoney(figures.total)}</strong>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          {missingHsn > 0 && <p className="card__body field__hint">{missingHsn === 1 ? 'One line has' : `${missingHsn} lines have`} no HSN. GST invoices need it: add it here, or under Stock for next time.</p>}
        </Card>

      </div>
      <div className="editor">
        <div className="stack">
          <Card aria-labelledby="buyer-title">
            <CardHeader id="buyer-title" title="Buyer (Bill to)" description="As it will print. A GSTIN makes it a B2B invoice and sets the place of supply." />
            <div className="card__body form-grid">
              <TextField label="Buyer’s name" required value={draft.customerName} onChange={(event) => set('customerName', event.target.value)} error={shown('customerName')} maxLength={150} />
              <TextField
                label="GSTIN/UIN"
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
              <TextAreaField className="span-2" label="Address" value={draft.billingAddress} onChange={(event) => set('billingAddress', event.target.value)} rows={3} maxLength={500} hint="Printed line by line, as typed." />
              <SelectField
                label="State (place of supply)"
                value={figures.pos ? GST_STATES[figures.pos]! : draft.placeOfSupply}
                onChange={(event) => set('placeOfSupply', event.target.value)}
                error={shown('placeOfSupply')}
                options={[{ value: '', label: 'Choose the buyer’s state…' }, ...STATES.map((state) => ({ value: state, label: `${state} (${codeOfState(state)})` }))]}
                hint={figures.interstate ? 'Another state: IGST.' : figures.pos ? 'Same state as the shop: CGST + SGST.' : undefined}
              />
              <TextField label="Invoice date" type="date" max={localDay()} value={draft.invoiceDate} onChange={(event) => set('invoiceDate', event.target.value)} error={shown('invoiceDate')} />
              <TextField label="Contact person" value={draft.details.buyerContact} onChange={(event) => setDetail('buyerContact', event.target.value)} maxLength={100} />
              <TextField label="Contact" type="tel" value={draft.details.buyerPhone} onChange={(event) => setDetail('buyerPhone', event.target.value)} maxLength={40} />
              <TextField className="span-2" label="E-mail" type="email" value={draft.details.buyerEmail} onChange={(event) => setDetail('buyerEmail', event.target.value)} error={shown('buyerEmail')} maxLength={120} spellCheck={false} />
            </div>
          </Card>

          <Card aria-labelledby="ship-title">
            <CardHeader
              id="ship-title"
              title="Consignee (Ship to)"
              description="Where the goods go. Usually the buyer."
              action={
                <Button size="sm" icon={CopyIcon} onClick={sameAsBuyer}>
                  Same as Buyer
                </Button>
              }
            />
            <div className="card__body form-grid">
              <TextField label="Name" value={draft.details.shipName} onChange={(event) => setDetail('shipName', event.target.value)} maxLength={150} placeholder={draft.customerName} />
              <TextField label="GSTIN/UIN" value={draft.details.shipGstin} onChange={(event) => setDetail('shipGstin', event.target.value.toUpperCase())} error={shown('shipGstin')} maxLength={15} spellCheck={false} />
              <TextAreaField className="span-2" label="Address" value={draft.details.shipAddress} onChange={(event) => setDetail('shipAddress', event.target.value)} rows={3} maxLength={500} />
              <SelectField label="State" value={draft.details.shipState} onChange={(event) => setDetail('shipState', event.target.value)} options={[{ value: '', label: 'Same as the buyer’s' }, ...STATES.map((state) => ({ value: state, label: `${state} (${codeOfState(state)})` }))]} />
              <TextField label="Contact person" value={draft.details.shipContact} onChange={(event) => setDetail('shipContact', event.target.value)} maxLength={100} />
              <TextField label="Contact" type="tel" value={draft.details.shipPhone} onChange={(event) => setDetail('shipPhone', event.target.value)} maxLength={40} />
              <TextField label="E-mail" type="email" value={draft.details.shipEmail} onChange={(event) => setDetail('shipEmail', event.target.value)} error={shown('shipEmail')} maxLength={120} spellCheck={false} />
            </div>
          </Card>

          <Card aria-labelledby="refs-title">
            <CardHeader id="refs-title" title="Order and dispatch" description="Printed in the boxes beside the buyer. Leave any you don’t use empty." />
            <div className="card__body form-grid">
              <TextField label="Delivery Note" value={draft.details.deliveryNote} onChange={(event) => setDetail('deliveryNote', event.target.value)} maxLength={60} />
              <TextField label="Mode/Terms of Payment" value={draft.details.paymentTerms} onChange={(event) => setDetail('paymentTerms', event.target.value)} maxLength={100} placeholder="e.g. Credit, 30 days" />
              <TextField label="Reference No. & Date" value={draft.details.reference} onChange={(event) => setDetail('reference', event.target.value)} maxLength={100} />
              <TextField label="Other References" value={draft.details.otherReferences} onChange={(event) => setDetail('otherReferences', event.target.value)} maxLength={150} />
              <TextField label="Buyer’s Order No." value={draft.details.buyerOrderNo} onChange={(event) => setDetail('buyerOrderNo', event.target.value)} maxLength={60} />
              <TextField label="Buyer’s order dated" type="date" value={draft.details.buyerOrderDate} onChange={(event) => setDetail('buyerOrderDate', event.target.value)} />
              <TextField label="Dispatch Doc No." value={draft.details.dispatchDocNo} onChange={(event) => setDetail('dispatchDocNo', event.target.value)} maxLength={60} />
              <TextField label="Delivery Note Date" type="date" value={draft.details.deliveryNoteDate} onChange={(event) => setDetail('deliveryNoteDate', event.target.value)} />
              <TextField label="Dispatched through" value={draft.details.dispatchedThrough} onChange={(event) => setDetail('dispatchedThrough', event.target.value)} maxLength={100} placeholder="e.g. VRL Logistics" />
              <TextField label="Destination" value={draft.details.destination} onChange={(event) => setDetail('destination', event.target.value)} maxLength={100} />
              <TextAreaField className="span-2" label="Terms of Delivery" value={draft.details.deliveryTerms} onChange={(event) => setDetail('deliveryTerms', event.target.value)} rows={2} maxLength={300} />
              <TextAreaField className="span-2" label="Remarks" value={draft.notes} onChange={(event) => set('notes', event.target.value)} rows={2} maxLength={1000} hint="Optional, printed above the declaration." />
            </div>
          </Card>
        </div>

        <div className="stack editor__aside">
          <Card aria-labelledby="draft-total">
            <CardHeader id="draft-total" title="Total" />
            <div className="card__body stack">
              <dl className="kv kv--compact kv--split" style={{ margin: 0 }}>
                <dt>Amount before GST</dt>
                <dd className="num">{formatMoney(figures.taxable)}</dd>
                {taxRows.map((row) => (
                  <Pair key={row.label} label={row.label} value={formatMoney(row.amount)} />
                ))}
                {figures.roundOff !== 0 && <Pair label={figures.roundOff < 0 ? 'Less: Rounding Off' : 'Rounding Off'} value={formatMoney(figures.roundOff)} />}
                <dt style={{ fontWeight: 600, color: 'var(--text)' }}>Total</dt>
                <dd className="num" style={{ fontWeight: 700, fontSize: 'var(--text-lg)' }}>
                  {formatMoney(figures.total)}
                </dd>
              </dl>
              {invoice.returnId && (
                <p className="field__hint" style={{ margin: 0 }}>
                  The goods given for return <Link to={`/returns/${invoice.returnId}`}>{invoice.returnNumber}</Link>. Its money is settled on the return, so the order’s bill doesn’t change.
                </p>
              )}
              {!invoice.returnId && order && figures.total !== (order.bill ?? order.total) && (
                <p className="field__hint" style={{ margin: 0 }}>
                  Posting makes this the order’s bill (now {formatMoney(order.bill ?? order.total)}), so payments follow the invoice.
                </p>
              )}
              <p className="field__hint" style={{ margin: 0 }}>
                The buyer’s previous balance (what’s unpaid on their other orders) is printed with it when you post.
              </p>
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
        body={`It gets the next number in the ${settings.invoicePrefix || 'invoice'} series, and can’t be edited after: to correct it, you cancel it. Total ${formatMoney(figures.total)}.`}
        confirmLabel="Post Invoice"
        onCancel={() => setConfirmPost(false)}
        onConfirm={() => save(true)}
      />
      <ConfirmDialog open={confirmDelete} title="Delete this draft?" body="It has no number yet, so nothing else changes. You can make it again from the order." confirmLabel="Delete Draft" destructive onCancel={() => setConfirmDelete(false)} onConfirm={remove} />
    </>
  );
}

const Pair = ({ label, value }: { label: string; value: ReactNode }) => (
  <>
    <dt>{label}</dt>
    <dd className="num">{value}</dd>
  </>
);

/** A day typed as a date prints as 5-Nov-26; anything else as typed. */
const printedDay = (value: string | undefined) => (value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? invoiceDay(value) : (value ?? ''));
const balance = (value: number) => `${invoiceAmount(value)} ${value < 0 ? 'Cr' : 'Dr'}`;

/** The seller, consignee or buyer, as the invoice prints them. */
function Party({ title, name, address, gstin, state, code, contact, phone, email }: { title?: string; name: string; address?: string; gstin?: string; state?: string; code?: string; contact?: string; phone?: string; email?: string }) {
  return (
    <section className="tally__cell tally__party">
      {title && <div className="tally__label">{title}</div>}
      <strong className="tally__name">{name}</strong>
      {address && <div className="tally__address">{address}</div>}
      <dl className="tally__facts">
        {gstin && <Pair label="GSTIN/UIN" value={gstin} />}
        {state && <Pair label="State Name" value={`${state}${code ? `, Code : ${code}` : ''}`} />}
        {contact && <Pair label="Contact person" value={contact} />}
        {phone && <Pair label="Contact" value={phone} />}
        {email && <Pair label="E-Mail" value={email} />}
      </dl>
    </section>
  );
}

/** A posted invoice, laid out as the shop's Tally invoices are, for printing. */
function PostedInvoice({ invoice, settings, onSaved }: { invoice: SalesInvoice; settings: GstSettings; onSaved: (fresh?: SalesInvoice[]) => void }) {
  const toast = useToast();
  const { db } = useData();
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const cancelled = invoice.status === 'cancelled';
  const details = invoice.details ?? {};
  const tax = r2(invoice.cgst + invoice.sgst + invoice.igst);
  const legalName = settings.legalName || db.settings.companyName;
  const sellerGstin = invoice.sellerGstin ?? settings.gstin;
  const sellerState = stateOfGstin(sellerGstin);
  const taxRows = invoiceTaxRows(invoice.items, invoice.interstate);
  const hsnRows = invoiceHsnTable(invoice.items);
  const units = [...new Set(invoice.items.map((item) => item.unit))];
  const totalQty = units.length === 1 ? `${Math.round(invoice.items.reduce((sum, item) => sum + item.qty, 0) * 1000) / 1000} ${PRINT_UNIT[units[0]!]}` : '';
  const shipGstin = details.shipGstin || '';
  const shipState = details.shipState || invoice.placeOfSupply || '';
  const shipCode = GSTIN.test(shipGstin) ? shipGstin.slice(0, 2) : codeOfState(shipState);
  const previous = invoice.previousBalance;

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

  const refs: [string, string | undefined][] = [
    ['Invoice No.', invoice.number ?? ''],
    ['Dated', invoiceDay(invoice.invoiceDate)],
    ['Delivery Note', details.deliveryNote],
    ['Mode/Terms of Payment', details.paymentTerms],
    ['Reference No. & Date.', details.reference],
    ['Other References', details.otherReferences],
    ['Buyer’s Order No.', details.buyerOrderNo],
    ['Dated', printedDay(details.buyerOrderDate)],
    ['Dispatch Doc No.', details.dispatchDocNo],
    ['Delivery Note Date', printedDay(details.deliveryNoteDate)],
    ['Dispatched through', details.dispatchedThrough],
    ['Destination', details.destination],
  ];

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

      <div className="tally-scroll">
        <article className="tally" aria-label={`Tax invoice ${invoice.number}`}>
          <h2 className="tally__title">{cancelled ? 'TAX INVOICE (CANCELLED)' : 'TAX INVOICE'}</h2>
          <div className="tally__box">
            <div className="tally__top">
              <div className="tally__parties">
                <section className="tally__cell tally__party">
                  <strong className="tally__name">{legalName}</strong>
                  {settings.tradeName && settings.tradeName.toLowerCase() !== legalName.toLowerCase() && <div>{settings.tradeName}</div>}
                  {settings.address && <div className="tally__address">{settings.address}</div>}
                  {sellerState && (
                    <div>
                      {sellerState}
                      {settings.pincode ? ` - ${settings.pincode}` : ''}, India
                    </div>
                  )}
                  <dl className="tally__facts tally__facts--inline">
                    <Pair label="GSTIN/UIN" value={sellerGstin} />
                    {sellerState && <Pair label="State Name" value={`${sellerState}, Code : ${sellerGstin.slice(0, 2)}`} />}
                    {settings.phone && <Pair label="Contact" value={settings.phone} />}
                    {settings.email && <Pair label="E-Mail" value={settings.email} />}
                  </dl>
                </section>
                <Party
                  title="Consignee (Ship to)"
                  name={details.shipName || invoice.customerName}
                  address={details.shipAddress || invoice.billingAddress}
                  gstin={shipGstin || (details.shipName ? '' : invoice.customerGstin)}
                  state={shipState}
                  code={shipCode}
                  contact={details.shipContact}
                  phone={details.shipPhone}
                  email={details.shipEmail}
                />
                <Party
                  title="Buyer (Bill to)"
                  name={invoice.customerName}
                  address={invoice.billingAddress}
                  gstin={invoice.customerGstin || ''}
                  state={invoice.placeOfSupply}
                  code={invoice.posCode}
                  contact={details.buyerContact}
                  phone={details.buyerPhone}
                  email={details.buyerEmail}
                />
              </div>
              <div className="tally__refs">
                <dl className="tally__ref-grid">
                  {refs.map(([label, value], index) => (
                    <div key={index} className="tally__ref">
                      <dt>{label}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
                <dl className="tally__ref tally__ref--wide">
                  <dt>Terms of Delivery</dt>
                  <dd className="tally__address">{details.deliveryTerms}</dd>
                </dl>
              </div>
            </div>

            <table className="tally__lines">
              <colgroup>
                <col style={{ width: '5%' }} />
                <col />
                <col style={{ width: '11%' }} />
                <col style={{ width: '10%' }} />
                <col style={{ width: '10%' }} />
                <col style={{ width: '6%' }} />
                <col style={{ width: '7%' }} />
                <col style={{ width: '13%' }} />
              </colgroup>
              <thead>
                <tr>
                  <th scope="col">
                    Sl
                    <br />
                    No.
                  </th>
                  <th scope="col">Description of Goods</th>
                  <th scope="col">HSN/SAC</th>
                  <th scope="col">Quantity</th>
                  <th scope="col">Rate</th>
                  <th scope="col">per</th>
                  <th scope="col">Disc. %</th>
                  <th scope="col">Amount</th>
                </tr>
              </thead>
              <tbody>
                {invoice.items.map((item, index) => (
                  <tr key={index}>
                    <td className="tally__c">{index + 1}</td>
                    <td>
                      <strong>{item.description}</strong>
                      {item.detail && <div className="tally__detail">{item.detail}</div>}
                    </td>
                    <td>{item.hsn}</td>
                    <td className="tally__n">
                      <strong>
                        {item.qty} {PRINT_UNIT[item.unit]}
                      </strong>
                    </td>
                    <td className="tally__n">{invoiceAmount(item.rate)}</td>
                    <td>{PRINT_UNIT[item.unit]}</td>
                    <td className="tally__n">{item.discountPct ? `${item.discountPct} %` : ''}</td>
                    <td className="tally__n">
                      <strong>{invoiceAmount(item.amount)}</strong>
                    </td>
                  </tr>
                ))}
                <tr>
                  {blanks(7)}
                  <td className="tally__n tally__subtotal">{invoiceAmount(invoice.taxable)}</td>
                </tr>
                {taxRows.map((row) => (
                  <tr key={row.label}>
                    <td />
                    <td className="tally__ledger">
                      <strong>{row.label}</strong>
                    </td>
                    <td />
                    <td />
                    <td className="tally__n">{row.rate} %</td>
                    <td />
                    <td />
                    <td className="tally__n">
                      <strong>{invoiceAmount(row.amount)}</strong>
                    </td>
                  </tr>
                ))}
                {invoice.roundOff !== 0 && (
                  <tr>
                    <td />
                    <td className="tally__ledger">
                      {invoice.roundOff < 0 && <span className="tally__less">Less :</span>}
                      <strong>Rounding Off</strong>
                    </td>
                    {blanks(5)}
                    <td className="tally__n">
                      <strong>
                        {invoice.roundOff < 0 ? '(-)' : ''}
                        {invoiceAmount(invoice.roundOff)}
                      </strong>
                    </td>
                  </tr>
                )}
                <tr className="tally__fill" aria-hidden>
                  {blanks(8)}
                </tr>
              </tbody>
              <tfoot>
                <tr>
                  <td />
                  <td className="tally__n">Total</td>
                  <td />
                  <td className="tally__n">
                    <strong>{totalQty}</strong>
                  </td>
                  {blanks(3)}
                  <td className="tally__n tally__grand">₹ {invoiceAmount(invoice.total)}</td>
                </tr>
              </tfoot>
            </table>

            <div className="tally__cell tally__words">
              <div className="tally__split">
                <span>Amount Chargeable (in words)</span>
                <em>E. &amp; O.E</em>
              </div>
              <strong>{rupeesInWords(invoice.total)}</strong>
              {previous !== null && previous !== undefined && (
                <dl className="tally__balance">
                  <Pair label="Previous Balance :" value={<strong>{balance(previous)}</strong>} />
                  <Pair label="Current Balance :" value={<strong>{balance(r2(previous + invoice.total))}</strong>} />
                </dl>
              )}
            </div>

            <table className="tally__hsn">
              <thead>
                <tr>
                  <th scope="col" rowSpan={2}>
                    HSN/SAC
                  </th>
                  <th scope="col" rowSpan={2}>
                    Taxable
                    <br />
                    Value
                  </th>
                  {invoice.interstate ? (
                    <th scope="colgroup" colSpan={2}>
                      IGST
                    </th>
                  ) : (
                    <>
                      <th scope="colgroup" colSpan={2}>
                        CGST
                      </th>
                      <th scope="colgroup" colSpan={2}>
                        SGST/UTGST
                      </th>
                    </>
                  )}
                  <th scope="col" rowSpan={2}>
                    Total
                    <br />
                    Tax Amount
                  </th>
                </tr>
                <tr>
                  {(invoice.interstate ? ['IGST'] : ['CGST', 'SGST']).map((head) => (
                    <HeadPair key={head} />
                  ))}
                </tr>
              </thead>
              <tbody>
                {hsnRows.map((row) => (
                  <tr key={`${row.hsn}|${row.rate}`}>
                    <td>{row.hsn || '—'}</td>
                    <td className="tally__n">{invoiceAmount(row.taxable)}</td>
                    {invoice.interstate ? (
                      <>
                        <td className="tally__n">{row.rate}%</td>
                        <td className="tally__n">{invoiceAmount(row.heads.igst)}</td>
                      </>
                    ) : (
                      <>
                        <td className="tally__n">{row.rate / 2}%</td>
                        <td className="tally__n">{invoiceAmount(row.heads.cgst)}</td>
                        <td className="tally__n">{row.rate / 2}%</td>
                        <td className="tally__n">{invoiceAmount(row.heads.sgst)}</td>
                      </>
                    )}
                    <td className="tally__n">{invoiceAmount(row.tax)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row" className="tally__n">
                    Total
                  </th>
                  <td className="tally__n">{invoiceAmount(invoice.taxable)}</td>
                  {invoice.interstate ? (
                    <>
                      <td />
                      <td className="tally__n">{invoiceAmount(invoice.igst)}</td>
                    </>
                  ) : (
                    <>
                      <td />
                      <td className="tally__n">{invoiceAmount(invoice.cgst)}</td>
                      <td />
                      <td className="tally__n">{invoiceAmount(invoice.sgst)}</td>
                    </>
                  )}
                  <td className="tally__n">{invoiceAmount(tax)}</td>
                </tr>
              </tfoot>
            </table>

            <div className="tally__end">
              <div className="tally__end-left">
                <p>
                  Tax Amount (in words) : <strong>{rupeesInWords(tax)}</strong>
                </p>
                {invoice.notes && (
                  <p className="tally__address">
                    <span className="tally__label">Remarks:</span> {invoice.notes}
                  </p>
                )}
                <div className="tally__declaration">
                  <span className="tally__label tally__label--rule">Declaration</span>
                  <div className="tally__address">{settings.declaration}</div>
                  {settings.terms && <div className="tally__address">{settings.terms}</div>}
                </div>
              </div>
              <div className="tally__end-right">
                {(settings.bankName || settings.bankAccount || settings.bankBranchIfsc) && (
                  <div className="tally__bank">
                    <div>Company’s Bank Details</div>
                    <dl className="tally__facts">
                      {settings.bankName && <Pair label="Bank Name" value={<strong>{settings.bankName}</strong>} />}
                      {settings.bankAccount && <Pair label="A/c No." value={<strong>{settings.bankAccount}</strong>} />}
                      {settings.bankBranchIfsc && <Pair label="Branch & IFS Code" value={<strong>{settings.bankBranchIfsc}</strong>} />}
                    </dl>
                  </div>
                )}
                <div className="tally__sign">
                  <strong>for {legalName}</strong>
                  <span>Authorised Signatory</span>
                </div>
              </div>
            </div>
          </div>
          {settings.jurisdiction && <p className="tally__after">{settings.jurisdiction}</p>}
          <p className="tally__after">This is a Computer Generated Invoice</p>
        </article>
      </div>

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

/** Empty cells that keep the invoice's column lines running down the page. */
const blanks = (count: number) => Array.from({ length: count }, (_, index) => <td key={index} />);

const HeadPair = () => (
  <>
    <th scope="col">Rate</th>
    <th scope="col">Amount</th>
  </>
);
