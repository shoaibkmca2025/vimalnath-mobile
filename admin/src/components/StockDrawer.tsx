import { useEffect, useState } from 'react';
import { Link } from 'react-router';

import { Badge } from '@/components/Badge';
import { PencilSimpleIcon } from '@phosphor-icons/react';

import { Button, ButtonLink } from '@/components/Button';
import { ConfirmDialog } from '@/components/Dialog';
import { Drawer } from '@/components/Drawer';
import { Segmented, SelectField, TextField } from '@/components/Field';
import { Thumb } from '@/components/Thumb';
import { useToast } from '@/components/useToast';
import { readSession } from '@/data/session';
import { ADJUST_REASONS, GST_RATES, MOVE_LABEL, STATE_LABEL, UNITS, editsStock, formatPrice, formatQty, type AdjustReason, type ItemSave, type StockRow } from '@/data/stock';
import type { StockItem, StockMove, StockUnit } from '@/data/types';
import { useData } from '@/data/useData';
import { api } from '@/lib/api';
import { formatDateTime, formatINR } from '@/lib/format';

type Draft = Record<'sku' | 'barcode' | 'brand' | 'manufacturer' | 'hsn' | 'gstRate' | 'purchasePrice' | 'sellingPrice' | 'wholesalePrice' | 'minStock' | 'maxStock' | 'rack' | 'location' | 'opening', string> & { unit: StockUnit };
type Mode = 'add' | 'remove' | 'count';

const text = (value: number | null | undefined) => (value === null || value === undefined ? '' : String(value));
const draftOf = (item: StockItem | undefined): Draft => ({
  sku: item?.sku ?? '',
  barcode: item?.barcode ?? '',
  unit: item?.unit ?? 'pcs',
  brand: item?.brand ?? '',
  manufacturer: item?.manufacturer ?? '',
  hsn: item?.hsn ?? '',
  gstRate: text(item?.gstRate),
  purchasePrice: text(item?.purchasePrice),
  sellingPrice: text(item?.sellingPrice),
  wholesalePrice: text(item?.wholesalePrice),
  minStock: text(item?.minStock),
  maxStock: text(item?.maxStock),
  rack: item?.rack ?? '',
  location: item?.location ?? '',
  opening: '',
});

const PRICE = /^\d{1,9}(\.\d{1,2})?$/;
const QUANTITY = /^\d{1,8}(\.\d{1,3})?$/;
const value = (input: string) => (input.trim() === '' ? null : Number(input.trim()));

function errorsOf(draft: Draft, isNew: boolean) {
  const price = (input: string) => (input.trim() && !PRICE.test(input.trim()) ? 'Enter rupees and paise, e.g. 125.50.' : null);
  const quantity = (input: string) => (input.trim() && !QUANTITY.test(input.trim()) ? 'Enter a number, up to 3 decimal places.' : null);
  const min = value(draft.minStock);
  const max = value(draft.maxStock);
  return {
    opening: isNew && !QUANTITY.test(draft.opening.trim()) ? 'Enter the stock you have now, e.g. 25. Enter 0 if none.' : null,
    barcode: /^[\w\-./ ]*$/.test(draft.barcode) ? null : 'Use letters, numbers and - . / for the barcode.',
    hsn: /^(\d{4}|\d{6}|\d{8})?$/.test(draft.hsn.trim()) ? null : 'Enter the HSN code: 4, 6 or 8 digits.',
    purchasePrice: price(draft.purchasePrice),
    sellingPrice: price(draft.sellingPrice),
    wholesalePrice: price(draft.wholesalePrice),
    minStock: quantity(draft.minStock),
    maxStock: quantity(draft.maxStock) ?? (min !== null && max !== null && max < min ? 'The maximum can’t be below the minimum.' : null),
  };
}

/** One item's stock: its details, adjustments, and every change to its quantity. Sales see it without editing. */
export function StockDrawer({ row, open, onClose }: { row: StockRow | null; open: boolean; onClose: () => void }) {
  const { send } = useData();
  const toast = useToast();
  const role = readSession()?.role;
  const owner = role === 'owner';
  const canEdit = editsStock(role);
  const item = row?.stock;
  const isNew = !item;

  const [draft, setDraft] = useState<Draft>(() => draftOf(item));
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<Mode>('add');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState<AdjustReason | ''>('');
  const [note, setNote] = useState('');
  const [adjustTouched, setAdjustTouched] = useState(false);
  const [moves, setMoves] = useState<StockMove[] | null>(null);
  const [removing, setRemoving] = useState(false);

  // Each time it opens on an item, or that item is saved, the form shows what's saved.
  const [source, setSource] = useState<string | null>(null);
  const sourceKey = open && row ? `${row.key}:${item?.updatedAt ?? 'new'}` : null;
  if (sourceKey !== source) {
    setSource(sourceKey);
    if (sourceKey) {
      setDraft(draftOf(item));
      setTouched(false);
      setAmount('');
      setReason('');
      setNote('');
      setAdjustTouched(false);
    }
  }

  const productId = row?.productId;
  const option = row?.option;
  const updatedAt = item?.updatedAt;
  useEffect(() => {
    if (!open || productId === undefined || option === undefined || !updatedAt) return;
    let active = true;
    api<StockMove[]>(`/stock/moves?productId=${encodeURIComponent(productId)}&option=${encodeURIComponent(option)}`).then(
      (loaded) => active && setMoves(loaded),
      () => active && setMoves([]),
    );
    return () => {
      active = false;
      setMoves(null);
    };
  }, [open, productId, option, updatedAt]);

  if (!row) return null;
  const errors = errorsOf(draft, isNew);
  const firstError = Object.entries(errors).find(([, message]) => message);
  const shown = (field: keyof typeof errors) => (touched ? errors[field] : null);
  const set = <K extends keyof Draft>(field: K, next: Draft[K]) => setDraft((current) => ({ ...current, [field]: next }));
  const dirty = JSON.stringify(draft) !== JSON.stringify(draftOf(item));
  const unit = UNITS[item?.unit ?? draft.unit];
  const state = STATE_LABEL[row.state];

  const save = async () => {
    setTouched(true);
    if (firstError) {
      document.getElementById(`stock-${firstError[0]}`)?.focus();
      return;
    }
    setSaving(true);
    const body: ItemSave = {
      productId: row.productId,
      option: row.option,
      sku: draft.sku.trim(),
      barcode: draft.barcode.trim(),
      unit: draft.unit,
      brand: draft.brand.trim(),
      manufacturer: draft.manufacturer.trim(),
      hsn: draft.hsn.trim(),
      gstRate: value(draft.gstRate),
      ...(owner ? { purchasePrice: value(draft.purchasePrice) } : {}),
      sellingPrice: value(draft.sellingPrice),
      wholesalePrice: value(draft.wholesalePrice),
      minStock: value(draft.minStock),
      maxStock: value(draft.maxStock),
      rack: draft.rack.trim(),
      location: draft.location.trim(),
      ...(isNew ? { quantity: Number(draft.opening.trim()) } : {}),
    };
    const ok = await send('/stock', 'PUT', { items: [body] }, {
      area: 'catalogue',
      summary: isNew ? `Started counting ${row.title}: ${formatQty(body.quantity!)} ${UNITS[draft.unit]}` : `Updated the stock details of ${row.title}`,
      to: '/stock',
    });
    setSaving(false);
    if (ok) toast({ message: isNew ? `${row.title} is now counted.` : 'Stock details saved.' });
  };

  const amountValue = Number(amount.trim());
  const adjustError = !QUANTITY.test(amount.trim())
    ? 'Enter a quantity, up to 3 decimal places.'
    : mode !== 'count' && amountValue === 0
      ? 'Enter a quantity above 0.'
      : mode !== 'count' && !reason
        ? 'Choose a reason.'
        : null;
  const adjust = async () => {
    setAdjustTouched(true);
    if (adjustError || !item) return;
    const change = mode === 'add' ? amountValue : -amountValue;
    const ok = await send(
      '/stock/adjust',
      'POST',
      { productId: row.productId, option: row.option, ...(mode === 'count' ? { count: amountValue } : { change, reason }), note: note.trim() },
      {
        area: 'catalogue',
        summary:
          mode === 'count'
            ? `Counted ${row.title}: ${formatQty(amountValue)} ${unit} (was ${formatQty(item.quantity)})`
            : `${mode === 'add' ? 'Added' : 'Took away'} ${formatQty(amountValue)} ${unit} of ${row.title}: ${ADJUST_REASONS[reason as AdjustReason].toLowerCase()}`,
        to: '/stock',
      },
    );
    if (ok) toast({ message: 'Stock updated.' });
  };

  const remove = async () => {
    setRemoving(false);
    const ok = await send(`/stock/item?productId=${encodeURIComponent(row.productId)}&option=${encodeURIComponent(row.option)}`, 'DELETE', undefined, {
      area: 'catalogue',
      summary: `Stopped counting ${row.title}`,
      to: '/stock',
    });
    if (ok) {
      toast({ message: `${row.title} is no longer counted.` });
      onClose();
    }
  };

  const field = (name: keyof Draft, label: string, extra: Partial<Parameters<typeof TextField>[0]> = {}) => (
    <TextField
      id={`stock-${name}`}
      label={label}
      value={draft[name]}
      onChange={(event) => set(name, event.target.value)}
      error={name in errors ? shown(name as keyof typeof errors) : null}
      disabled={!canEdit}
      autoComplete="off"
      {...extra}
    />
  );

  return (
    <Drawer
      open={open}
      title={row.title}
      description={[row.code, row.mrp ? `MRP ${formatINR(row.mrp)}` : 'Priced from the catalogue page'].filter(Boolean).join(' · ')}
      dirty={canEdit && (dirty || Boolean(amount.trim()))}
      onClose={onClose}
      onSubmit={canEdit ? save : undefined}
      footer={
        canEdit ? (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="primary" loading={saving} disabled={!isNew && !dirty}>
              {isNew ? 'Start Counting' : 'Save Details'}
            </Button>
          </>
        ) : (
          <Button onClick={onClose}>Close</Button>
        )
      }
    >
      <div className="stack-lg">
        <div className="row" style={{ gap: 'var(--space-3)' }}>
          <Thumb src={row.product?.image} />
          <div style={{ flex: 1, minWidth: 0 }}>
            {item ? (
              <p style={{ margin: 0, fontSize: 'var(--text-xl)', fontWeight: 700 }} className="num">
                {formatQty(item.quantity)} {unit}
              </p>
            ) : (
              <p className="muted" style={{ margin: 0 }}>
                {canEdit ? 'Not counted yet. Enter what you have now to start.' : 'Not counted yet.'}
              </p>
            )}
            <Badge tone={state.tone}>{state.label}</Badge>
          </div>
        </div>

        {row.state === 'out' && item && item.quantity < 0 && (
          <p className="notice notice--warning">More was delivered than was counted. Count it again and enter what’s really there.</p>
        )}
        {item?.orphan && <p className="notice notice--warning">This option was renamed or removed in the product, so orders no longer take from this stock.</p>}

        {owner && (row.product || item) && (
          <div className="row-wrap">
            {row.product && (
              <ButtonLink size="sm" icon={PencilSimpleIcon} to={`/products/${encodeURIComponent(row.productId)}?back=stock`}>
                Edit Product
              </ButtonLink>
            )}
            {item && (
              <Button size="sm" variant="danger-plain" onClick={() => setRemoving(true)}>
                Stop Counting
              </Button>
            )}
          </div>
        )}

        {item && canEdit && (
          <section className="stack" aria-labelledby="adjust-title">
            <h3 id="adjust-title" className="field__label" style={{ margin: 0 }}>
              Change the stock
            </h3>
            <Segmented<Mode>
              label="Change"
              value={mode}
              onChange={(next) => {
                setMode(next);
                setAdjustTouched(false);
              }}
              options={[
                { value: 'add', label: 'Add' },
                { value: 'remove', label: 'Take away' },
                { value: 'count', label: 'Counted' },
              ]}
            />
            <div className="form-grid">
              <TextField
                label={mode === 'count' ? 'Counted quantity' : 'Quantity'}
                inputMode="decimal"
                suffix={unit}
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                error={adjustTouched && adjustError !== 'Choose a reason.' ? adjustError : null}
                hint={mode === 'count' ? `Replaces the ${formatQty(item.quantity)} recorded.` : undefined}
                autoComplete="off"
              />
              {mode !== 'count' && (
                <SelectField
                  label="Reason"
                  value={reason}
                  onChange={(event) => setReason(event.target.value as AdjustReason)}
                  error={adjustTouched && adjustError === 'Choose a reason.' ? adjustError : null}
                  options={[{ value: '', label: 'Choose…' }, ...(Object.keys(ADJUST_REASONS) as AdjustReason[]).map((key) => ({ value: key, label: ADJUST_REASONS[key] }))]}
                />
              )}
              <TextField className="span-2" label="Note" value={note} onChange={(event) => setNote(event.target.value)} maxLength={300} placeholder="e.g. 2 pieces bent in transit" autoComplete="off" />
            </div>
            <div>
              <Button onClick={adjust}>{mode === 'count' ? 'Save Count' : mode === 'add' ? 'Add Stock' : 'Take Away Stock'}</Button>
            </div>
          </section>
        )}

        <section className="stack" aria-labelledby="details-title">
          <h3 id="details-title" className="field__label" style={{ margin: 0 }}>
            Details
          </h3>
          <div className="form-grid">
            {isNew && canEdit && field('opening', 'Stock you have now', { inputMode: 'decimal', suffix: UNITS[draft.unit], required: true, className: 'span-2' })}
            <SelectField
              label="Unit"
              value={draft.unit}
              onChange={(event) => set('unit', event.target.value as StockUnit)}
              disabled={!canEdit}
              options={(Object.keys(UNITS) as StockUnit[]).map((key) => ({ value: key, label: UNITS[key] }))}
            />
            {field('rack', 'Rack', { placeholder: 'e.g. A-3' })}
            {field('location', 'Warehouse', { placeholder: 'e.g. Main godown', className: 'span-2' })}
            {field('minStock', 'Minimum stock', { inputMode: 'decimal', hint: 'At or below this, it’s low stock.' })}
            {field('maxStock', 'Maximum stock', { inputMode: 'decimal', hint: 'Above this, it’s overstocked.' })}
            {owner && field('purchasePrice', 'Purchase price', { inputMode: 'decimal', prefix: '₹', hint: 'Before GST. Only Owners see it.' })}
            {field('sellingPrice', 'Selling price', { inputMode: 'decimal', prefix: '₹' })}
            {field('wholesalePrice', 'Wholesale price', { inputMode: 'decimal', prefix: '₹' })}
            <SelectField
              label="GST rate"
              value={draft.gstRate}
              onChange={(event) => set('gstRate', event.target.value)}
              disabled={!canEdit}
              options={[{ value: '', label: 'Not set' }, ...GST_RATES.map((rate) => ({ value: String(rate), label: `${rate}%` }))]}
            />
            {field('hsn', 'HSN code', { inputMode: 'numeric', placeholder: 'e.g. 8302' })}
            {field('sku', 'SKU')}
            {field('barcode', 'Barcode')}
            {field('brand', 'Brand')}
            {field('manufacturer', 'Manufacturer')}
          </div>
          {item && (item.sellingPrice !== null || item.purchasePrice !== null) && (
            <p className="field__hint" style={{ margin: 0 }}>
              {[item.purchasePrice !== null && `Bought at ${formatPrice(item.purchasePrice)}`, item.sellingPrice !== null && `sells at ${formatPrice(item.sellingPrice)}`].filter(Boolean).join(', ')}
              {item.purchasePrice !== null && item.sellingPrice !== null && item.purchasePrice > 0 && ` (${Math.round(((item.sellingPrice - item.purchasePrice) / item.purchasePrice) * 100)}% margin)`}.
            </p>
          )}
        </section>

        {item && (
          <section aria-labelledby="history-title">
            <h3 id="history-title" className="field__label" style={{ margin: '0 0 var(--space-2)' }}>
              History
            </h3>
            {moves === null ? (
              <p className="muted">Loading…</p>
            ) : (
              <ul className="list">
                {moves.map((step) => (
                  <li key={step.id} className="list-row">
                    <span className="list-row__main">
                      <span className="list-row__title" style={{ display: 'block' }}>
                        {MOVE_LABEL[step.kind]}
                        {step.reason && step.reason in ADJUST_REASONS && `: ${ADJUST_REASONS[step.reason as AdjustReason].toLowerCase()}`}
                        {step.orderId && (
                          <>
                            {' '}
                            <Link to={`/orders/${step.orderId}`} className="num">
                              {step.orderNumber}
                            </Link>
                          </>
                        )}
                      </span>
                      <span className="list-row__meta">
                        {formatDateTime(step.at)} · {step.by}
                        {step.note && ` · ${step.note}`}
                        {!(step.reason in ADJUST_REASONS) && step.reason && ` · ${step.reason}`}
                      </span>
                    </span>
                    <span className="num" style={{ textAlign: 'right' }}>
                      <span style={{ display: 'block', fontWeight: 600, color: step.change < 0 ? 'var(--danger)' : 'var(--success)' }}>
                        {step.change > 0 ? '+' : ''}
                        {formatQty(step.change)}
                      </span>
                      <span className="cell-sub">= {formatQty(step.balance)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>

      <ConfirmDialog
        open={removing}
        title={`Stop counting ${row.title}?`}
        body={
          item?.orphan
            ? 'Its stock figure and history are removed. Orders already don’t take from it, because its option is gone from the product.'
            : 'Its stock figure and history are removed, and delivered orders stop taking from it until you count it again. The product stays in the Shop.'
        }
        confirmLabel="Stop Counting"
        destructive
        onCancel={() => setRemoving(false)}
        onConfirm={remove}
      />
    </Drawer>
  );
}
