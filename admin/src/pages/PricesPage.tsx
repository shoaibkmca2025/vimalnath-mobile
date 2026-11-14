import { CurrencyInrIcon, PercentIcon } from '@phosphor-icons/react';
import { useEffect, useId, useMemo, useState } from 'react';
import { Link, useBlocker, useSearchParams } from 'react-router';

import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { DataTable, type Column } from '@/components/DataTable';
import { ConfirmDialog } from '@/components/Dialog';
import { Drawer } from '@/components/Drawer';
import { EmptyState } from '@/components/EmptyState';
import { SearchInput, Segmented, SelectField, TextField } from '@/components/Field';
import { PageHeader } from '@/components/PageHeader';
import { useToast } from '@/components/useToast';
import { bulkPrice, priceRows, withPrices, type BulkChange, type PriceRow } from '@/data/prices';
import { readSession } from '@/data/session';
import type { CatalogSource } from '@/data/types';
import { useData } from '@/data/useData';
import { api } from '@/lib/api';
import { cx } from '@/lib/cx';
import { formatDateTime, formatINR, formatNumber, plural } from '@/lib/format';

type View = 'all' | 'changed' | 'history';
type PriceChange = { id: string; productId: string; code: string; product: string; option: string; oldMrp: number | null; newMrp: number | null; by: string; reason: string; at: string };

const SOURCE_NAME: Record<CatalogSource, string> = { master: 'Master Catalogue', office: 'Office Partition', tavic: 'Tavic Wardrobe & Sliding' };
const ROUNDING: { value: string; label: string }[] = [
  { value: '1', label: 'To the nearest ₹1' },
  { value: '10', label: 'To the nearest ₹10' },
  { value: '50', label: 'To the nearest ₹50' },
  { value: '100', label: 'To the nearest ₹100' },
];

/** "+8%", or "+₹11" when the change is too small to show as a percentage of a large price. */
const percent = (from: number, to: number) => {
  const change = Number((((to - from) / from) * 100).toFixed(1));
  if (change === 0) return `${to >= from ? '+' : '−'}${formatINR(Math.abs(to - from))}`;
  return `${change > 0 ? '+' : ''}${change}%`;
};
/** Whole rupees above ₹0, as the server requires; null while what's typed isn't one. */
const parsePrice = (text: string) => (/^\d+$/.test(text.trim()) && Number(text) > 0 ? Number(text) : null);

export default function PricesPage() {
  const { db, update } = useData();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const query = params.get('q') ?? '';
  const category = params.get('category') ?? 'all';
  const source = params.get('source') ?? 'all';
  const view = (params.get('view') as View | null) ?? 'all';
  // Sales can look prices up; the server only lets Owners and Catalogue editors change them.
  const canEdit = readSession()?.role !== 'sales';

  /** What's typed in each changed MRP box, by price key. */
  const [drafts, setDrafts] = useState<Map<string, string>>(new Map());
  const [reason, setReason] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [history, setHistory] = useState<PriceChange[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const rows = useMemo(() => priceRows(db.products), [db.products]);
  const byKey = useMemo(() => new Map(rows.map((row) => [row.key, row])), [rows]);

  const { prices, invalid } = useMemo(() => {
    const valid = new Map<string, number>();
    const wrong = new Set<string>();
    for (const [key, text] of drafts) {
      const price = parsePrice(text);
      if (price === null) wrong.add(key);
      else if (price !== byKey.get(key)?.mrp) valid.set(key, price);
    }
    return { prices: valid, invalid: wrong };
  }, [drafts, byKey]);

  /** The rows the search and filters pick out; bulk changes apply to exactly these. */
  const inScope = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter(
      (row) =>
        (category === 'all' || row.category === category) &&
        (source === 'all' || row.source === source) &&
        (!needle || [row.code, row.name, row.option, row.optionCode ?? ''].some((text) => text.toLowerCase().includes(needle))),
    );
  }, [rows, query, category, source]);
  const shown = view === 'changed' ? inScope.filter((row) => drafts.has(row.key)) : inScope;

  const setParam = (key: string, value: string, fallback: string) => {
    const next = new URLSearchParams(params);
    if (value && value !== fallback) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const type = (row: PriceRow, text: string) =>
    setDrafts((current) => {
      const next = new Map(current);
      if (text.trim() === String(row.mrp)) next.delete(row.key);
      else next.set(row.key, text);
      return next;
    });

  const dirty = drafts.size > 0;
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  // Fetched each time History opens, so it includes what was just saved.
  useEffect(() => {
    if (view !== 'history') return;
    let active = true;
    api<PriceChange[]>('/price-history').then(
      (changes) => {
        if (!active) return;
        setHistory(changes);
        setHistoryError(null);
      },
      (error: Error) => active && setHistoryError(error.message),
    );
    return () => {
      active = false;
    };
  }, [view]);

  const discard = () => {
    setDrafts(new Map());
    setReason(null);
  };

  const save = async () => {
    if (saving || invalid.size || !prices.size) return;
    setSaving(true);
    const previous = db.products;
    const count = prices.size;
    const summary = reason ?? `Changed ${plural(count, 'price')}`;
    const ok = await update('products', (products) => withPrices(products, prices), { area: 'catalogue', summary, to: '/prices' });
    setSaving(false);
    if (!ok) return;
    discard();
    if (view === 'changed') setParam('view', 'all', 'all');
    toast({
      message: `${plural(count, 'price')} saved.`,
      action: { label: 'Undo', onAction: () => update('products', () => previous, { area: 'catalogue', summary: `Undid: ${summary}`, to: '/prices' }) },
    });
  };

  const columns: Column<PriceRow>[] = [
    {
      key: 'product',
      header: 'Product',
      sortValue: (row) => row.code,
      cell: (row) => (
        <>
          <Link to={`/products/${row.productId}`} className="cell-title mono">
            {row.code}
          </Link>
          <div className="cell-sub">{row.name}</div>
        </>
      ),
    },
    {
      key: 'option',
      header: 'Option',
      sortValue: (row) => row.option,
      cell: (row) => (
        <>
          <span style={{ whiteSpace: 'normal' }}>{row.option}</span>
          {row.optionCode && row.optionCode !== row.code && <div className="cell-sub mono">{row.optionCode}</div>}
        </>
      ),
    },
    { key: 'source', header: 'Price list', sortValue: (row) => row.source, cell: (row) => <span className="cell-sub">{SOURCE_NAME[row.source]}</span> },
    {
      key: 'mrp',
      header: 'MRP',
      align: 'num',
      sortValue: (row) => prices.get(row.key) ?? row.mrp,
      cell: (row) => <PriceCell row={row} text={drafts.get(row.key)} invalid={invalid.has(row.key)} readOnly={!canEdit} onChange={(text) => type(row, text)} />,
    },
  ];

  const scopeName = [category !== 'all' && db.categories.find((item) => item.id === category)?.label, source !== 'all' && SOURCE_NAME[source as CatalogSource], query.trim() && `matching “${query.trim()}”`]
    .filter(Boolean)
    .join(', ');

  return (
    <>
      <PageHeader
        title="Prices"
        description="The MRP of every option in the Shop. Change one by typing over it, or many at once when a new price list arrives. Nothing changes until you save, and every change is kept in History."
        actions={
          canEdit && (
            <Button icon={PercentIcon} onClick={() => setBulkOpen(true)} disabled={!inScope.length}>
              Change Prices in Bulk
            </Button>
          )
        }
      />

      <div className="toolbar">
        <Segmented
          label="Show"
          value={view}
          onChange={(value) => setParam('view', value, 'all')}
          options={[
            { value: 'all', label: 'All prices', count: inScope.length },
            { value: 'changed', label: 'Changed', count: drafts.size },
            { value: 'history', label: 'History' },
          ]}
        />
        {view !== 'history' && (
          <>
            <SearchInput label="Search prices" placeholder="Code, name or option" value={query} onChange={(value) => setParam('q', value, '')} />
            <label className="visually-hidden" htmlFor="price-category">
              Category
            </label>
            <select id="price-category" className="select" style={{ width: 'auto', minWidth: 180 }} value={category} onChange={(event) => setParam('category', event.target.value, 'all')}>
              <option value="all">All categories</option>
              {db.categories.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
            <label className="visually-hidden" htmlFor="price-source">
              Price list
            </label>
            <select id="price-source" className="select" style={{ width: 'auto', minWidth: 180 }} value={source} onChange={(event) => setParam('source', event.target.value, 'all')}>
              <option value="all">All price lists</option>
              {(Object.keys(SOURCE_NAME) as CatalogSource[]).map((key) => (
                <option key={key} value={key}>
                  {SOURCE_NAME[key]}
                </option>
              ))}
            </select>
          </>
        )}
      </div>

      {view === 'history' ? (
        <HistoryTable changes={history} error={historyError} />
      ) : (
        <Card className="table-card">
          <DataTable
            caption="Prices"
            rows={shown}
            columns={columns}
            getRowId={(row) => row.key}
            resetKey={`${query}|${category}|${source}|${view}`}
            initialSort={{ key: 'product', direction: 'asc' }}
            empty={
              <EmptyState icon={CurrencyInrIcon} title={view === 'changed' ? 'No changes yet' : 'No prices match'} action={view !== 'changed' && (query || category !== 'all' || source !== 'all') && <Button onClick={() => setParams({})}>Clear Filters</Button>}>
                {view === 'changed' ? 'Type a new MRP in any row, or use Change Prices in Bulk.' : 'Products priced from their catalogue page have no MRP to change here.'}
              </EmptyState>
            }
          />
        </Card>
      )}

      {dirty && (
        <div className="savebar" role="region" aria-label="Save prices">
          <span className="savebar__text">
            {plural(prices.size, 'price change')}
            {invalid.size > 0 && <span className="muted"> · {plural(invalid.size, 'box needs', 'boxes need')} a whole-rupee price</span>}
          </span>
          {view !== 'changed' && <Button onClick={() => setParam('view', 'changed', 'all')}>Review</Button>}
          <Button onClick={discard}>Discard</Button>
          <Button variant="primary" onClick={save} loading={saving} disabled={invalid.size > 0 || !prices.size}>
            Save Prices
          </Button>
        </div>
      )}

      <BulkDrawer
        open={bulkOpen}
        rows={inScope}
        scopeName={scopeName}
        onClose={() => setBulkOpen(false)}
        onReview={(next, summary) => {
          setDrafts((current) => {
            const merged = new Map(current);
            for (const [key, price] of next) merged.set(key, String(price));
            return merged;
          });
          setReason(summary);
          setBulkOpen(false);
          // The save bar already says how many are waiting; a message here would sit over its Save button.
          setParam('view', 'changed', 'all');
        }}
      />

      <ConfirmDialog
        open={blocker.state === 'blocked'}
        title="Leave without saving?"
        body={`Your ${plural(prices.size + invalid.size, 'price change')} won’t be saved.`}
        confirmLabel="Leave"
        destructive
        onCancel={() => blocker.reset?.()}
        onConfirm={() => blocker.proceed?.()}
      />
    </>
  );
}

/** An MRP box: what was typed, the saved price it replaces, or why it can't be saved. */
function PriceCell({ row, text, invalid, readOnly, onChange }: { row: PriceRow; text: string | undefined; invalid: boolean; readOnly: boolean; onChange: (text: string) => void }) {
  const id = useId();
  if (readOnly) return <span className="num">{formatINR(row.mrp)}</span>;
  const price = text === undefined ? null : parsePrice(text);
  return (
    <div className="price-cell">
      <div className={cx('input-affix price-input', text !== undefined && !invalid && 'price-input--changed')}>
        <span className="input-affix__prefix" aria-hidden>
          ₹
        </span>
        <input
          className="input input--prefixed num"
          inputMode="numeric"
          aria-label={`MRP of ${row.code}, ${row.option}`}
          aria-invalid={invalid || undefined}
          aria-describedby={text !== undefined ? `${id}-note` : undefined}
          value={text ?? String(row.mrp)}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
      {invalid ? (
        <span id={`${id}-note`} className="field__error">
          Whole rupees, above ₹0
        </span>
      ) : (
        price !== null && (
          <span id={`${id}-note`} className="cell-sub num">
            was {formatINR(row.mrp)} · {percent(row.mrp, price)}
          </span>
        )
      )}
    </div>
  );
}

/** Raise or lower every price in the current search and filters, then review the result in the table before saving. */
function BulkDrawer({ open, rows, scopeName, onClose, onReview }: { open: boolean; rows: PriceRow[]; scopeName: string; onClose: () => void; onReview: (prices: Map<string, number>, summary: string) => void }) {
  const [direction, setDirection] = useState<BulkChange['direction']>('up');
  const [by, setBy] = useState<BulkChange['by']>('percent');
  const [amount, setAmount] = useState('');
  const [roundTo, setRoundTo] = useState<BulkChange['roundTo']>(10);

  const value = Number(amount);
  const amountError = !amount.trim() ? null : !(value > 0) ? 'Enter an amount above 0.' : by === 'percent' && direction === 'down' && value >= 100 ? 'Lower by less than 100%.' : null;
  const ready = amount.trim() !== '' && !amountError;

  const result = useMemo(() => {
    if (!ready) return null;
    const change: BulkChange = { direction, by, amount: value, roundTo };
    const next = new Map<string, number>();
    const tooLow: PriceRow[] = [];
    for (const row of rows) {
      const price = bulkPrice(row.mrp, change);
      if (price === null) tooLow.push(row);
      else if (price !== row.mrp) next.set(row.key, price);
    }
    return { next, tooLow };
  }, [ready, direction, by, value, roundTo, rows]);

  const summary = `${direction === 'up' ? 'Raised' : 'Lowered'} ${plural(result?.next.size ?? 0, 'price')} by ${by === 'percent' ? `${value}%` : formatINR(value)}${roundTo > 1 ? `, rounded to ${formatINR(roundTo)}` : ''}${scopeName ? ` (${scopeName})` : ''}`;
  const samples = result ? rows.filter((row) => result.next.has(row.key)).slice(0, 6) : [];

  return (
    <Drawer
      open={open}
      title="Change prices in bulk"
      description={scopeName ? `${plural(rows.length, 'price')}: ${scopeName}` : `All ${plural(rows.length, 'price')} in the Shop`}
      onClose={onClose}
      onSubmit={() => {
        if (result && !result.tooLow.length && result.next.size) onReview(result.next, summary);
      }}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={!result || result.tooLow.length > 0 || !result.next.size}>
            {result?.next.size ? `Review ${plural(result.next.size, 'Change')}` : 'Review Changes'}
          </Button>
        </>
      }
    >
      <div className="stack-lg">
        <p className="muted">Changes apply to the prices your search and filters show, starting from their saved MRP. You check them in the table before anything is saved.</p>
        <Segmented
          label="Raise or lower"
          value={direction}
          onChange={setDirection}
          options={[
            { value: 'up', label: 'Raise' },
            { value: 'down', label: 'Lower' },
          ]}
        />
        <div className="grid-2">
          <TextField
            label={by === 'percent' ? 'By (%)' : 'By (₹)'}
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            error={amountError}
            prefix={by === 'rupees' ? '₹' : undefined}
            suffix={by === 'percent' ? '%' : undefined}
            data-autofocus
          />
          <SelectField
            label="Measured in"
            value={by}
            onChange={(event) => setBy(event.target.value as BulkChange['by'])}
            options={[
              { value: 'percent', label: 'Percent' },
              { value: 'rupees', label: 'Rupees' },
            ]}
          />
        </div>
        <SelectField label="Round new prices" value={String(roundTo)} onChange={(event) => setRoundTo(Number(event.target.value) as BulkChange['roundTo'])} options={ROUNDING} />

        {result && (
          <div className="stack" role="status">
            <p>
              <strong>{plural(result.next.size, 'price')} will change</strong>
              <span className="muted"> · {formatNumber(rows.length - result.next.size - result.tooLow.length)} stay the same</span>
            </p>
            {result.tooLow.length > 0 && (
              <p className="notice notice--warning">
                {plural(result.tooLow.length, 'price')} would drop to ₹0 or below, for example {result.tooLow[0]!.code} at {formatINR(result.tooLow[0]!.mrp)}. Use a smaller amount or rounding.
              </p>
            )}
            {samples.length > 0 && (
              <dl className="kv kv--compact">
                {samples.map((row) => (
                  <PreviewRow key={row.key} row={row} price={result.next.get(row.key)!} />
                ))}
              </dl>
            )}
          </div>
        )}
      </div>
    </Drawer>
  );
}

function PreviewRow({ row, price }: { row: PriceRow; price: number }) {
  return (
    <>
      <dt>
        <span className="mono">{row.code}</span> · {row.option}
      </dt>
      <dd className="num">
        {formatINR(row.mrp)} → <strong>{formatINR(price)}</strong> <span className="muted">{percent(row.mrp, price)}</span>
      </dd>
    </>
  );
}

function HistoryTable({ changes, error }: { changes: PriceChange[] | null; error: string | null }) {
  const columns: Column<PriceChange>[] = [
    { key: 'at', header: 'When', sortValue: (change) => change.id.padStart(12, '0'), cell: (change) => <span className="num">{formatDateTime(change.at)}</span> },
    {
      key: 'product',
      header: 'Product',
      sortValue: (change) => change.code,
      cell: (change) => (
        <>
          <Link to={`/products/${change.productId}`} className="cell-title mono">
            {change.code}
          </Link>
          <div className="cell-sub">{change.product}</div>
        </>
      ),
    },
    { key: 'option', header: 'Option', sortValue: (change) => change.option, cell: (change) => change.option },
    {
      key: 'change',
      header: 'MRP',
      align: 'num',
      cell: (change) =>
        change.oldMrp === null ? (
          <span>Added at {formatINR(change.newMrp!)}</span>
        ) : change.newMrp === null ? (
          <span className="muted">Removed ({formatINR(change.oldMrp)})</span>
        ) : (
          <span>
            {formatINR(change.oldMrp)} → <strong>{formatINR(change.newMrp)}</strong> <span className="muted">{percent(change.oldMrp, change.newMrp)}</span>
          </span>
        ),
    },
    {
      key: 'by',
      header: 'By',
      sortValue: (change) => change.by,
      cell: (change) => (
        <>
          {change.by}
          {change.reason && <div className="cell-sub" style={{ whiteSpace: 'normal' }}>{change.reason}</div>}
        </>
      ),
    },
  ];
  if (!changes)
    return (
      <Card>
        <EmptyState icon={CurrencyInrIcon} title={error ? 'Couldn’t load the price history' : 'Loading price history…'}>
          {error}
        </EmptyState>
      </Card>
    );
  return (
    <Card className="table-card">
      <DataTable
        caption="Price history"
        rows={changes}
        columns={columns}
        getRowId={(change) => change.id}
        initialSort={{ key: 'at', direction: 'desc' }}
        empty={
          <EmptyState icon={CurrencyInrIcon} title="No price changes yet">
            Every MRP change, from here or a product’s page, is listed with who made it and when.
          </EmptyState>
        }
      />
    </Card>
  );
}
