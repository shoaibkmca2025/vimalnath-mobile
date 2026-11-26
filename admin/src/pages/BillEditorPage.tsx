import { CheckCircleIcon, FileTextIcon, PlusIcon, ReceiptIcon, TrashIcon, TruckIcon, UserPlusIcon, WarningCircleIcon } from '@phosphor-icons/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';

import { Button, IconButton } from '@/components/Button';
import { Card, CardHeader } from '@/components/Card';
import { Drawer } from '@/components/Drawer';
import { EmptyState } from '@/components/EmptyState';
import { Segmented, SelectField, Switch, TextAreaField, TextField } from '@/components/Field';
import { ItemPicker } from '@/components/ItemPicker';
import { PageHeader } from '@/components/PageHeader';
import { useToast } from '@/components/useToast';
import { judge, measure, rangeOf, ruleFor, rulesOn, suggested } from '@/data/billing';
import { computeInvoice } from '@/data/gst';
import { GSTIN, GST_STATES, STATES, codeOfState, stateOfGstin } from '@/data/india';
import { localDay } from '@/data/payments';
import { formatMoney, parseMoney, r2 } from '@/data/purchases';
import { readSession } from '@/data/session';
import { GST_RATES, stockRows, type StockRow } from '@/data/stock';
import type { BillCustomer, BillingSetup, DiscountSetup, InvoiceItem, Quotation, SalesInvoice } from '@/data/types';
import { useData } from '@/data/useData';
import { useBilling } from '@/hooks/useBilling';
import { ApiError, api } from '@/lib/api';

type Row = {
  key: string;
  productId: string;
  option: string;
  categoryId: string | null;
  description: string;
  detail: string;
  sku: string;
  hsn: string;
  qty: string;
  unit: string;
  /** The unit stock counts it in: a counted item is billed in it. */
  stockUnit: string | null;
  rate: string;
  discountPct: string;
  discountAmount: string;
  gstRate: string;
  lineType: 'goods' | 'charge';
};
type Draft = {
  invoiceDate: string;
  dueDate: string;
  validUntil: string;
  customerId: number | null;
  customerName: string;
  customerPhone: string;
  customerGstin: string;
  billingAddress: string;
  placeOfSupply: string;
  notes: string;
  pricesIncludeGst: boolean;
  billDiscountMode: 'pct' | 'amount';
  billDiscount: string;
  allowNegativeStock: boolean;
  rows: Row[];
};
type Mode = 'invoice' | 'quotation';

let keys = 0;
const nextKey = () => `row-${++keys}`;
const addDays = (day: string, days: number) => {
  const date = new Date(`${day}T00:00:00`);
  date.setDate(date.getDate() + days);
  return localDay(date);
};
const number = (text: string) => (text.trim() === '' ? 0 : parseMoney(text));

/** A new bill or quotation (/billing/new, /billing/quotations/new), or a draft to change (…/:id/edit). */
export default function BillEditorPage() {
  const { id } = useParams();
  const mode: Mode = useLocation().pathname.startsWith('/billing/quotations') ? 'quotation' : 'invoice';
  const { invoices, setup, discounts, error } = useBilling({ invoices: mode === 'invoice' && Boolean(id) });
  const [quote, setQuote] = useState<Quotation | null | undefined>(mode === 'quotation' && id ? undefined : null);
  useEffect(() => {
    if (mode !== 'quotation' || !id) return;
    let active = true;
    api<Quotation[]>('/billing/quotations').then(
      (all) => active && setQuote(all.find((one) => one.id === id) ?? null),
      () => active && setQuote(null),
    );
    return () => {
      active = false;
    };
  }, [mode, id]);
  const invoice = mode === 'invoice' && id ? invoices?.find((one) => one.id === id) : undefined;
  const loading = !setup || !discounts || (mode === 'invoice' && id && !invoices) || quote === undefined;
  const title = mode === 'quotation' ? (id ? `Edit ${quote?.number ?? 'Quotation'}` : 'New Quotation') : id ? `Edit ${invoice?.number ?? 'Draft Bill'}` : 'New Bill';
  const crumbs = [mode === 'quotation' ? { label: 'Quotations', to: '/billing/quotations' } : { label: 'Billing', to: '/billing' }];
  if (loading || (id && !invoice && !quote))
    return (
      <>
        <PageHeader title={title} crumbs={crumbs} />
        <Card>
          <EmptyState icon={ReceiptIcon} title={error ? 'Couldn’t load billing' : loading ? 'Loading…' : 'This bill doesn’t exist'}>
            {error}
          </EmptyState>
        </Card>
      </>
    );
  if (invoice && (invoice.status !== 'draft' || invoice.source !== 'counter'))
    return (
      <>
        <PageHeader title={title} crumbs={crumbs} />
        <Card>
          <EmptyState icon={ReceiptIcon} title={invoice.source !== 'counter' ? 'This invoice belongs to an order' : `${invoice.number} is ${invoice.status}`}>
            {invoice.source !== 'counter' ? (
              <>
                Change it from the <Link to={`/gst/invoices/${invoice.id}`}>Sales Register</Link>.
              </>
            ) : (
              <>An Owner can reopen a posted bill to correct it, from the bill’s page.</>
            )}
          </EmptyState>
        </Card>
      </>
    );
  return <Editor key={id ?? 'new'} mode={mode} invoice={invoice} quote={quote ?? undefined} setup={setup!} discounts={discounts!} title={title} crumbs={crumbs} />;
}

function Editor({ mode, invoice, quote, setup, discounts, title, crumbs }: { mode: Mode; invoice?: SalesInvoice; quote?: Quotation; setup: BillingSetup; discounts: DiscountSetup; title: string; crumbs: { label: string; to: string }[] }) {
  const navigate = useNavigate();
  const toast = useToast();
  const { db } = useData();
  const role = readSession()?.role;
  const settings = setup.settings;
  const shopState = stateOfGstin(settings.gstin) ?? '';
  const products = useMemo(() => new Map(db.products.map((product) => [product.id, product])), [db.products]);
  const rows = useMemo(() => stockRows(db.products, db.stock), [db.products, db.stock]);
  const source = invoice ?? quote;
  const [draft, setDraft] = useState<Draft>(() => {
    const today = localDay();
    const day = invoice?.invoiceDate ?? quote?.quoteDate ?? today;
    const fromItem = (item: InvoiceItem): Row => ({
      key: nextKey(),
      productId: item.productId,
      option: item.option,
      categoryId: products.get(item.productId)?.category ?? null,
      description: item.description,
      detail: item.detail,
      sku: item.sku ?? '',
      hsn: item.hsn,
      qty: String(item.qty),
      unit: item.unit,
      stockUnit: db.stock.find((one) => one.productId === item.productId && one.option === item.option)?.unit ?? null,
      rate: String(item.rate),
      discountPct: item.discountPct ? String(item.discountPct) : '',
      discountAmount: item.discountAmount ? String(item.discountAmount) : '',
      gstRate: String(item.gstRate),
      lineType: item.lineType ?? 'goods',
    });
    return {
      invoiceDate: day,
      dueDate: invoice?.dueDate ?? (settings.dueDays && mode === 'invoice' ? addDays(day, settings.dueDays) : ''),
      validUntil: quote?.validUntil ?? (mode === 'quotation' ? addDays(day, settings.quotationDays) : ''),
      customerId: source?.customerId ?? null,
      customerName: source?.customerName ?? '',
      customerPhone: source?.customerPhone ?? '',
      customerGstin: source?.customerGstin ?? '',
      billingAddress: source?.billingAddress ?? '',
      placeOfSupply: source?.placeOfSupply || shopState,
      notes: source?.notes ?? '',
      pricesIncludeGst: source?.pricesIncludeGst ?? settings.pricesIncludeGst,
      billDiscountMode: source?.billDiscountPct !== undefined && source?.billDiscountPct !== null ? 'pct' : 'amount',
      billDiscount: source?.billDiscountPct ? String(source.billDiscountPct) : source?.billDiscount ? String(source.billDiscount) : '',
      allowNegativeStock: invoice?.allowNegativeStock ?? false,
      rows: (source?.items ?? []).map(fromItem),
    };
  });
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState<'save' | 'finalize' | null>(null);
  const [failure, setFailure] = useState<ApiError | null>(null);
  const [newCustomer, setNewCustomer] = useState(false);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const setRow = (key: string, patch: Partial<Row>) => setDraft((current) => ({ ...current, rows: current.rows.map((row) => (row.key === key ? { ...row, ...patch } : row)) }));

  // ---------- Figures, as the server will work them out ----------
  const gstin = draft.customerGstin.trim().toUpperCase();
  const own = settings.gstin.slice(0, 2);
  const pos = GSTIN.test(gstin) && stateOfGstin(gstin) ? gstin.slice(0, 2) : codeOfState(draft.placeOfSupply);
  const interstate = Boolean(own && pos && own !== pos);
  const composition = settings.registrationType === 'composition';
  const priced = draft.rows.map((row) => ({
    qty: number(row.qty) || 0,
    rate: Math.max(0, number(row.rate) || 0),
    discountPct: Math.min(100, Math.max(0, number(row.discountPct) || 0)),
    discountAmount: Math.max(0, number(row.discountAmount) || 0),
    gstRate: composition ? 0 : Number(row.gstRate) || 0,
    lineType: row.lineType,
  }));
  const goodsBase = r2(computeInvoice(priced, interstate, { inclusive: draft.pricesIncludeGst }).lines.filter((line) => line.lineType !== 'charge').reduce((sum, line) => sum + line.amount, 0));
  const billDiscountInput = number(draft.billDiscount) || 0;
  const billDiscount = draft.billDiscountMode === 'pct' ? r2((goodsBase * Math.min(100, billDiscountInput)) / 100) : billDiscountInput;
  const figures = computeInvoice(priced, interstate, { inclusive: draft.pricesIncludeGst, billDiscount });
  const gross = r2(priced.reduce((sum, line) => sum + (line.lineType === 'goods' ? line.qty * line.rate : 0), 0));
  const lineDiscounts = r2(figures.lines.reduce((sum, line, index) => sum + (line.lineType === 'goods' ? priced[index]!.qty * priced[index]!.rate - (draft.pricesIncludeGst ? line.amount * (1 + line.gstRate / 100) : line.amount) : 0), 0));
  const charges = r2(figures.lines.filter((line) => line.lineType === 'charge').reduce((sum, line) => sum + line.taxable, 0));
  const paid = invoice?.paid ?? 0;
  const rules = rulesOn(discounts.rules, draft.invoiceDate);
  const verdicts = draft.rows.map((row, index) => {
    const rule = row.lineType === 'goods' ? ruleFor(rules, discounts.productRules, { productId: row.productId, option: row.option, categoryId: row.categoryId }) : null;
    const line = { ...priced[index]!, taxable: figures.lines[index]!.taxable };
    const measured = measure(line, draft.pricesIncludeGst);
    return { rule, measured, ...judge(rule, line, measured, discounts.me) };
  });
  const totalDiscount = r2(verdicts.reduce((sum, verdict) => sum + verdict.measured.value, 0));

  const errors: Record<string, string | null> = {
    customerName: draft.customerName.trim() ? null : 'Enter the customer’s name, or Walk-in customer.',
    customerGstin: gstin && !GSTIN.test(gstin) ? 'Enter the 15-character GSTIN.' : null,
    invoiceDate: !draft.invoiceDate ? 'Pick the date.' : draft.invoiceDate > localDay() ? 'The date can’t be in the future.' : null,
    dueDate: draft.dueDate && draft.dueDate < draft.invoiceDate ? 'The due date can’t be before the bill.' : null,
    rows: draft.rows.length ? null : 'Add an item: search a product, or type one in.',
    billDiscount: Number.isNaN(billDiscountInput) || billDiscountInput < 0 ? 'Enter a number.' : billDiscount > goodsBase + 0.001 ? 'More than the goods.' : null,
    ...Object.fromEntries(
      draft.rows.flatMap((row, index) => [
        [`description-${row.key}`, row.description.trim() ? null : 'Name the item.'],
        [`qty-${row.key}`, !(number(row.qty) > 0) ? 'Enter a quantity.' : null],
        [`rate-${row.key}`, Number.isNaN(number(row.rate)) || number(row.rate) < 0 ? 'Enter the rate.' : row.lineType === 'goods' && !(number(row.rate) > 0) ? 'Enter the rate.' : null],
        [`discount-${row.key}`, Number.isNaN(number(row.discountPct)) || Number.isNaN(number(row.discountAmount)) ? 'Enter numbers.' : verdicts[index]!.problem],
      ]),
    ),
  };
  const firstError = Object.entries(errors).find(([, message]) => message);
  const shown = (key: string) => (touched ? errors[key] : null) ?? (failure?.field === key ? failure.message : null);
  const needsApproval = verdicts.filter((verdict) => verdict.limit !== null).length;

  // ---------- Adding lines ----------
  const focus = (key: string) => requestAnimationFrame(() => document.getElementById(key)?.focus());
  const addProduct = (picked: StockRow) => {
    const product = picked.product;
    const rule = ruleFor(rules, discounts.productRules, { productId: picked.productId, option: picked.option, categoryId: product?.category ?? null });
    const start = suggested(rule);
    const key = nextKey();
    const rate = draft.pricesIncludeGst ? (picked.mrp ?? picked.stock?.sellingPrice) : (picked.stock?.sellingPrice ?? picked.mrp);
    setDraft((current) => ({
      ...current,
      rows: [
        ...current.rows,
        {
          key,
          productId: picked.productId,
          option: picked.option,
          categoryId: product?.category ?? null,
          description: picked.code || picked.title,
          detail: picked.title,
          sku: picked.stock?.sku ?? '',
          hsn: picked.stock?.hsn ?? '',
          qty: '1',
          unit: picked.stock?.unit ?? 'pcs',
          stockUnit: picked.stock?.unit ?? null,
          rate: rate === undefined || rate === null ? '' : String(rate),
          discountPct: start.pct ? String(start.pct) : '',
          discountAmount: start.amount ? String(start.amount) : '',
          gstRate: String(picked.stock?.gstRate ?? 18),
          lineType: 'goods',
        },
      ],
    }));
    focus(`qty-${key}`);
  };
  const addCustom = (lineType: 'goods' | 'charge') => {
    const key = nextKey();
    setDraft((current) => ({
      ...current,
      rows: [
        ...current.rows,
        {
          key,
          productId: '',
          option: '',
          categoryId: null,
          description: lineType === 'charge' ? 'Transportation charges' : '',
          detail: '',
          sku: '',
          hsn: lineType === 'charge' ? '996511' : '',
          qty: '1',
          unit: 'pcs',
          stockUnit: null,
          rate: '',
          discountPct: '',
          discountAmount: '',
          gstRate: '18',
          lineType,
        },
      ],
    }));
    focus(lineType === 'charge' ? `rate-${key}` : `description-${key}`);
  };

  // ---------- Saving ----------
  const body = () => ({
    invoiceDate: draft.invoiceDate,
    customerName: draft.customerName.trim(),
    customerGstin: gstin,
    billingAddress: draft.billingAddress.trim(),
    placeOfSupply: pos ? GST_STATES[pos]! : draft.placeOfSupply,
    notes: draft.notes.trim(),
    customerId: draft.customerId,
    customerPhone: draft.customerPhone.trim(),
    pricesIncludeGst: draft.pricesIncludeGst,
    billDiscount,
    billDiscountPct: draft.billDiscountMode === 'pct' && billDiscountInput ? billDiscountInput : null,
    items: draft.rows.map((row, index) => ({
      productId: row.productId,
      option: row.option,
      description: row.description.trim(),
      detail: row.detail.trim(),
      sku: row.sku.trim(),
      hsn: row.hsn.trim(),
      qty: priced[index]!.qty,
      unit: row.unit,
      rate: priced[index]!.rate,
      discountPct: priced[index]!.discountPct,
      discountAmount: priced[index]!.discountAmount,
      gstRate: Number(row.gstRate),
      lineType: row.lineType,
    })),
    ...(mode === 'invoice' ? { dueDate: draft.dueDate || null, allowNegativeStock: draft.allowNegativeStock } : { validUntil: draft.validUntil || null }),
  });

  const save = useCallback(
    async (finalize: boolean) => {
      setTouched(true);
      setFailure(null);
      if (firstError) {
        toast({ tone: 'error', message: firstError[1]! });
        return;
      }
      setSaving(finalize ? 'finalize' : 'save');
      try {
        if (mode === 'quotation') {
          const answer = await api<{ quotations: Quotation[] }>(quote ? `/billing/quotations/${quote.id}` : '/billing/quotations', quote ? 'PUT' : 'POST', quote ? { ...body(), version: quote.version } : body());
          const saved = answer.quotations[0]!;
          await api('/activity', 'POST', { area: 'orders', summary: `${quote ? 'Changed' : 'Made'} quotation ${saved.number} for ${saved.customerName} (${formatMoney(saved.total)})`, to: `/billing/quotations/${saved.id}` }).catch(() => null);
          toast({ message: `Quotation ${saved.number} saved.` });
          navigate(`/billing/quotations/${saved.id}`, { replace: true });
          return;
        }
        let saved = (await api<{ invoices: SalesInvoice[] }>(invoice ? `/billing/invoices/${invoice.id}` : '/billing/invoices', invoice ? 'PUT' : 'POST', invoice ? { ...body(), version: invoice.version } : body())).invoices[0]!;
        if (finalize) {
          try {
            saved = (await api<{ invoices: SalesInvoice[] }>(`/billing/invoices/${saved.id}/finalize`, 'POST', { version: saved.version })).invoices[0]!;
            await api('/activity', 'POST', { area: 'orders', summary: `Billed ${saved.number} to ${saved.customerName} (${formatMoney(saved.total)})`, to: `/billing/${saved.id}` }).catch(() => null);
            toast({ message: `${saved.number} finalized.` });
          } catch (problem) {
            toast({ tone: 'error', message: `Saved as a draft. ${problem instanceof Error ? problem.message : ''}` });
          }
        } else toast({ message: needsApproval ? 'Draft saved. A discount is waiting for approval.' : 'Draft saved.' });
        navigate(`/billing/${saved.id}`, { replace: Boolean(invoice) });
      } catch (problem) {
        const apiError = problem instanceof ApiError ? problem : new ApiError('Something went wrong.');
        setFailure(apiError);
        toast({ tone: 'error', message: apiError.message });
      } finally {
        setSaving(null);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [draft, firstError, invoice, quote, mode],
  );

  // Ctrl+S saves the draft, Ctrl+Enter finalizes, F2 goes to the product search.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (!saving) void save(false);
      } else if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && mode === 'invoice') {
        event.preventDefault();
        if (!saving) void save(true);
      } else if (event.key === 'F2') {
        event.preventDefault();
        document.getElementById('bill-items')?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [save, saving, mode]);

  const unitOptions = setup.units.map((unit) => ({ value: unit.code, label: unit.label }));
  return (
    <>
      <PageHeader
        title={title}
        crumbs={crumbs}
        description={
          mode === 'quotation'
            ? 'A priced offer in its own series. When the customer agrees, it becomes a bill with the same lines.'
            : `${composition ? 'A bill of supply (composition dealer: no GST). ' : ''}Numbered in the ${settings.invoicePrefix || 'invoice'} series when finalized; stock goes out then. Ctrl+S saves the draft, Ctrl+Enter finalizes, F2 adds an item.`
        }
      />
      <div className="stack" style={{ marginBottom: 'var(--space-5)' }}>
        <Card aria-labelledby="customer-title">
          <CardHeader
            id="customer-title"
            title="Customer"
            action={
              <Button size="sm" icon={UserPlusIcon} onClick={() => setNewCustomer(true)}>
                New Customer
              </Button>
            }
          />
          <div className="card__body form-grid form-grid--3">
            <CustomerPicker
              value={draft.customerName}
              linked={draft.customerId !== null}
              error={shown('customerName')}
              onType={(name) => setDraft((current) => ({ ...current, customerName: name, customerId: null }))}
              onPick={(customer) =>
                setDraft((current) => ({
                  ...current,
                  customerId: customer.id,
                  customerName: customer.legalName || customer.name,
                  customerPhone: customer.phone,
                  customerGstin: customer.gstin,
                  billingAddress: [customer.billingAddress, customer.pincode].filter(Boolean).join(' '),
                  placeOfSupply: customer.state || (customer.gstin ? (stateOfGstin(customer.gstin) ?? current.placeOfSupply) : current.placeOfSupply),
                }))
              }
            />
            <TextField label="Mobile" type="tel" value={draft.customerPhone} onChange={(event) => set('customerPhone', event.target.value)} maxLength={40} />
            <TextField
              label="GSTIN"
              value={draft.customerGstin}
              onChange={(event) => {
                const value = event.target.value.toUpperCase();
                const state = value.length >= 2 ? stateOfGstin(value) : undefined;
                setDraft((current) => ({ ...current, customerGstin: value, placeOfSupply: state ?? current.placeOfSupply }));
              }}
              error={shown('customerGstin')}
              maxLength={15}
              spellCheck={false}
              hint="Empty for a buyer without GST (B2C)."
            />
            <TextAreaField className="span-2" label="Billing address" value={draft.billingAddress} onChange={(event) => set('billingAddress', event.target.value)} rows={2} maxLength={500} />
            <SelectField
              label="State (place of supply)"
              value={pos ? GST_STATES[pos]! : draft.placeOfSupply}
              onChange={(event) => set('placeOfSupply', event.target.value)}
              options={STATES.map((state) => ({ value: state, label: `${state} (${codeOfState(state)})` }))}
              hint={interstate ? 'Another state: IGST.' : 'Same state: CGST + SGST.'}
            />
            <TextField label={mode === 'quotation' ? 'Quotation date' : 'Bill date'} type="date" max={localDay()} value={draft.invoiceDate} onChange={(event) => set('invoiceDate', event.target.value)} error={shown('invoiceDate')} />
            {mode === 'invoice' ? (
              <TextField label="Payment due" type="date" min={draft.invoiceDate} value={draft.dueDate} onChange={(event) => set('dueDate', event.target.value)} error={shown('dueDate')} hint="For a bill on credit; empty if paid now." />
            ) : (
              <TextField label="Valid until" type="date" min={draft.invoiceDate} value={draft.validUntil} onChange={(event) => set('validUntil', event.target.value)} />
            )}
            <div className="field">
              <span className="field__label">Rates</span>
              <Segmented<'exclusive' | 'inclusive'>
                label="Rates"
                value={draft.pricesIncludeGst ? 'inclusive' : 'exclusive'}
                onChange={(value) => set('pricesIncludeGst', value === 'inclusive')}
                options={[
                  { value: 'exclusive', label: 'Before GST' },
                  { value: 'inclusive', label: 'GST included' },
                ]}
              />
            </div>
          </div>
        </Card>

        <Card aria-labelledby="items-title" className="table-card">
          <CardHeader
            id="items-title"
            title="Items"
            description="Rates can be changed for this bill; the product’s own price stays as it is. Each discount must sit within its range."
            action={
              <span className="row" style={{ gap: 'var(--space-2)' }}>
                <Button size="sm" icon={PlusIcon} onClick={() => addCustom('goods')}>
                  Item by Hand
                </Button>
                <Button size="sm" icon={TruckIcon} onClick={() => addCustom('charge')}>
                  Add Charge
                </Button>
              </span>
            }
          />
          <div className="card__body" style={{ paddingTop: 0 }}>
            <ItemPicker id="bill-items" rows={rows} onPick={addProduct} placeholder="Add an item (F2): name, code, SKU, or scan a barcode" />
            {shown('rows') && (
              <p className="field__error" role="alert">
                {shown('rows')}
              </p>
            )}
          </div>
          {draft.rows.length > 0 && (
            <div className="table-scroll">
              <table className="table bill-lines bill-editor">
                <caption className="visually-hidden">Bill items</caption>
                <thead>
                  <tr>
                    <th scope="col">Item</th>
                    <th scope="col">HSN</th>
                    <th scope="col">Qty</th>
                    <th scope="col">Unit</th>
                    <th scope="col">Rate (₹)</th>
                    <th scope="col">Discount</th>
                    <th scope="col">GST</th>
                    <th scope="col" className="is-num">
                      Amount
                    </th>
                    <th scope="col">
                      <span className="visually-hidden">Remove</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {draft.rows.map((row, index) => {
                    const verdict = verdicts[index]!;
                    const line = figures.lines[index]!;
                    const error = shown(`description-${row.key}`) ?? shown(`qty-${row.key}`) ?? shown(`rate-${row.key}`) ?? shown(`discount-${row.key}`) ?? (failure?.field === `items.${index}.discountPct` || failure?.field === `items.${index}.unit` ? failure.message : null);
                    const type = verdict.rule?.enabled === false ? 'none' : (verdict.rule?.type ?? 'both');
                    const category = row.categoryId ? db.categories.find((one) => one.id === row.categoryId)?.label : undefined;
                    return (
                      <tr key={row.key} className={row.lineType === 'charge' ? 'bill-editor__charge' : undefined}>
                        <td>
                          <input
                            id={`description-${row.key}`}
                            className="input"
                            aria-label={`Item ${index + 1}`}
                            value={row.description}
                            onChange={(event) => setRow(row.key, { description: event.target.value })}
                            placeholder={row.lineType === 'charge' ? 'Charge, e.g. Transportation' : 'Product name or code'}
                            style={{ minWidth: 220, fontWeight: 600 }}
                            maxLength={300}
                          />
                          {row.lineType === 'goods' && (
                            <div className="row" style={{ gap: 6, marginTop: 4, flexWrap: 'nowrap' }}>
                              <input className="input input--sub" aria-label={`Description of item ${index + 1}`} value={row.detail} onChange={(event) => setRow(row.key, { detail: event.target.value })} placeholder="Description" maxLength={200} />
                              <input className="input input--sub" aria-label={`SKU of item ${index + 1}`} value={row.sku} onChange={(event) => setRow(row.key, { sku: event.target.value })} placeholder="SKU" maxLength={60} style={{ width: 96 }} />
                            </div>
                          )}
                          <div className="cell-sub">
                            {row.lineType === 'charge' ? 'Charge: never discounted or taken from stock' : row.productId ? [category, row.stockUnit ? 'from stock' : 'not counted in stock'].filter(Boolean).join(' · ') : 'Typed by hand: not from stock'}
                          </div>
                          {error && (
                            <p className="field__error" role="alert">
                              {error}
                            </p>
                          )}
                        </td>
                        <td>
                          <input className="input" aria-label={`HSN of item ${index + 1}`} inputMode="numeric" value={row.hsn} onChange={(event) => setRow(row.key, { hsn: event.target.value })} style={{ width: 92 }} maxLength={8} />
                        </td>
                        <td>
                          <input id={`qty-${row.key}`} className="input" aria-label={`Quantity of item ${index + 1}`} inputMode="decimal" value={row.qty} onChange={(event) => setRow(row.key, { qty: event.target.value })} style={{ width: 72 }} />
                        </td>
                        <td>
                          <select className="select" aria-label={`Unit of item ${index + 1}`} value={row.unit} disabled={Boolean(row.stockUnit)} onChange={(event) => setRow(row.key, { unit: event.target.value })} style={{ width: 96 }}>
                            {unitOptions.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <input id={`rate-${row.key}`} className="input" aria-label={`Rate of item ${index + 1}`} inputMode="decimal" value={row.rate} onChange={(event) => setRow(row.key, { rate: event.target.value })} style={{ width: 100 }} />
                        </td>
                        <td>
                          {row.lineType === 'charge' ? (
                            <span className="muted">—</span>
                          ) : type === 'none' ? (
                            <span className="cell-sub">No discount</span>
                          ) : (
                            <>
                              <div className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
                                {type !== 'amount' && (
                                  <input className="input" aria-label={`Discount % on item ${index + 1}`} inputMode="decimal" placeholder="%" value={row.discountPct} onChange={(event) => setRow(row.key, { discountPct: event.target.value })} style={{ width: 64 }} />
                                )}
                                {type !== 'percentage' && (
                                  <input className="input" aria-label={`Discount in rupees on item ${index + 1}`} inputMode="decimal" placeholder="₹" value={row.discountAmount} onChange={(event) => setRow(row.key, { discountAmount: event.target.value })} style={{ width: 80 }} />
                                )}
                              </div>
                              <div className={`cell-sub${verdict.problem ? ' money-late' : ''}`}>
                                {rangeOf(verdict.rule)}
                                {verdict.measured.value > 0 && ` · ${formatMoney(verdict.measured.value)} off`}
                              </div>
                              {verdict.limit !== null && <div className="cell-sub bill-editor__approval">Needs approval (your limit {verdict.rule?.type === 'amount' ? formatMoney(verdict.limit) : `${verdict.limit}%`})</div>}
                            </>
                          )}
                        </td>
                        <td>
                          <select className="select" aria-label={`GST rate of item ${index + 1}`} value={composition ? '0' : row.gstRate} disabled={composition} onChange={(event) => setRow(row.key, { gstRate: event.target.value })} style={{ width: 78 }}>
                            {GST_RATES.map((rate) => (
                              <option key={rate} value={String(rate)}>
                                {rate}%
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="is-num">
                          <strong>{formatMoney(r2(line.taxable + line.cgst + line.sgst + line.igst))}</strong>
                          <div className="cell-sub">{formatMoney(line.taxable)} + GST</div>
                        </td>
                        <td>
                          <IconButton icon={TrashIcon} label={`Remove item ${index + 1}`} onClick={() => set('rows', draft.rows.filter((one) => one.key !== row.key))} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <div className="editor">
        <div className="stack">
          <Card aria-labelledby="notes-title">
            <CardHeader id="notes-title" title="Notes" />
            <div className="card__body stack">
              <TextAreaField label="Printed on the bill" value={draft.notes} onChange={(event) => set('notes', event.target.value)} rows={3} maxLength={1000} placeholder="e.g. Delivery by Friday. Goods once sold will not be taken back." />
              {mode === 'invoice' && role === 'owner' && (
                <Switch
                  label="Allow below zero stock for this bill"
                  description={settings.allowNegativeStock ? 'Invoice Settings already allow it for every bill.' : 'Only when stock isn’t counted yet: the count goes negative until it’s corrected.'}
                  checked={draft.allowNegativeStock || settings.allowNegativeStock}
                  disabled={settings.allowNegativeStock}
                  onChange={(on) => set('allowNegativeStock', on)}
                />
              )}
            </div>
          </Card>
        </div>
        <div className="stack editor__aside">
          <Card aria-labelledby="totals-title">
            <CardHeader id="totals-title" title="Summary" />
            <div className="card__body stack">
              <dl className="kv kv--compact kv--split" style={{ margin: 0 }}>
                <dt>Items at their rates</dt>
                <dd className="num">{formatMoney(gross)}</dd>
                {lineDiscounts > 0 && (
                  <>
                    <dt>Item discounts</dt>
                    <dd className="num">− {formatMoney(lineDiscounts)}</dd>
                  </>
                )}
                <dt>
                  <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                    Bill discount
                    <select className="select select--inline" aria-label="Bill discount in" value={draft.billDiscountMode} onChange={(event) => set('billDiscountMode', event.target.value as Draft['billDiscountMode'])}>
                      <option value="amount">₹</option>
                      <option value="pct">%</option>
                    </select>
                  </span>
                </dt>
                <dd>
                  <input className="input" aria-label="Bill discount" inputMode="decimal" value={draft.billDiscount} onChange={(event) => set('billDiscount', event.target.value)} style={{ width: 96, textAlign: 'right' }} placeholder="0" />
                  {(shown('billDiscount') ?? (failure?.field === 'billDiscount' ? failure.message : null)) && <div className="field__error">{shown('billDiscount') ?? failure!.message}</div>}
                </dd>
                {charges > 0 && (
                  <>
                    <dt>Charges</dt>
                    <dd className="num">{formatMoney(charges)}</dd>
                  </>
                )}
                <dt>Taxable value</dt>
                <dd className="num">{formatMoney(figures.taxable)}</dd>
                {interstate ? (
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
                <dt style={{ fontWeight: 600, color: 'var(--text)' }}>Grand total</dt>
                <dd className="num" style={{ fontWeight: 700, fontSize: 'var(--text-lg)' }}>
                  {formatMoney(figures.total)}
                </dd>
                {totalDiscount > 0 && (
                  <>
                    <dt>Total discount</dt>
                    <dd className="num">{formatMoney(totalDiscount)}</dd>
                  </>
                )}
                {paid > 0 && (
                  <>
                    <dt>Advance received</dt>
                    <dd className="num">{formatMoney(paid)}</dd>
                    <dt>Balance due</dt>
                    <dd className="num">{formatMoney(Math.max(0, r2(figures.total - paid)))}</dd>
                  </>
                )}
              </dl>
              {needsApproval > 0 && (
                <p className="notice notice--warning" style={{ margin: 0 }}>
                  <WarningCircleIcon size={16} weight="bold" aria-hidden />
                  <span>
                    {needsApproval === 1 ? 'A discount is' : `${needsApproval} discounts are`} above your limit. Saving asks for approval; the bill can be finalized once it’s approved.
                  </span>
                </p>
              )}
              {failure && !failure.field && (
                <p className="notice notice--warning" role="alert" style={{ margin: 0 }}>
                  {failure.message}
                </p>
              )}
              {mode === 'invoice' && (
                <Button variant="primary" block icon={CheckCircleIcon} loading={saving === 'finalize'} disabled={saving !== null} onClick={() => save(true)} aria-keyshortcuts="Control+Enter">
                  Finalize Invoice
                </Button>
              )}
              <Button variant={mode === 'quotation' ? 'primary' : 'secondary'} block icon={FileTextIcon} loading={saving === 'save'} disabled={saving !== null} onClick={() => save(false)} aria-keyshortcuts="Control+S">
                {mode === 'quotation' ? 'Save Quotation' : 'Save as Draft'}
              </Button>
            </div>
          </Card>
        </div>
      </div>
      <NewCustomerDrawer
        open={newCustomer}
        onClose={() => setNewCustomer(false)}
        onSaved={(customer) => {
          setNewCustomer(false);
          setDraft((current) => ({
            ...current,
            customerId: customer.id,
            customerName: customer.legalName || customer.name,
            customerPhone: customer.phone,
            customerGstin: customer.gstin,
            billingAddress: customer.billingAddress,
            placeOfSupply: customer.state || current.placeOfSupply,
          }));
        }}
      />
    </>
  );
}

/** The customer's name, with their records to pick from as it's typed (by name, phone or GSTIN). */
function CustomerPicker({ value, linked, error, onType, onPick }: { value: string; linked: boolean; error: string | null; onType: (name: string) => void; onPick: (customer: BillCustomer) => void }) {
  const [open, setOpen] = useState(false);
  const [found, setFound] = useState<BillCustomer[]>([]);
  const needle = value.trim();
  useEffect(() => {
    if (!open || needle.length < 2) return;
    let active = true;
    const timer = setTimeout(() => {
      api<BillCustomer[]>(`/billing/customers?q=${encodeURIComponent(needle)}`).then(
        (rows) => active && setFound(rows),
        () => {},
      );
    }, 200);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [needle, open]);
  return (
    <div className="item-picker">
      <TextField
        label="Customer"
        required
        value={value}
        onChange={(event) => {
          onType(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        error={error}
        maxLength={150}
        autoComplete="off"
        hint={linked ? 'From the customer records.' : 'Type to find a customer, or a name for a walk-in.'}
      />
      {open && needle.length >= 2 && found.length > 0 && (
        <ul className="item-picker__list" aria-label="Matching customers" style={{ top: 72 }}>
          {found.map((customer) => (
            <li key={customer.id}>
              <button
                type="button"
                className="item-picker__option"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onPick(customer);
                  setOpen(false);
                }}
              >
                <span style={{ minWidth: 0 }}>
                  <span className="cell-title" style={{ display: 'block' }}>
                    {customer.legalName || customer.name}
                  </span>
                  <span className="cell-sub">{[customer.phone, customer.gstin].filter(Boolean).join(' · ') || 'No phone or GSTIN'}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A new customer record, unless one already has this phone or GSTIN (then that one is picked). */
function NewCustomerDrawer({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: (customer: BillCustomer) => void }) {
  const toast = useToast();
  const empty = { name: '', phone: '', gstin: '', legalName: '', billingAddress: '', state: '', pincode: '' };
  const [form, setForm] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ApiError | null>(null);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setForm(empty);
      setFailure(null);
    }
  }
  const field = (key: keyof typeof empty) => ({ value: form[key], onChange: (event: { target: { value: string } }) => setForm({ ...form, [key]: event.target.value }), error: failure?.field === key ? failure.message : null });
  const save = async () => {
    setBusy(true);
    setFailure(null);
    try {
      const answer = await api<{ customer: { id: number; name: string }; existing: boolean }>('/billing/customers', 'POST', form);
      const [customer] = await api<BillCustomer[]>(`/billing/customers?q=${encodeURIComponent(answer.customer.name)}`).then((rows) => rows.filter((row) => row.id === answer.customer.id));
      toast({ message: answer.existing ? `${answer.customer.name} is already a customer: picked.` : `${answer.customer.name} added.` });
      onSaved(customer ?? { id: answer.customer.id, name: answer.customer.name, legalName: form.legalName, gstin: form.gstin.toUpperCase(), billingAddress: form.billingAddress, state: form.state, pincode: form.pincode, phone: form.phone });
    } catch (problem) {
      setFailure(problem instanceof ApiError ? problem : new ApiError('Couldn’t add the customer.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Drawer
      open={open}
      title="New customer"
      description="Checked against the records first: a customer with the same mobile or GSTIN is picked instead of added twice."
      dirty={Boolean(form.name || form.phone)}
      onClose={onClose}
      onSubmit={() => void save()}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={busy}>
            Add Customer
          </Button>
        </>
      }
    >
      <div className="stack">
        <TextField label="Name" required maxLength={100} {...field('name')} />
        <TextField label="Mobile" type="tel" maxLength={30} {...field('phone')} />
        <TextField label="GSTIN" maxLength={15} spellCheck={false} {...field('gstin')} />
        <TextField label="Legal name (as on GST)" maxLength={150} {...field('legalName')} />
        <TextAreaField label="Billing address" rows={2} maxLength={500} value={form.billingAddress} onChange={(event) => setForm({ ...form, billingAddress: event.target.value })} />
        <SelectField label="State" value={form.state} onChange={(event) => setForm({ ...form, state: event.target.value })} options={[{ value: '', label: 'From the GSTIN, or choose…' }, ...STATES.map((state) => ({ value: state, label: state }))]} />
        <TextField label="PIN code" inputMode="numeric" maxLength={6} {...field('pincode')} />
        {failure && !failure.field && <p className="field__error">{failure.message}</p>}
      </div>
    </Drawer>
  );
}
