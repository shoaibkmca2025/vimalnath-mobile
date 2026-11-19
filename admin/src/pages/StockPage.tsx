import { ArchiveIcon, CurrencyInrIcon, DownloadSimpleIcon, PackageIcon, UploadSimpleIcon, WarningIcon, XCircleIcon } from '@phosphor-icons/react';
import { useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';

import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { DataTable, type Column } from '@/components/DataTable';
import { Drawer } from '@/components/Drawer';
import { EmptyState } from '@/components/EmptyState';
import { SearchInput, Segmented } from '@/components/Field';
import { PageHeader } from '@/components/PageHeader';
import { Stat } from '@/components/Stat';
import { StockDrawer } from '@/components/StockDrawer';
import { Thumb } from '@/components/Thumb';
import { useToast } from '@/components/useToast';
import { readSession } from '@/data/session';
import { STATE_LABEL, UNITS, decodeCsv, editsStock, exportRows, formatPrice, formatQty, planImport, stockAlerts, stockRows, stockValue, type ImportPlan, type StockRow } from '@/data/stock';
import { useData } from '@/data/useData';
import { useDrawerItem } from '@/hooks/useDrawerItem';
import { downloadCsv } from '@/lib/csv';
import { formatINR, formatINRCompact, formatNumber, plural } from '@/lib/format';

type Show = 'attention' | 'over' | 'counted' | 'untracked' | 'all';
/** Rows per save, so a big import never runs into the server's time limit. */
const CHUNK = 250;

export default function StockPage() {
  const { db, send } = useData();
  const toast = useToast();
  const role = readSession()?.role;
  const owner = role === 'owner';
  const canEdit = editsStock(role);
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const drawer = useDrawerItem<string>();
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const rows = useMemo(() => stockRows(db.products, db.stock), [db.products, db.stock]);
  const alerts = stockAlerts(db.stock);
  const value = stockValue(db.stock);
  const counts: Record<Show, number> = {
    attention: alerts.low + alerts.out,
    over: alerts.over,
    counted: db.stock.length,
    untracked: rows.filter((row) => !row.stock).length,
    all: rows.length,
  };
  const fallback: Show = counts.attention ? 'attention' : counts.counted ? 'counted' : 'all';
  const asked = params.get('show') as Show | null;
  const show: Show = asked && asked in counts ? asked : fallback;
  const setShow = (next: Show) => setParams(next === fallback ? {} : { show: next }, { replace: true });

  const needle = query.trim().toLowerCase();
  const shown = rows.filter((row) => {
    const fits =
      show === 'attention' ? row.state === 'low' || row.state === 'out' : show === 'over' ? row.state === 'over' : show === 'counted' ? Boolean(row.stock) : show === 'untracked' ? !row.stock : true;
    return (
      fits &&
      (!category || row.product?.category === category) &&
      (!needle || [row.title, row.code, row.stock?.sku, row.stock?.barcode, row.stock?.rack, row.stock?.brand].some((text) => text?.toLowerCase().includes(needle)))
    );
  });
  const open = drawer.item ? rows.find((row) => row.key === drawer.item) ?? null : null;

  const columns: Column<StockRow>[] = [
    {
      key: 'item',
      header: 'Item',
      sortValue: (row) => row.title,
      cell: (row) => (
        <div className="cell-media">
          <Thumb src={row.product?.image} />
          <div style={{ minWidth: 0 }}>
            <button type="button" className="cell-title" onClick={() => drawer.show(row.key)}>
              {row.title}
            </button>
            <div className="cell-sub">
              <span className="mono">{row.code}</span>
              {row.stock?.sku && ` · SKU ${row.stock.sku}`}
              {row.stock?.orphan && ' · option renamed'}
            </div>
          </div>
        </div>
      ),
    },
    {
      key: 'stock',
      header: 'In stock',
      align: 'num',
      sortValue: (row) => (row.stock ? row.stock.quantity : -Infinity),
      cell: (row) =>
        row.stock ? (
          <>
            <span style={{ fontWeight: 600 }} className={row.state === 'out' ? 'money-late' : undefined}>
              {formatQty(row.stock.quantity)} {UNITS[row.stock.unit]}
            </span>
            <div className="cell-sub">
              {row.stock.minStock !== null || row.stock.maxStock !== null
                ? `min ${row.stock.minStock === null ? '—' : formatQty(row.stock.minStock)} · max ${row.stock.maxStock === null ? '—' : formatQty(row.stock.maxStock)}`
                : 'No min or max'}
            </div>
          </>
        ) : (
          <span className="muted">—</span>
        ),
    },
    { key: 'state', header: 'Status', sortValue: (row) => ['out', 'low', 'over', 'ok', 'untracked'].indexOf(row.state), cell: (row) => <Badge tone={STATE_LABEL[row.state].tone}>{STATE_LABEL[row.state].label}</Badge> },
    {
      key: 'rack',
      header: 'Rack',
      sortValue: (row) => row.stock?.rack ?? '',
      cell: (row) =>
        row.stock?.rack || row.stock?.location ? (
          <>
            {row.stock.rack || '—'}
            {row.stock.location && <div className="cell-sub">{row.stock.location}</div>}
          </>
        ) : (
          <span className="muted">—</span>
        ),
    },
    {
      key: 'price',
      header: 'Selling price',
      align: 'num',
      sortValue: (row) => row.stock?.sellingPrice ?? row.mrp ?? 0,
      cell: (row) =>
        row.stock?.sellingPrice != null ? (
          <>
            {formatPrice(row.stock.sellingPrice)}
            {row.stock.wholesalePrice !== null && <div className="cell-sub">Wholesale {formatPrice(row.stock.wholesalePrice)}</div>}
          </>
        ) : (
          <span className="muted">{row.mrp ? `MRP ${formatINR(row.mrp)}` : '—'}</span>
        ),
    },
    ...(owner
      ? [
          {
            key: 'value',
            header: 'Value',
            align: 'num' as const,
            sortValue: (row: StockRow) => (row.stock?.purchasePrice != null ? Math.max(0, row.stock.quantity) * row.stock.purchasePrice : -1),
            cell: (row: StockRow) =>
              row.stock?.purchasePrice != null ? (
                <>
                  {formatINR(Math.max(0, row.stock.quantity) * row.stock.purchasePrice)}
                  <div className="cell-sub">at {formatPrice(row.stock.purchasePrice)}</div>
                </>
              ) : (
                <span className="muted">—</span>
              ),
          },
        ]
      : []),
  ];

  const exportCsv = () => {
    const { header, rows: cells } = exportRows(shown, owner);
    downloadCsv('vimalnath-stock', header, cells);
  };

  const readFile = async (file: File) => {
    if (file.size > 5 * 1024 * 1024) {
      toast({ tone: 'error', message: 'Choose a CSV under 5 MB.' });
      return;
    }
    setPlan(planImport(decodeCsv(await file.arrayBuffer()), rows, owner));
    setImportOpen(true);
  };

  const runImport = async () => {
    if (!plan?.saves.length) return;
    setImporting(true);
    let done = 0;
    for (let start = 0; start < plan.saves.length; start += CHUNK) {
      const chunk = plan.saves.slice(start, start + CHUNK);
      const last = start + CHUNK >= plan.saves.length;
      const ok = await send(
        '/stock',
        'PUT',
        { items: chunk, reason: 'CSV import' },
        last ? { area: 'catalogue', summary: `Imported stock from a CSV: ${plural(plan.added, 'item')} started, ${plural(plan.changed, 'item')} updated`, to: '/stock' } : undefined,
      );
      if (!ok) break;
      done += chunk.length;
    }
    setImporting(false);
    if (done === plan.saves.length) {
      toast({ message: `${plural(done, 'item')} imported.` });
      setImportOpen(false);
    } else if (done) toast({ tone: 'error', message: `${plural(done, 'item')} of ${formatNumber(plan.saves.length)} were imported. Fix the problem and import the file again; the saved ones show as unchanged.` });
  };

  const empty: Record<Show, { title: string; body: string }> = {
    attention: { title: 'Nothing low or out of stock', body: 'Every counted item is above its minimum.' },
    over: { title: 'Nothing overstocked', body: 'No counted item is above its maximum.' },
    counted: { title: 'No stock counted yet', body: canEdit ? 'Open an item and enter what you have, or fill in Export CSV and import it.' : 'The Owner or the inventory team enters it.' },
    untracked: { title: 'Every item is counted', body: 'Nothing left to set up.' },
    all: { title: 'No products yet', body: 'Add products under Products first.' },
  };

  return (
    <>
      <PageHeader
        title="Stock"
        description="What the shop has of each product option. Delivered orders take their items from stock; an order moved back from delivered returns them. Items not counted yet aren’t touched."
        actions={
          <>
            {canEdit && (
              <>
                <Button icon={UploadSimpleIcon} onClick={() => fileInput.current?.click()}>
                  Import CSV
                </Button>
                <input
                  ref={fileInput}
                  type="file"
                  accept=".csv,text/csv"
                  hidden
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = '';
                    if (file) void readFile(file);
                  }}
                />
              </>
            )}
            <Button icon={DownloadSimpleIcon} disabled={!shown.length} onClick={exportCsv}>
              Export CSV
            </Button>
          </>
        }
      />

      <div className="stack-lg">
        <div className="stats">
          {owner ? (
            <Stat
              label="Stock value"
              icon={CurrencyInrIcon}
              value={formatINRCompact(value.value)}
              title={formatINR(value.value)}
              foot={value.priced < db.stock.length ? `At purchase price; ${plural(db.stock.length - value.priced, 'item')} without one` : 'At purchase price, before GST'}
            />
          ) : (
            <Stat label="Counted" icon={ArchiveIcon} value={formatNumber(db.stock.length)} foot={`of ${plural(rows.length, 'item')}`} />
          )}
          <Stat label="Products" icon={PackageIcon} value={formatNumber(db.products.length)} foot={`${plural(rows.length, 'item')}, one per option · ${formatNumber(db.stock.length)} counted`} />
          <Stat label="Low stock" icon={WarningIcon} value={formatNumber(alerts.low)} foot={alerts.low ? 'At or below their minimum' : 'Nothing running low'} />
          <Stat label="Out of stock" icon={XCircleIcon} value={formatNumber(alerts.out)} foot={alerts.out ? <span className="money-late">None left to deliver</span> : 'Everything counted is in stock'} />
        </div>

        <div>
          <div className="toolbar">
            <Segmented<Show>
              label="Show"
              value={show}
              onChange={setShow}
              options={[
                { value: 'attention', label: 'Low or out', count: counts.attention },
                { value: 'over', label: 'Over max', count: counts.over },
                { value: 'counted', label: 'Counted', count: counts.counted },
                { value: 'untracked', label: 'Not set up', count: counts.untracked },
                { value: 'all', label: 'All', count: counts.all },
              ]}
            />
            <SearchInput label="Search stock" placeholder="Name, code, SKU, barcode, rack or brand" value={query} onChange={setQuery} />
            <label className="visually-hidden" htmlFor="stock-category">
              Category
            </label>
            <select id="stock-category" className="select" style={{ width: 'auto', minWidth: 160 }} value={category} onChange={(event) => setCategory(event.target.value)}>
              <option value="">All categories</option>
              {db.categories.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>

          <Card className="table-card">
            <DataTable
              key={show}
              caption="Stock"
              rows={shown}
              columns={columns}
              getRowId={(row) => row.key}
              onRowClick={(row) => drawer.show(row.key)}
              resetKey={`${query}|${category}`}
              initialSort={show === 'attention' ? { key: 'stock', direction: 'asc' } : undefined}
              empty={
                <EmptyState icon={ArchiveIcon} title={needle || category ? 'Nothing matches' : empty[show].title}>
                  {needle || category ? 'Try another name, code or category.' : empty[show].body}
                </EmptyState>
              }
            />
          </Card>
        </div>
      </div>

      <StockDrawer row={open} open={drawer.open && Boolean(open)} onClose={drawer.close} />

      <Drawer
        open={importOpen}
        title="Import Stock"
        description="From a CSV made with Export CSV."
        onClose={() => !importing && setImportOpen(false)}
        footer={
          <>
            <Button onClick={() => setImportOpen(false)} disabled={importing}>
              Cancel
            </Button>
            <Button variant="primary" loading={importing} disabled={!plan?.saves.length} onClick={runImport}>
              {plan?.saves.length ? `Import ${plural(plan.saves.length, 'Item')}` : 'Nothing to Import'}
            </Button>
          </>
        }
      >
        {plan && (
          <div className="stack">
            <dl className="kv kv--compact kv--split">
              <dt>Start counting</dt>
              <dd className="num">{formatNumber(plan.added)}</dd>
              <dt>Update</dt>
              <dd className="num">{formatNumber(plan.changed)}</dd>
              <dt>No change</dt>
              <dd className="num">{formatNumber(plan.unchanged)}</dd>
              <dt>Rows with problems</dt>
              <dd className={plan.errors.length ? 'num money-late' : 'num'}>{formatNumber(plan.errors.length)}</dd>
            </dl>
            <p className="field__hint" style={{ margin: 0 }}>
              A different “In stock” is saved as a count. Rows with an empty “In stock” for items not counted yet are skipped.{!owner && ' Purchase prices aren’t changed.'}
            </p>
            {plan.errors.length > 0 && (
              <div className="notice notice--warning" style={{ display: 'grid', gap: 'var(--space-2)' }}>
                <span>These rows will be skipped. Fix them in the file and import it again.</span>
                <ul className="import-errors">
                  {plan.errors.slice(0, 50).map((error) => (
                    <li key={error}>{error}</li>
                  ))}
                  {plan.errors.length > 50 && <li>…and {plural(plan.errors.length - 50, 'more row')}.</li>}
                </ul>
              </div>
            )}
          </div>
        )}
      </Drawer>
    </>
  );
}
