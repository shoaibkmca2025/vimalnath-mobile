import { CheckCircleIcon, FileArrowUpIcon, PlusIcon, PrinterIcon, TrashIcon, TruckIcon, WalletIcon, WarningCircleIcon, XCircleIcon } from '@phosphor-icons/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useBlocker, useNavigate, useParams, useSearchParams } from 'react-router';

import { Badge } from '@/components/Badge';
import { Button, ButtonLink, IconButton } from '@/components/Button';
import { Card, CardHeader } from '@/components/Card';
import { ConfirmDialog } from '@/components/Dialog';
import { EmptyState } from '@/components/EmptyState';
import { SelectField, TextAreaField, TextField } from '@/components/Field';
import { ItemPicker } from '@/components/ItemPicker';
import { PageHeader } from '@/components/PageHeader';
import { SupplierDrawer } from '@/components/SupplierDrawer';
import { SupplierPaymentDrawer } from '@/components/SupplierPaymentDrawer';
import { useToast } from '@/components/useToast';
import { PAYMENT_METHODS, dayLabel, localDay } from '@/data/payments';
import { PURCHASE_STATUS, balanceOf, dueOf, formatMoney, lineAmount, paidOf, parseMoney, payState, purchaseTotals, r2 } from '@/data/purchases';
import { GST_RATES, UNITS, formatQty, itemKey, stockRows, type StockRow } from '@/data/stock';
import type { Purchase, StockUnit, Supplier, SupplierPayment } from '@/data/types';
import { useData } from '@/data/useData';
import { usePurchasing } from '@/hooks/usePurchasing';
import { formatDateTime } from '@/lib/format';
import { upload } from '@/lib/upload';

type Line = { key: string; productId: string; option: string; title: string; code: string; qty: string; unit: StockUnit; rate: string; discountPct: string; gstRate: string };
type Draft = { supplierId: string; supplierInvoice: string; billDate: string; lines: Line[]; freight: string; otherCharges: string; discount: string; roundOff: string; notes: string; attachment: string | null };

let lineCount = 0;
const newKey = () => `line-${(lineCount += 1)}`;
const money = (value: number) => (value ? String(value) : '');

const draftOf = (bill: Purchase | undefined, supplierId: string): Draft =>
  bill
    ? {
        supplierId: String(bill.supplier.id),
        supplierInvoice: bill.supplierInvoice ?? '',
        billDate: bill.billDate,
        lines: bill.items.map((item) => ({
          key: newKey(),
          productId: item.productId,
          option: item.option,
          title: item.name,
          code: item.code,
          qty: String(item.qty),
          unit: item.unit,
          rate: String(item.rate),
          discountPct: money(item.discountPct),
          gstRate: String(item.gstRate),
        })),
        freight: money(bill.freight),
        otherCharges: money(bill.otherCharges),
        discount: money(bill.discount),
        roundOff: money(bill.roundOff),
        notes: bill.notes ?? '',
        attachment: bill.attachment ?? null,
      }
    : { supplierId, supplierInvoice: '', billDate: localDay(), lines: [], freight: '', otherCharges: '', discount: '', roundOff: '', notes: '', attachment: null };

/** A form's content without the lines' own keys, which are new each time a bill is loaded. */
const comparable = (draft: Draft) => JSON.stringify({ ...draft, lines: draft.lines.map(({ key: _key, ...line }) => line) });

/** The form's lines as numbers; anything unreadable counts as 0 in the preview and is flagged by `errorsOf`. */
const numbersOf = (draft: Draft) => ({
  items: draft.lines.map((line) => ({
    qty: Number(line.qty) || 0,
    rate: Number.isNaN(parseMoney(line.rate)) ? 0 : parseMoney(line.rate),
    discountPct: Number(line.discountPct) || 0,
    gstRate: Number(line.gstRate) || 0,
  })),
  freight: parseMoney(draft.freight) || 0,
  otherCharges: parseMoney(draft.otherCharges) || 0,
  discount: parseMoney(draft.discount) || 0,
  roundOff: parseMoney(draft.roundOff) || 0,
});

const QTY = /^\d{1,8}(\.\d{1,3})?$/;
const PERCENT = /^\d{1,3}(\.\d{1,2})?$/;

function errorsOf(draft: Draft, total: number) {
  const errors: Record<string, string> = {};
  const today = localDay();
  if (!draft.supplierId) errors.supplier = 'Choose the supplier.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.billDate)) errors.billDate = 'Pick the bill date.';
  else if (draft.billDate > today) errors.billDate = 'The bill date can’t be in the future.';
  if (!draft.lines.length) errors.items = 'Add at least one item.';
  for (const line of draft.lines) {
    if (!QTY.test(line.qty.trim()) || Number(line.qty) <= 0) errors[`${line.key}-qty`] = 'Enter a quantity above 0, up to 3 decimal places.';
    const rate = parseMoney(line.rate, null);
    if (Number.isNaN(rate) || rate < 0) errors[`${line.key}-rate`] = 'Enter the rate in rupees and paise, e.g. 125.50.';
    if (line.discountPct.trim() && !(PERCENT.test(line.discountPct.trim()) && Number(line.discountPct) <= 100)) errors[`${line.key}-discount`] = 'Enter a discount from 0 to 100%.';
  }
  for (const field of ['freight', 'otherCharges', 'discount'] as const) {
    const value = parseMoney(draft[field]);
    if (Number.isNaN(value) || value < 0) errors[field] = 'Enter rupees and paise, e.g. 250.';
  }
  const roundOff = parseMoney(draft.roundOff);
  if (Number.isNaN(roundOff) || Math.abs(roundOff) > 100) errors.roundOff = 'Round off by ₹100 or less, e.g. −0.40.';
  if (!errors.discount && total < 0) errors.discount = 'The discount is more than the bill.';
  return errors;
}

export default function PurchaseEditorPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const purchasing = usePurchasing();
  const { suppliers, purchases, error } = purchasing;
  const bill = id ? purchases?.find((one) => one.id === id) : undefined;

  if (!suppliers || !purchases)
    return (
      <>
        <PageHeader title={id ? 'Purchase' : 'New Purchase'} crumbs={[{ label: 'Purchases', to: '/purchases' }]} />
        <Card>
          <EmptyState icon={TruckIcon} title={error ? 'Couldn’t load purchases' : 'Loading…'}>
            {error}
          </EmptyState>
        </Card>
      </>
    );
  if (id && !bill)
    return (
      <>
        <PageHeader title="Purchase not found" crumbs={[{ label: 'Purchases', to: '/purchases' }]} />
        <Card>
          <EmptyState icon={TruckIcon} title="This bill doesn’t exist" action={<ButtonLink to="/purchases" variant="primary">Back to Purchases</ButtonLink>}>
            It may have been a draft that was deleted.
          </EmptyState>
        </Card>
      </>
    );
  if (bill && bill.status !== 'draft') return <BillView bill={bill} supplier={suppliers.find((one) => one.id === bill.supplier.id)} purchasing={purchasing} />;
  return <BillEditor key={bill?.id ?? 'new'} bill={bill} presetSupplier={params.get('supplier') ?? ''} purchasing={purchasing} onGone={() => navigate('/purchases', { replace: true })} />;
}

type Purchasing = ReturnType<typeof usePurchasing>;

/** A new or draft bill: everything can change until its goods are received. */
function BillEditor({ bill, presetSupplier, purchasing, onGone }: { bill?: Purchase; presetSupplier: string; purchasing: Purchasing; onGone: () => void }) {
  const { db, send } = useData();
  const toast = useToast();
  const navigate = useNavigate();
  const { suppliers, apply, keepSupplier, reload } = purchasing;
  const isNew = !bill;
  const original = useMemo(() => draftOf(bill, presetSupplier), [bill, presetSupplier]);
  const [draft, setDraft] = useState<Draft>(original);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState<'draft' | 'receive' | null>(null);
  const [confirmReceive, setConfirmReceive] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [addingSupplier, setAddingSupplier] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const leaving = useRef(false);

  const rows = useMemo(() => stockRows(db.products, db.stock).filter((row) => row.product && !row.stock?.orphan), [db.products, db.stock]);
  const stockByKey = useMemo(() => new Map(db.stock.map((item) => [itemKey(item.productId, item.option), item])), [db.stock]);
  const totals = purchaseTotals(numbersOf(draft));
  const errors = errorsOf(draft, totals.total);
  const shown = (key: string) => (submitted ? errors[key] : undefined);
  const dirty = comparable(draft) !== comparable(original);
  const set = <K extends keyof Draft>(field: K, value: Draft[K]) => setDraft((current) => ({ ...current, [field]: value }));
  const setLine = (key: string, patch: Partial<Line>) => setDraft((current) => ({ ...current, lines: current.lines.map((line) => (line.key === key ? { ...line, ...patch } : line)) }));
  const supplierOptions = (suppliers ?? []).filter((supplier) => !supplier.archived || String(supplier.id) === draft.supplierId);

  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && !leaving.current && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const addItem = (row: StockRow) => {
    const existing = draft.lines.find((line) => line.productId === row.productId && line.option === row.option);
    if (existing) {
      setLine(existing.key, { qty: String(r2((Number(existing.qty) || 0) + 1)) });
      toast({ message: `${row.title} is already on this bill: its quantity went up by 1.`, tone: 'info' });
      return;
    }
    const stock = row.stock;
    set('lines', [
      ...draft.lines,
      {
        key: newKey(),
        productId: row.productId,
        option: row.option,
        title: row.title,
        code: row.code,
        qty: '1',
        unit: stock?.unit ?? 'pcs',
        rate: stock?.purchasePrice != null ? String(stock.purchasePrice) : '',
        discountPct: '',
        gstRate: String(stock?.gstRate ?? 18),
      },
    ]);
  };

  const attach = async (file: File | undefined) => {
    if (!file) return;
    setProgress(0);
    try {
      set('attachment', await upload(file, setProgress));
    } catch (problem) {
      toast({ tone: 'error', message: problem instanceof Error ? problem.message : 'That file couldn’t be uploaded.' });
    } finally {
      setProgress(null);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const save = async (receive: boolean) => {
    setSubmitted(true);
    setConfirmReceive(false);
    const first = Object.keys(errors)[0];
    if (first) {
      document.getElementById(`bill-${first}`)?.focus();
      toast({ tone: 'error', message: errors[first]! });
      return;
    }
    setSaving(receive ? 'receive' : 'draft');
    const numbers = numbersOf(draft);
    const supplier = suppliers?.find((one) => String(one.id) === draft.supplierId);
    const body = {
      supplierId: Number(draft.supplierId),
      supplierInvoice: draft.supplierInvoice.trim(),
      billDate: draft.billDate,
      items: draft.lines.map((line, index) => ({ productId: line.productId, option: line.option, qty: numbers.items[index]!.qty, unit: line.unit, rate: numbers.items[index]!.rate, discountPct: numbers.items[index]!.discountPct, gstRate: numbers.items[index]!.gstRate })),
      freight: numbers.freight,
      otherCharges: numbers.otherCharges,
      discount: numbers.discount,
      roundOff: numbers.roundOff,
      notes: draft.notes.trim(),
      attachment: draft.attachment,
      receive,
    };
    const what = `${supplier?.name ?? 'a supplier'}’s bill${body.supplierInvoice ? ` ${body.supplierInvoice}` : ''} (${formatMoney(totals.total)})`;
    const answer = await send(isNew ? '/purchases' : `/purchases/${bill!.id}`, isNew ? 'POST' : 'PUT', body, {
      area: 'purchases',
      summary: receive ? `Received the goods on ${what}: ${draft.lines.length} ${draft.lines.length === 1 ? 'item' : 'items'} into stock` : `${isNew ? 'Entered' : 'Edited'} ${what} as a draft`,
      to: '/purchases',
    });
    setSaving(null);
    if (!answer) return;
    apply(answer);
    void reload();
    const saved = answer.purchases?.[0];
    toast({ message: receive ? `Goods received: ${draft.lines.length} ${draft.lines.length === 1 ? 'item' : 'items'} added to stock.` : `${saved?.number ?? 'Bill'} saved as a draft.` });
    leaving.current = true;
    if (saved && (isNew || receive)) navigate(`/purchases/${saved.id}`, { replace: true });
    else leaving.current = false;
  };

  const remove = async () => {
    setConfirmDelete(false);
    if (!bill) return;
    leaving.current = true;
    const answer = await send(`/purchases/${bill.id}`, 'DELETE', undefined, { area: 'purchases', summary: `Deleted the draft ${bill.number}`, to: '/purchases' });
    if (!answer) {
      leaving.current = false;
      return;
    }
    apply(answer);
    toast({ message: `${bill.number} deleted.` });
    onGone();
  };

  const roundToRupee = () => {
    const before = r2(totals.total - (parseMoney(draft.roundOff) || 0));
    const off = r2(Math.round(before) - before);
    set('roundOff', off ? String(off) : '');
  };

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void save(false);
      }}
    >
      <PageHeader
        title={isNew ? 'New Purchase' : `Purchase ${bill.number}`}
        crumbs={[{ label: 'Purchases', to: '/purchases' }]}
        description={isNew ? 'Enter a supplier’s bill. Save it as a draft until the goods arrive, or receive them now.' : <Badge tone="warning">Draft · no stock has moved yet</Badge>}
        actions={
          !isNew && (
            <Button variant="danger-plain" icon={TrashIcon} onClick={() => setConfirmDelete(true)}>
              Delete Draft
            </Button>
          )
        }
      />

      <div className="editor">
        <div className="stack">
          <Card aria-labelledby="bill-title">
            <CardHeader id="bill-title" title="Supplier’s bill" />
            <div className="card__body form-grid">
              <div className="span-2 row" style={{ alignItems: 'flex-end', gap: 'var(--space-2)' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <SelectField
                    id="bill-supplier"
                    label="Supplier"
                    required
                    value={draft.supplierId}
                    onChange={(event) => set('supplierId', event.target.value)}
                    error={shown('supplier')}
                    options={[{ value: '', label: supplierOptions.length ? 'Choose…' : 'Add a supplier first' }, ...supplierOptions.map((supplier) => ({ value: String(supplier.id), label: supplier.company ? `${supplier.name} · ${supplier.company}` : supplier.name }))]}
                  />
                </div>
                <Button icon={PlusIcon} onClick={() => setAddingSupplier(true)} style={{ marginBottom: shown('supplier') ? 26 : 0 }}>
                  New Supplier
                </Button>
              </div>
              <TextField id="bill-supplierInvoice" label="Their bill number" value={draft.supplierInvoice} onChange={(event) => set('supplierInvoice', event.target.value)} maxLength={50} autoComplete="off" placeholder="e.g. GB/2026/221" hint="The same bill can’t be entered twice." />
              <TextField id="bill-billDate" label="Bill date" type="date" max={localDay()} value={draft.billDate} onChange={(event) => set('billDate', event.target.value)} error={shown('billDate')} required />
              <div className="span-2 row-wrap" style={{ alignItems: 'center' }}>
                <input ref={fileInput} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="visually-hidden" tabIndex={-1} aria-hidden onChange={(event) => attach(event.target.files?.[0])} />
                <Button size="sm" icon={FileArrowUpIcon} onClick={() => fileInput.current?.click()} loading={progress !== null} loadingLabel={`Uploading ${Math.round((progress ?? 0) * 100)}%`}>
                  {draft.attachment ? 'Replace Bill Copy' : 'Attach Bill Copy'}
                </Button>
                {draft.attachment && (
                  <>
                    <a href={draft.attachment} target="_blank" rel="noreferrer">
                      View the bill copy
                    </a>
                    <Button size="sm" variant="danger-plain" onClick={() => set('attachment', null)}>
                      Remove
                    </Button>
                  </>
                )}
                {!draft.attachment && <span className="field__hint">A PDF or photo of their bill, up to 25 MB.</span>}
              </div>
            </div>
          </Card>

          <Card aria-labelledby="items-title" className="table-card">
            <CardHeader id="items-title" title="Items" description="Rates are before GST. An item not counted yet starts being counted when its goods are received." />
            <div className="card__body" style={{ paddingBottom: 0 }}>
              <ItemPicker id="bill-items" rows={rows} onPick={addItem} />
              {shown('items') && (
                <p className="field__error" role="alert" style={{ marginTop: 'var(--space-2)' }}>
                  <WarningCircleIcon size={14} weight="fill" aria-hidden />
                  {shown('items')}
                </p>
              )}
            </div>
            {draft.lines.length > 0 ? (
              <div className="table-scroll">
                <table className="table bill-lines">
                  <caption className="visually-hidden">Items on this bill</caption>
                  <thead>
                    <tr>
                      <th scope="col">Item</th>
                      <th scope="col">Qty</th>
                      <th scope="col">Unit</th>
                      <th scope="col">Rate (₹)</th>
                      <th scope="col">Disc %</th>
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
                    {draft.lines.map((line, index) => {
                      const counted = stockByKey.get(itemKey(line.productId, line.option));
                      const numbers = numbersOf(draft).items[index]!;
                      const fieldError = shown(`${line.key}-qty`) ?? shown(`${line.key}-rate`) ?? shown(`${line.key}-discount`);
                      return (
                        <tr key={line.key}>
                          <td>
                            <div className="cell-title" style={{ whiteSpace: 'normal' }}>
                              {line.title}
                            </div>
                            <div className="cell-sub mono">{line.code}</div>
                            {counted && <div className="cell-sub">{formatQty(counted.quantity)} {UNITS[counted.unit]} in stock now</div>}
                            {fieldError && (
                              <p className="field__error" role="alert">
                                {fieldError}
                              </p>
                            )}
                          </td>
                          <td>
                            <input id={`bill-${line.key}-qty`} className="input" aria-label={`Quantity of ${line.title}`} inputMode="decimal" value={line.qty} onChange={(event) => setLine(line.key, { qty: event.target.value })} aria-invalid={Boolean(shown(`${line.key}-qty`)) || undefined} style={{ width: 84 }} />
                          </td>
                          <td>
                            <select
                              className="select"
                              aria-label={`Unit of ${line.title}`}
                              value={counted?.unit ?? line.unit}
                              disabled={Boolean(counted)}
                              title={counted ? `Counted in ${UNITS[counted.unit]}` : undefined}
                              onChange={(event) => setLine(line.key, { unit: event.target.value as StockUnit })}
                              style={{ width: 120 }}
                            >
                              {(Object.keys(UNITS) as StockUnit[]).map((unit) => (
                                <option key={unit} value={unit}>
                                  {UNITS[unit]}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <input id={`bill-${line.key}-rate`} className="input" aria-label={`Rate of ${line.title}, before GST`} inputMode="decimal" value={line.rate} onChange={(event) => setLine(line.key, { rate: event.target.value })} aria-invalid={Boolean(shown(`${line.key}-rate`)) || undefined} style={{ width: 104 }} />
                          </td>
                          <td>
                            <input id={`bill-${line.key}-discount`} className="input" aria-label={`Discount on ${line.title}, percent`} inputMode="decimal" value={line.discountPct} placeholder="0" onChange={(event) => setLine(line.key, { discountPct: event.target.value })} aria-invalid={Boolean(shown(`${line.key}-discount`)) || undefined} style={{ width: 72 }} />
                          </td>
                          <td>
                            <select className="select" aria-label={`GST on ${line.title}`} value={line.gstRate} onChange={(event) => setLine(line.key, { gstRate: event.target.value })} style={{ width: 92 }}>
                              {GST_RATES.map((rate) => (
                                <option key={rate} value={String(rate)}>
                                  {rate}%
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="is-num" style={{ fontWeight: 600 }}>
                            {formatMoney(lineAmount(numbers))}
                            <div className="cell-sub">+ GST {formatMoney(r2((lineAmount(numbers) * numbers.gstRate) / 100))}</div>
                          </td>
                          <td>
                            <IconButton icon={TrashIcon} tone="danger" label={`Remove ${line.title}`} onClick={() => set('lines', draft.lines.filter((one) => one.key !== line.key))} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="card__body muted">No items yet. Search above, or scan a barcode, to add them.</p>
            )}
          </Card>

          <Card aria-labelledby="charges-title">
            <CardHeader id="charges-title" title="Charges and notes" />
            <div className="card__body form-grid">
              <TextField id="bill-freight" label="Freight" prefix="₹" inputMode="decimal" value={draft.freight} onChange={(event) => set('freight', event.target.value)} error={shown('freight')} placeholder="0" autoComplete="off" />
              <TextField id="bill-otherCharges" label="Other charges" prefix="₹" inputMode="decimal" value={draft.otherCharges} onChange={(event) => set('otherCharges', event.target.value)} error={shown('otherCharges')} placeholder="0" hint="Loading, packing, cutting." autoComplete="off" />
              <TextField id="bill-discount" label="Bill discount" prefix="₹" inputMode="decimal" value={draft.discount} onChange={(event) => set('discount', event.target.value)} error={shown('discount')} placeholder="0" hint="Taken off the whole bill." autoComplete="off" />
              <div className="row" style={{ alignItems: 'flex-end', gap: 'var(--space-2)' }}>
                <div style={{ flex: 1 }}>
                  <TextField id="bill-roundOff" label="Round off" prefix="₹" inputMode="decimal" value={draft.roundOff} onChange={(event) => set('roundOff', event.target.value)} error={shown('roundOff')} placeholder="0" autoComplete="off" />
                </div>
                <Button size="sm" onClick={roundToRupee} style={{ marginBottom: 6 }}>
                  To ₹
                </Button>
              </div>
              <TextAreaField className="span-2" label="Notes" value={draft.notes} onChange={(event) => set('notes', event.target.value)} rows={2} maxLength={2000} placeholder="e.g. 2 sheets short, to come next week" />
            </div>
          </Card>
        </div>

        <div className="stack editor__aside">
          <Card aria-labelledby="total-title">
            <CardHeader id="total-title" title="Total" />
            <div className="card__body stack">
              <Totals subtotal={totals.subtotal} tax={totals.tax} freight={numbersOf(draft).freight} otherCharges={numbersOf(draft).otherCharges} discount={numbersOf(draft).discount} roundOff={numbersOf(draft).roundOff} total={totals.total} />
              <Button variant="primary" icon={CheckCircleIcon} block loading={saving === 'receive'} disabled={saving !== null} onClick={() => setConfirmReceive(true)}>
                Save and Receive Goods
              </Button>
              <Button type="submit" block loading={saving === 'draft'} disabled={saving !== null}>
                Save as Draft
              </Button>
              <p className="field__hint" style={{ margin: 0 }}>
                Receiving adds the items to stock once and locks the bill. A received bill is cancelled, not edited.
              </p>
            </div>
          </Card>
        </div>
      </div>

      <ConfirmDialog
        open={confirmReceive}
        title="Receive the goods on this bill?"
        body={`${draft.lines.length} ${draft.lines.length === 1 ? 'item goes' : 'items go'} into stock, and the bill (${formatMoney(totals.total)}) is locked. To undo it later, you cancel the bill, which takes the stock back out.`}
        confirmLabel="Receive Goods"
        onCancel={() => setConfirmReceive(false)}
        onConfirm={() => save(true)}
      />
      <ConfirmDialog
        open={confirmDelete}
        title={`Delete ${bill?.number ?? 'this draft'}?`}
        body="It’s a draft, so no stock has moved and nothing else changes."
        confirmLabel="Delete Draft"
        destructive
        onCancel={() => setConfirmDelete(false)}
        onConfirm={remove}
      />
      <ConfirmDialog
        open={blocker.state === 'blocked'}
        title="Leave without saving?"
        body="Your changes to this bill will be lost."
        confirmLabel="Leave"
        destructive
        onCancel={() => blocker.reset?.()}
        onConfirm={() => blocker.proceed?.()}
      />
      <SupplierDrawer
        open={addingSupplier}
        supplier={null}
        onClose={() => setAddingSupplier(false)}
        onSaved={(saved) => {
          keepSupplier(saved);
          set('supplierId', String(saved.id));
          setAddingSupplier(false);
        }}
      />
    </form>
  );
}

/** Search the catalogue by name, code, SKU or barcode. A scanner types the barcode and Enter, which adds an exact match. */
function Totals(props: { subtotal: number; tax: number; freight: number; otherCharges: number; discount: number; roundOff: number; total: number }) {
  return (
    <dl className="kv kv--compact kv--split" style={{ margin: 0 }}>
      <dt>Taxable value</dt>
      <dd className="num">{formatMoney(props.subtotal)}</dd>
      <dt>GST</dt>
      <dd className="num">{formatMoney(props.tax)}</dd>
      {props.freight > 0 && (
        <>
          <dt>Freight</dt>
          <dd className="num">{formatMoney(props.freight)}</dd>
        </>
      )}
      {props.otherCharges > 0 && (
        <>
          <dt>Other charges</dt>
          <dd className="num">{formatMoney(props.otherCharges)}</dd>
        </>
      )}
      {props.discount > 0 && (
        <>
          <dt>Discount</dt>
          <dd className="num">−{formatMoney(props.discount)}</dd>
        </>
      )}
      {props.roundOff !== 0 && (
        <>
          <dt>Round off</dt>
          <dd className="num">{formatMoney(props.roundOff)}</dd>
        </>
      )}
      <dt style={{ fontWeight: 600, color: 'var(--text)' }}>Total</dt>
      <dd className="num" style={{ fontWeight: 700, fontSize: 'var(--text-lg)' }}>
        {formatMoney(props.total)}
      </dd>
    </dl>
  );
}

/** A received or cancelled bill: read-only, with its payments; cancelling takes its stock back out. */
function BillView({ bill, supplier, purchasing }: { bill: Purchase; supplier?: Supplier; purchasing: Purchasing }) {
  const { send } = useData();
  const toast = useToast();
  const { apply, reload } = purchasing;
  const [paying, setPaying] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [removing, setRemoving] = useState<SupplierPayment | null>(null);
  const today = localDay();
  const state = payState(bill, supplier, today);
  const due = bill.status === 'received' ? dueOf(bill, supplier) : null;
  const cancelled = bill.status === 'cancelled';

  const cancel = async () => {
    setCancelling(false);
    const answer = await send(`/purchases/${bill.id}/cancel`, 'POST', undefined, { area: 'purchases', summary: `Cancelled ${bill.number} from ${bill.supplier.name}: its goods taken back out of stock`, to: `/purchases/${bill.id}` });
    if (!answer) return;
    apply(answer);
    void reload();
    toast({ message: `${bill.number} cancelled. Its items were taken back out of stock.` });
  };

  const removePayment = async (payment: SupplierPayment) => {
    setRemoving(null);
    const answer = await send(`/suppliers/${bill.supplier.id}/payments/${payment.id}`, 'DELETE', undefined, {
      area: 'purchases',
      summary: `Removed a ${formatMoney(payment.amount)} payment to ${bill.supplier.name} from ${bill.number}`,
      to: `/purchases/${bill.id}`,
    });
    if (!answer) return;
    apply(answer);
    toast({ message: 'Payment removed.' });
  };

  return (
    <>
      <PageHeader
        title={`Purchase ${bill.number}`}
        crumbs={[{ label: 'Purchases', to: '/purchases' }]}
        description={
          <>
            <Link to={`/suppliers/${bill.supplier.id}`}>{bill.supplier.name}</Link> · {bill.supplierInvoice ? `their bill ${bill.supplierInvoice}, ` : ''}
            {dayLabel(bill.billDate)}
          </>
        }
        actions={
          <>
            <Button icon={PrinterIcon} onClick={() => window.print()} className="no-print">
              Print
            </Button>
            {!cancelled && balanceOf(bill) > 0 && supplier && (
              <Button variant="primary" icon={WalletIcon} onClick={() => setPaying(true)} className="no-print">
                Record Payment
              </Button>
            )}
          </>
        }
      />

      <p className={`notice ${cancelled ? 'notice--warning' : ''}`} style={{ marginBottom: 'var(--space-4)' }}>
        {cancelled ? <XCircleIcon size={16} weight="bold" aria-hidden /> : <CheckCircleIcon size={16} weight="bold" aria-hidden />}
        <span>
          {cancelled
            ? `Cancelled ${bill.cancelledAt ? formatDateTime(bill.cancelledAt) : ''} by ${bill.cancelledBy ?? 'staff'}. Any stock it brought in was taken back out.`
            : `Goods received ${bill.receivedAt ? formatDateTime(bill.receivedAt) : ''} by ${bill.receivedBy ?? 'staff'}: these items went into stock.`}
          {cancelled && paidOf(bill) > 0 && ` ${formatMoney(paidOf(bill))} was paid on it: get it back from the supplier, or remove the payment.`}
        </span>
      </p>

      <div className="editor">
        <div className="stack">
          <Card aria-labelledby="view-items" className="table-card">
            <CardHeader id="view-items" title="Items" description={`${bill.items.length} ${bill.items.length === 1 ? 'item' : 'items'} · rates before GST`} />
            <div className="table-scroll">
              <table className="table">
                <caption className="visually-hidden">Items on {bill.number}</caption>
                <thead>
                  <tr>
                    <th scope="col">Item</th>
                    <th scope="col" className="is-num">
                      Qty
                    </th>
                    <th scope="col" className="is-num">
                      Rate
                    </th>
                    <th scope="col" className="is-num">
                      Disc
                    </th>
                    <th scope="col" className="is-num">
                      GST
                    </th>
                    <th scope="col" className="is-num">
                      Amount
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {bill.items.map((item, index) => (
                    <tr key={`${item.productId}-${item.option}-${index}`}>
                      <td>
                        <div className="cell-title" style={{ whiteSpace: 'normal' }}>
                          {item.name}
                        </div>
                        <div className="cell-sub mono">{item.code}</div>
                      </td>
                      <td className="is-num">
                        {formatQty(item.qty)} {UNITS[item.unit]}
                      </td>
                      <td className="is-num">{formatMoney(item.rate)}</td>
                      <td className="is-num">{item.discountPct ? `${item.discountPct}%` : '—'}</td>
                      <td className="is-num">{item.gstRate}%</td>
                      <td className="is-num">{formatMoney(lineAmount(item))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          {bill.notes && (
            <Card aria-labelledby="view-notes">
              <CardHeader id="view-notes" title="Notes" />
              <p className="card__body">{bill.notes}</p>
            </Card>
          )}
        </div>

        <div className="stack editor__aside">
          <Card aria-labelledby="view-total">
            <CardHeader id="view-total" title="Total" action={<Badge tone={PURCHASE_STATUS[bill.status].tone}>{PURCHASE_STATUS[bill.status].label}</Badge>} />
            <div className="card__body">
              <Totals subtotal={bill.subtotal} tax={bill.tax} freight={bill.freight} otherCharges={bill.otherCharges} discount={bill.discount} roundOff={bill.roundOff} total={bill.total} />
            </div>
          </Card>

          <Card aria-labelledby="view-payment" className="no-print">
            <CardHeader id="view-payment" title="Payment" action={<Badge tone={state.tone}>{state.label}</Badge>} />
            <div className="card__body">
              <dl className="kv kv--compact kv--split" style={{ margin: 0 }}>
                <dt>Paid</dt>
                <dd className="num">{formatMoney(paidOf(bill))}</dd>
                <dt>To pay</dt>
                <dd className={state.tone === 'danger' ? 'num money-late' : 'num'} style={{ fontWeight: 600 }}>
                  {formatMoney(balanceOf(bill))}
                </dd>
                {due && (
                  <>
                    <dt>Due</dt>
                    <dd className={state.tone === 'danger' ? 'money-late' : undefined}>{dayLabel(due)}</dd>
                  </>
                )}
              </dl>
            </div>
            {(bill.payments ?? []).length > 0 && (
              <ul className="list" aria-label="Payments">
                {[...(bill.payments ?? [])].reverse().map((payment) => (
                  <li key={payment.id} className="list-row">
                    <span className="list-row__main">
                      <span className="list-row__title num" style={{ display: 'block' }}>
                        {formatMoney(payment.amount)} · {PAYMENT_METHODS[payment.method]}
                      </span>
                      <span className="list-row__meta">
                        {dayLabel(payment.paidOn)} · {payment.by}
                        {payment.note && ` · ${payment.note}`}
                      </span>
                    </span>
                    <IconButton icon={TrashIcon} tone="danger" label={`Remove the ${formatMoney(payment.amount)} payment`} onClick={() => setRemoving(payment)} />
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card aria-labelledby="view-bill" className="no-print">
            <CardHeader id="view-bill" title="Bill" />
            <div className="card__body stack">
              <dl className="kv kv--compact" style={{ margin: 0 }}>
                <dt>Supplier</dt>
                <dd>
                  <Link to={`/suppliers/${bill.supplier.id}`}>{bill.supplier.name}</Link>
                </dd>
                <dt>Their bill</dt>
                <dd>{bill.supplierInvoice ?? '—'}</dd>
                <dt>Entered by</dt>
                <dd>{bill.createdBy}</dd>
              </dl>
              {bill.attachment && (
                <a className="btn btn--secondary btn--sm" href={bill.attachment} target="_blank" rel="noreferrer">
                  View the bill copy
                </a>
              )}
              {!cancelled && (
                <Button variant="danger-plain" icon={XCircleIcon} onClick={() => setCancelling(true)}>
                  Cancel Bill
                </Button>
              )}
            </div>
          </Card>
        </div>
      </div>

      {supplier && <SupplierPaymentDrawer open={paying} onClose={() => setPaying(false)} supplier={supplier} bills={[bill]} billId={bill.id} onSaved={(answer) => {
        apply(answer);
        void reload();
      }} />}
      <ConfirmDialog
        open={cancelling}
        title={`Cancel ${bill.number}?`}
        body={`The ${bill.items.length === 1 ? 'item it brought into stock is' : `${bill.items.length} items it brought into stock are`} taken back out. The bill stays on record as cancelled${paidOf(bill) > 0 ? `, and its ${formatMoney(paidOf(bill))} of payments stay recorded` : ''}. This can’t be undone; enter the bill again if it was right.`}
        confirmLabel="Cancel Bill"
        destructive
        onCancel={() => setCancelling(false)}
        onConfirm={cancel}
      />
      <ConfirmDialog
        open={Boolean(removing)}
        title={removing ? `Remove the ${formatMoney(removing.amount)} payment?` : 'Remove payment?'}
        body={removing ? `${PAYMENT_METHODS[removing.method]} on ${dayLabel(removing.paidOn)}, recorded by ${removing.by}. ${bill.number} will owe it again. Only do this if it was entered by mistake.` : ''}
        confirmLabel="Remove Payment"
        destructive
        onCancel={() => setRemoving(null)}
        onConfirm={() => removing && removePayment(removing)}
      />
    </>
  );
}
