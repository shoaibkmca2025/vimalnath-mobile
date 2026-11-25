import { ChartLineUpIcon, PrinterIcon, WalletIcon } from '@phosphor-icons/react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';

import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Card, CardHeader } from '@/components/Card';
import { DataTable, type Column } from '@/components/DataTable';
import { Drawer } from '@/components/Drawer';
import { EmptyState } from '@/components/EmptyState';
import { SearchInput, Segmented, TextField } from '@/components/Field';
import { GstRange } from '@/components/GstRange';
import { PageHeader } from '@/components/PageHeader';
import { Stat } from '@/components/Stat';
import { useToast } from '@/components/useToast';
import { EXPENSE_CATEGORY, type Book, type CashEntry, type ProfitLoss, type StockMovement } from '@/data/accounts';
import { financialYear, inRange, initialRange, periodLabel, rangeOf, resolveRange, type Range } from '@/data/gst';
import { customerOf, isCounted, itemCount } from '@/data/orders';
import { PAYMENT_METHODS, billOf, billStatus, creditDaysOf, dayLabel, isBilled, localDay, remainingOf } from '@/data/payments';
import { formatMoney, lineAmount, parseMoney } from '@/data/purchases';
import { readSession } from '@/data/session';
import { BUCKET_LABEL, STATE_LABEL, formatQty, itemKey, stockRows } from '@/data/stock';
import type { Order, PaymentMethod } from '@/data/types';
import { useData } from '@/data/useData';
import { usePurchasing } from '@/hooks/usePurchasing';
import { api } from '@/lib/api';
import { downloadCsv } from '@/lib/csv';
import { formatNumber, plural } from '@/lib/format';

export type ReportView = 'profit-loss' | 'sales' | 'purchases' | 'stock' | 'cash-bank' | 'outstanding';
const TITLES: Record<ReportView, { title: string; description: string; dated: boolean }> = {
  'profit-loss': { title: 'Profit & Loss', description: 'Trading and profit and loss from delivered orders, purchases, stock and approved expenses, before GST.', dated: true },
  sales: { title: 'Sales Report', description: 'Orders placed in the period, by day, week, month, year, customer, product, category or salesperson.', dated: true },
  purchases: { title: 'Purchase Report', description: 'Received purchase bills, by day, month, supplier or product.', dated: true },
  stock: { title: 'Stock Report', description: 'What’s in stock and what it’s worth, low and out of stock, damaged and returned goods, and movement.', dated: true },
  'cash-bank': { title: 'Cash & Bank', description: 'Every payment in and out of cash and the bank, with the running balance, and the daily collection.', dated: true },
  outstanding: { title: 'Outstanding', description: 'What customers owe the shop and what the shop owes suppliers, as of now.', dated: false },
};

const money = (value: number) => formatMoney(Math.round(value * 100) / 100);
const orderDay = (order: Order) => localDay(new Date(order.createdAt));

/** One report page per view, all at /reports/…, for the Owner and the Accountant. */
export default function ReportsPage() {
  const view = ((useParams().view as ReportView | undefined) ?? 'profit-loss') as ReportView;
  const meta = TITLES[view] ?? TITLES['profit-loss'];
  const [range, setRange] = useState(() => initialRange('month'));
  const period = resolveRange(range);
  return (
    <>
      <PageHeader
        title={meta.title}
        description={meta.description}
        crumbs={[{ label: 'Reports', to: '/reports' }]}
        actions={
          <Button icon={PrinterIcon} onClick={() => window.print()}>
            Print
          </Button>
        }
      />
      <div className="stack-lg">
        {meta.dated && (
          <div className="no-print">
            <GstRange value={range} onChange={setRange} />
          </div>
        )}
        <p className="print-only-block muted">{meta.dated ? `${dayLabel(period.from)} to ${dayLabel(period.to)}` : `As of ${dayLabel(localDay())}`}</p>
        {view === 'profit-loss' && <ProfitLossReport period={period} />}
        {view === 'sales' && <SalesReport period={period} />}
        {view === 'purchases' && <PurchaseReport period={period} />}
        {view === 'stock' && <StockReport period={period} />}
        {view === 'cash-bank' && <CashBankReport period={period} />}
        {view === 'outstanding' && <OutstandingReport />}
      </div>
    </>
  );
}

/** Fetches a server report for the period, again whenever the period changes. */
function useReport<T>(path: string | null) {
  const [state, setState] = useState<{ path: string; data?: T; error?: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!path) return;
    let active = true;
    api<T>(path).then(
      (data) => active && setState({ path, data }),
      (problem: unknown) => active && setState({ path, error: problem instanceof Error ? problem.message : 'Couldn’t load the report.' }),
    );
    return () => {
      active = false;
    };
  }, [path, attempt]);
  const current = state?.path === path ? state : null;
  return { data: current?.data, error: current?.error, reload: () => setAttempt((count) => count + 1) };
}

function Waiting({ error }: { error?: string }) {
  return (
    <Card>
      <EmptyState icon={ChartLineUpIcon} title={error ? 'Couldn’t load the report' : 'Loading…'}>
        {error}
      </EmptyState>
    </Card>
  );
}

// ---------- Profit & Loss ----------

type Line = { label: ReactNode; text: string; amount: number | null; strong?: boolean; less?: boolean; indent?: boolean };

function Statement({ title, description, lines }: { title: string; description?: string; lines: Line[] }) {
  return (
    <Card>
      <CardHeader title={title} description={description} />
      <table className="table">
        <caption className="visually-hidden">{title}</caption>
        <tbody>
          {lines.map((line) => (
            <tr key={line.text} style={line.strong ? { fontWeight: 600 } : undefined}>
              <th scope="row" style={{ fontWeight: 'inherit', paddingLeft: line.indent ? 'var(--space-6)' : undefined }}>
                {line.label}
              </th>
              <td className="is-num">{line.amount === null ? '' : line.less ? `(${money(line.amount)})` : money(line.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function ProfitLossReport({ period }: { period: Range }) {
  const { data, error } = useReport<ProfitLoss>(`/reports/profit-loss?from=${period.from}&to=${period.to}`);
  if (!data) return <Waiting error={error} />;
  const outcome = (value: number, word: string) => `${word} ${value < 0 ? 'loss' : 'profit'}`;
  const trading: Line[] = [
    { label: `Sales (${plural(data.sales.orders, 'order')} delivered)`, text: 'Sales', amount: data.sales.bills },
    { label: 'Less GST on tax invoices', text: 'GST on tax invoices', amount: data.sales.gst, less: true, indent: true },
    { label: `Less sales returns (${data.returns.count})`, text: 'Sales returns', amount: data.returns.value, less: true, indent: true },
    { label: 'Net sales', text: 'Net sales', amount: data.netSales, strong: true },
    { label: 'Opening stock', text: 'Opening stock', amount: data.openingStock.value },
    { label: `Add purchases (${plural(data.purchases.count, 'bill')}, before GST)`, text: 'Purchases', amount: data.purchases.value, indent: true },
    { label: `Less purchase returns (${data.purchaseReturns.count})`, text: 'Purchase returns', amount: data.purchaseReturns.value, less: true, indent: true },
    { label: 'Less closing stock', text: 'Closing stock', amount: data.closingStock.value, less: true, indent: true },
    { label: 'Cost of goods sold', text: 'Cost of goods sold', amount: data.costOfGoods, strong: true },
    { label: outcome(data.grossProfit, 'Gross'), text: 'Gross profit', amount: data.grossProfit, strong: true },
  ];
  const pl: Line[] = [
    { label: outcome(data.grossProfit, 'Gross'), text: 'Gross profit', amount: data.grossProfit, strong: true },
    ...data.expenses.map((row) => ({ label: `${EXPENSE_CATEGORY[row.category]} (${row.count})`, text: `Expense ${row.category}`, amount: row.amount, less: true, indent: true })),
    ...(data.expenses.length ? [] : [{ label: 'No approved expenses', text: 'No expenses', amount: 0, indent: true }]),
    { label: 'Total expenses', text: 'Total expenses', amount: data.expenseTotal, less: true },
    { label: outcome(data.netProfit, 'Net'), text: 'Net profit', amount: data.netProfit, strong: true },
  ];
  const notes = [
    data.sales.withoutInvoice > 0 && `${plural(data.sales.withoutInvoice, 'delivered order')} had no posted tax invoice, so their bills count in full: the GST inside them isn’t taken off.`,
    data.sales.uncostedLines > 0 && (
      <>
        {plural(data.sales.uncostedLines, 'delivered line')} {data.sales.uncostedLines === 1 ? 'is' : 'are'} for items with no stock record or purchase price, so {data.sales.uncostedLines === 1 ? 'its' : 'their'} cost isn’t counted. <Link to="/stock">Set purchase prices</Link>.
      </>
    ),
    data.closingStock.unpriced > 0 && `${plural(data.closingStock.unpriced, 'item')} in stock ${data.closingStock.unpriced === 1 ? 'has' : 'have'} no purchase price and count as ₹0.`,
    'Stock is valued at each item’s purchase price today. Expenses count with their GST.',
  ].filter(Boolean);
  return (
    <>
      <div className="stats">
        <Stat label="Net sales" icon={ChartLineUpIcon} value={money(data.netSales)} foot={plural(data.sales.orders, 'order')} />
        <Stat label={outcome(data.grossProfit, 'Gross')} icon={ChartLineUpIcon} value={money(data.grossProfit)} foot={data.netSales > 0 ? `${((data.grossProfit / data.netSales) * 100).toFixed(1)}% of sales` : undefined} />
        <Stat label="Expenses" icon={WalletIcon} value={money(data.expenseTotal)} to="/expenses" />
        <Stat label={outcome(data.netProfit, 'Net')} icon={ChartLineUpIcon} value={money(data.netProfit)} />
      </div>
      <div className="grid-2">
        <Statement title="Trading Account" description={`${dayLabel(data.from)} to ${dayLabel(data.to)}`} lines={trading} />
        <Statement title="Profit & Loss Account" description="Gross profit less the shop’s expenses." lines={pl} />
      </div>
      <Card>
        <CardHeader title="How these figures are worked out" />
        <ul className="stack" style={{ margin: 0, paddingLeft: 'var(--space-5)' }}>
          {notes.map((note, index) => (
            <li key={index}>{note}</li>
          ))}
        </ul>
      </Card>
      <div className="no-print">
        <Button
          onClick={() =>
            downloadCsv(
              `vimalnath-profit-loss-${data.from}-to-${data.to}`,
              ['Account', 'Line', 'Amount'],
              [...trading.map((line) => ['Trading', line.text, line.less ? -(line.amount ?? 0) : line.amount ?? '']), ...pl.map((line) => ['Profit & Loss', line.text, line.less ? -(line.amount ?? 0) : line.amount ?? ''])],
            )
          }
        >
          Export CSV
        </Button>
      </div>
    </>
  );
}

// ---------- Grouped tables (sales and purchases) ----------

type Group = { key: string; label: string; sub?: string; count: number; qty: number; value: number; tax: number };

function grouped<T>(items: T[], parts: (item: T) => { key: string; label: string; sub?: string; count?: number; qty: number; value: number; tax?: number }[]) {
  const rows = new Map<string, Group>();
  for (const item of items) {
    for (const part of parts(item)) {
      const row = rows.get(part.key) ?? { key: part.key, label: part.label, sub: part.sub, count: 0, qty: 0, value: 0, tax: 0 };
      row.count += part.count ?? 1;
      row.qty += part.qty;
      row.value += part.value;
      row.tax += part.tax ?? 0;
      rows.set(part.key, row);
    }
  }
  return [...rows.values()];
}

const dated = (by: string, day: string) => {
  if (by === 'day') return { key: day, label: dayLabel(day) };
  if (by === 'week') {
    const monday = rangeOf('week', day).from;
    return { key: monday, label: `Week of ${dayLabel(monday)}` };
  }
  if (by === 'month') return { key: day.slice(0, 7), label: periodLabel(day.slice(0, 7)) };
  const fy = financialYear(day);
  return { key: fy.from, label: `FY 20${fy.label}` };
};

function GroupTable({ caption, rows, countLabel, byDate, withTax, file }: { caption: string; rows: Group[]; countLabel: string; byDate: boolean; withTax?: boolean; file: string }) {
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const shown = rows.filter((row) => !needle || `${row.label} ${row.sub ?? ''}`.toLowerCase().includes(needle));
  const total = shown.reduce((sum, row) => ({ count: sum.count + row.count, qty: sum.qty + row.qty, value: sum.value + row.value, tax: sum.tax + row.tax }), { count: 0, qty: 0, value: 0, tax: 0 });
  const columns: Column<Group>[] = [
    {
      key: 'label',
      header: caption,
      sortValue: (row) => (byDate ? row.key : row.label.toLowerCase()),
      cell: (row) => (
        <>
          <span className="cell-title">{row.label}</span>
          {row.sub && <div className="cell-sub">{row.sub}</div>}
        </>
      ),
    },
    { key: 'count', header: countLabel, align: 'num', sortValue: (row) => row.count, cell: (row) => formatNumber(row.count) },
    { key: 'qty', header: 'Quantity', align: 'num', sortValue: (row) => row.qty, cell: (row) => formatQty(row.qty) },
    ...(withTax ? [{ key: 'tax', header: 'GST', align: 'num' as const, sortValue: (row: Group) => row.tax, cell: (row: Group) => money(row.tax) }] : []),
    { key: 'value', header: withTax ? 'Before GST' : 'Value', align: 'num', sortValue: (row) => row.value, cell: (row) => <strong>{money(row.value)}</strong> },
  ];
  return (
    <div>
      <div className="toolbar no-print">
        <SearchInput label={`Search ${caption.toLowerCase()}`} value={query} onChange={setQuery} placeholder={`Find a ${caption.toLowerCase()}`} />
        <Button
          disabled={!shown.length}
          onClick={() =>
            downloadCsv(
              file,
              [caption, countLabel, 'Quantity', ...(withTax ? ['GST', 'Before GST'] : ['Value'])],
              shown.map((row) => [row.label, row.count, row.qty, ...(withTax ? [Math.round(row.tax * 100) / 100, Math.round(row.value * 100) / 100] : [Math.round(row.value * 100) / 100])]),
            )
          }
        >
          Export CSV
        </Button>
      </div>
      <Card className="table-card">
        <DataTable
          caption={caption}
          rows={shown}
          columns={columns}
          getRowId={(row) => row.key}
          initialSort={byDate ? { key: 'label', direction: 'desc' } : { key: 'value', direction: 'desc' }}
          resetKey={`${caption}${needle}`}
          empty={<EmptyState icon={ChartLineUpIcon} title="Nothing in this period">Pick another period above.</EmptyState>}
        />
      </Card>
      <p className="muted" style={{ marginTop: 'var(--space-2)' }}>
        Total: {formatNumber(total.count)} {countLabel.toLowerCase()}, {formatQty(total.qty)} units{withTax ? `, GST ${money(total.tax)}` : ''}, {money(total.value)}
      </p>
    </div>
  );
}

// ---------- Sales ----------

type SalesBy = 'day' | 'week' | 'month' | 'year' | 'customer' | 'product' | 'category' | 'salesperson';

function SalesReport({ period }: { period: Range }) {
  const { db } = useData();
  const [by, setBy] = useState<SalesBy>('day');
  const orders = db.orders.filter((order) => isCounted(order.status) && inRange(orderDay(order), period));
  const products = useMemo(() => new Map(db.products.map((product) => [product.id, product])), [db.products]);
  const categories = useMemo(() => new Map(db.categories.map((category) => [category.id, category.label])), [db.categories]);
  const rows = grouped(orders, (order) => {
    const whole = { qty: itemCount(order), value: billOf(order) };
    if (by === 'customer') {
      const { key, name } = customerOf(order);
      return [{ key, label: name, sub: order.phone, ...whole }];
    }
    if (by === 'salesperson') {
      const who = order.history[0]?.by ?? 'App';
      return [{ key: who, label: who === 'App' ? 'Customer’s app' : who, ...whole }];
    }
    if (by === 'product' || by === 'category') {
      const seen = new Set<string>();
      return order.lines.map((line) => {
        const category = products.get(line.productId)?.category ?? 'other';
        const key = by === 'product' ? `${line.productId}\u0000${line.option ?? ''}` : category;
        const first = !seen.has(key);
        seen.add(key);
        return by === 'product'
          ? { key, label: `${line.name || line.code}${line.option ? ` · ${line.option}` : ''}`, sub: line.code, count: first ? 1 : 0, qty: line.qty, value: (line.mrp ?? 0) * line.qty }
          : { key, label: categories.get(category) ?? 'Other', count: first ? 1 : 0, qty: line.qty, value: (line.mrp ?? 0) * line.qty };
      });
    }
    return [{ ...dated(by, orderDay(order)), ...whole }];
  });
  const total = orders.reduce((sum, order) => sum + billOf(order), 0);
  return (
    <>
      <div className="stats">
        <Stat label="Sales" icon={ChartLineUpIcon} value={money(total)} foot={plural(orders.length, 'order')} />
        <Stat label="Average order" icon={ChartLineUpIcon} value={orders.length ? money(total / orders.length) : '—'} />
        <Stat label="Units sold" icon={ChartLineUpIcon} value={formatQty(orders.reduce((sum, order) => sum + itemCount(order), 0))} />
        <Stat label="GST-wise sales" icon={ChartLineUpIcon} value="Sales Register" to="/gst/sales" foot="Tax invoices by GST rate" />
      </div>
      <div className="no-print">
        <Segmented<SalesBy>
          label="Group by"
          value={by}
          onChange={setBy}
          options={[
            { value: 'day', label: 'Day' },
            { value: 'week', label: 'Week' },
            { value: 'month', label: 'Month' },
            { value: 'year', label: 'Year' },
            { value: 'customer', label: 'Customer' },
            { value: 'product', label: 'Product' },
            { value: 'category', label: 'Category' },
            { value: 'salesperson', label: 'Salesperson' },
          ]}
        />
      </div>
      <GroupTable
        caption={{ day: 'Day', week: 'Week', month: 'Month', year: 'Financial year', customer: 'Customer', product: 'Product', category: 'Category', salesperson: 'Salesperson' }[by]}
        rows={rows}
        countLabel="Orders"
        byDate={['day', 'week', 'month', 'year'].includes(by)}
        file={`vimalnath-sales-by-${by}-${period.from}-to-${period.to}`}
      />
      {(by === 'product' || by === 'category') && <p className="muted">Product and category values are at MRP, before any discount on the order’s bill.</p>}
    </>
  );
}

// ---------- Purchases ----------

type PurchasesBy = 'day' | 'month' | 'supplier' | 'product';

function PurchaseReport({ period }: { period: Range }) {
  const { purchases, error } = usePurchasing();
  const [by, setBy] = useState<PurchasesBy>('supplier');
  if (!purchases) return <Waiting error={error ?? undefined} />;
  const bills = purchases.filter((bill) => bill.status === 'received' && inRange(bill.billDate, period));
  const rows = grouped(bills, (bill) => {
    if (by === 'product') {
      const seen = new Set<string>();
      return bill.items.map((item) => {
        const key = itemKey(item.productId, item.option);
        const first = !seen.has(key);
        seen.add(key);
        const amount = lineAmount(item);
        return { key, label: `${item.name}${item.option ? ` · ${item.option}` : ''}`, sub: item.code, count: first ? 1 : 0, qty: item.qty, value: amount, tax: (amount * item.gstRate) / 100 };
      });
    }
    const whole = { qty: bill.items.reduce((sum, item) => sum + item.qty, 0), value: bill.total - bill.tax, tax: bill.tax };
    if (by === 'supplier') return [{ key: String(bill.supplier.id), label: bill.supplier.name, ...whole }];
    return [{ ...dated(by, bill.billDate), ...whole }];
  });
  const before = bills.reduce((sum, bill) => sum + bill.total - bill.tax, 0);
  return (
    <>
      <div className="stats">
        <Stat label="Purchases, before GST" icon={ChartLineUpIcon} value={money(before)} foot={plural(bills.length, 'bill')} />
        <Stat label="GST paid on them" icon={ChartLineUpIcon} value={money(bills.reduce((sum, bill) => sum + bill.tax, 0))} to="/gst/purchases" foot="Purchase Register" />
        <Stat label="Bill totals" icon={ChartLineUpIcon} value={money(bills.reduce((sum, bill) => sum + bill.total, 0))} />
        <Stat label="Suppliers" icon={ChartLineUpIcon} value={formatNumber(new Set(bills.map((bill) => bill.supplier.id)).size)} />
      </div>
      <div className="no-print">
        <Segmented<PurchasesBy>
          label="Group by"
          value={by}
          onChange={setBy}
          options={[
            { value: 'supplier', label: 'Supplier' },
            { value: 'product', label: 'Product' },
            { value: 'day', label: 'Day' },
            { value: 'month', label: 'Month' },
          ]}
        />
      </div>
      <GroupTable caption={{ day: 'Day', month: 'Month', supplier: 'Supplier', product: 'Product' }[by]} rows={rows} countLabel="Bills" byDate={by === 'day' || by === 'month'} withTax file={`vimalnath-purchases-by-${by}-${period.from}-to-${period.to}`} />
    </>
  );
}

// ---------- Stock ----------

type StockView = 'valuation' | 'low' | 'set-aside' | 'movement';

function StockReport({ period }: { period: Range }) {
  const { db } = useData();
  const [show, setShow] = useState<StockView>('valuation');
  const [query, setQuery] = useState('');
  const owner = readSession()?.role === 'owner' || readSession()?.role === 'accountant';
  const rows = useMemo(() => stockRows(db.products, db.stock).filter((row) => row.stock), [db.products, db.stock]);
  const movement = useReport<StockMovement[]>(show === 'movement' ? `/reports/stock-movement?from=${period.from}&to=${period.to}` : null);
  const needle = query.trim().toLowerCase();
  const match = (text: string) => !needle || text.toLowerCase().includes(needle);

  const valued = rows.map((row) => {
    const item = row.stock!;
    const qty = Math.max(0, item.quantity);
    return { ...row, qty, cost: item.purchasePrice === null ? null : qty * item.purchasePrice, sale: item.sellingPrice === null ? null : qty * item.sellingPrice };
  });
  type Valued = (typeof valued)[number];
  const totalCost = valued.reduce((sum, row) => sum + (row.cost ?? 0), 0);
  const totalSale = valued.reduce((sum, row) => sum + (row.sale ?? 0), 0);
  const low = valued.filter((row) => row.state === 'out' || row.state === 'low');
  const setAside = valued.filter((row) => (row.stock!.held ?? 0) + (row.stock!.damaged ?? 0) + (row.stock!.defective ?? 0) > 0);

  const name: Column<Valued> = {
    key: 'item',
    header: 'Item',
    sortValue: (row) => row.title.toLowerCase(),
    cell: (row) => (
      <>
        <span className="cell-title">{row.title}</span>
        <div className="cell-sub">{row.code}</div>
      </>
    ),
  };
  const qty: Column<Valued> = { key: 'qty', header: 'For sale', align: 'num', sortValue: (row) => row.stock!.quantity, cell: (row) => `${formatQty(row.stock!.quantity)} ${row.stock!.unit}` };
  const views: Record<Exclude<StockView, 'movement'>, { rows: Valued[]; columns: Column<Valued>[]; csv: () => void }> = {
    valuation: {
      rows: valued,
      columns: [
        name,
        qty,
        ...(owner ? [{ key: 'cost', header: 'At purchase price', align: 'num' as const, sortValue: (row: Valued) => row.cost ?? -1, cell: (row: Valued) => (row.cost === null ? <span className="muted">No price</span> : money(row.cost)) }] : []),
        { key: 'sale', header: 'At selling price', align: 'num', sortValue: (row) => row.sale ?? -1, cell: (row) => (row.sale === null ? <span className="muted">No price</span> : money(row.sale)) },
      ],
      csv: () => downloadCsv('vimalnath-stock-valuation', ['Item', 'Code', 'For sale', 'Unit', ...(owner ? ['Purchase price', 'Value at purchase price'] : []), 'Selling price', 'Value at selling price'], valued.map((row) => [row.title, row.code, row.stock!.quantity, row.stock!.unit, ...(owner ? [row.stock!.purchasePrice ?? '', row.cost ?? ''] : []), row.stock!.sellingPrice ?? '', row.sale ?? ''])),
    },
    low: {
      rows: low,
      columns: [name, qty, { key: 'min', header: 'Minimum', align: 'num', sortValue: (row) => row.stock!.minStock ?? -1, cell: (row) => (row.stock!.minStock === null ? '—' : formatQty(row.stock!.minStock)) }, { key: 'state', header: 'State', sortValue: (row) => row.state, cell: (row) => <Badge tone={STATE_LABEL[row.state].tone}>{STATE_LABEL[row.state].label}</Badge> }],
      csv: () => downloadCsv('vimalnath-low-stock', ['Item', 'Code', 'For sale', 'Minimum', 'State'], low.map((row) => [row.title, row.code, row.stock!.quantity, row.stock!.minStock ?? '', STATE_LABEL[row.state].label])),
    },
    'set-aside': {
      rows: setAside,
      columns: [
        name,
        qty,
        ...(['held', 'damaged', 'defective'] as const).map((bucket) => ({ key: bucket, header: BUCKET_LABEL[bucket], align: 'num' as const, sortValue: (row: Valued) => row.stock![bucket] ?? 0, cell: (row: Valued) => formatQty(row.stock![bucket] ?? 0) })),
      ],
      csv: () => downloadCsv('vimalnath-damaged-and-returned-stock', ['Item', 'Code', 'For sale', 'Awaiting check', 'Damaged', 'Defective'], setAside.map((row) => [row.title, row.code, row.stock!.quantity, row.stock!.held ?? 0, row.stock!.damaged ?? 0, row.stock!.defective ?? 0])),
    },
  };

  const moved = (movement.data ?? []).filter((row) => (row.in || row.out) && match(`${row.name} ${row.option} ${row.code}`));
  const moveColumns: Column<StockMovement>[] = [
    { key: 'item', header: 'Item', sortValue: (row) => row.name.toLowerCase(), cell: (row) => (<><span className="cell-title">{row.name}{row.option ? ` · ${row.option}` : ''}</span><div className="cell-sub">{row.code}</div></>) },
    { key: 'opening', header: 'Opening', align: 'num', sortValue: (row) => row.opening, cell: (row) => formatQty(row.opening) },
    { key: 'in', header: 'In', align: 'num', sortValue: (row) => row.in, cell: (row) => formatQty(row.in) },
    { key: 'out', header: 'Out', align: 'num', sortValue: (row) => row.out, cell: (row) => formatQty(row.out) },
    { key: 'closing', header: 'Closing', align: 'num', sortValue: (row) => row.closing, cell: (row) => <strong>{formatQty(row.closing)}</strong> },
  ];
  const current = show === 'movement' ? null : views[show];

  return (
    <>
      <div className="stats">
        {owner && <Stat label="Stock value, at purchase price" icon={ChartLineUpIcon} value={money(totalCost)} foot={`${plural(valued.filter((row) => row.cost === null && row.qty > 0).length, 'item')} without a price`} />}
        <Stat label="At selling price" icon={ChartLineUpIcon} value={money(totalSale)} />
        <Stat label="Low or out of stock" icon={ChartLineUpIcon} value={formatNumber(low.length)} foot={`${plural(low.filter((row) => row.state === 'out').length, 'item')} out`} />
        <Stat label="Damaged or returned" icon={ChartLineUpIcon} value={formatNumber(setAside.length)} foot="Items with stock set aside" />
      </div>
      <div className="toolbar no-print">
        <Segmented<StockView>
          label="Show"
          value={show}
          onChange={setShow}
          options={[
            { value: 'valuation', label: 'Valuation' },
            { value: 'low', label: 'Low & out', count: low.length },
            { value: 'set-aside', label: 'Damaged & returned', count: setAside.length },
            { value: 'movement', label: 'Movement' },
          ]}
        />
        <SearchInput label="Search items" value={query} onChange={setQuery} placeholder="Name or code" />
        {current && (
          <Button disabled={!current.rows.length} onClick={current.csv}>
            Export CSV
          </Button>
        )}
        {show === 'movement' && (
          <Button disabled={!moved.length} onClick={() => downloadCsv(`vimalnath-stock-movement-${period.from}-to-${period.to}`, ['Item', 'Option', 'Code', 'Opening', 'In', 'Out', 'Closing'], moved.map((row) => [row.name, row.option, row.code, row.opening, row.in, row.out, row.closing]))}>
            Export CSV
          </Button>
        )}
      </div>
      {show === 'movement' && <p className="muted">Stock for sale only, {period.label.toLowerCase() === 'custom range' ? `${dayLabel(period.from)} to ${dayLabel(period.to)}` : period.label}. The valuation and alerts are as of now.</p>}
      <Card className="table-card">
        {current ? (
          <DataTable caption="Stock" rows={current.rows.filter((row) => match(`${row.title} ${row.code}`))} columns={current.columns} getRowId={(row) => row.key} resetKey={`${show}${needle}`} empty={<EmptyState icon={ChartLineUpIcon} title="Nothing here">Nothing matches.</EmptyState>} />
        ) : !movement.data ? (
          <EmptyState icon={ChartLineUpIcon} title={movement.error ? 'Couldn’t load the movement' : 'Loading…'}>
            {movement.error}
          </EmptyState>
        ) : (
          <DataTable caption="Stock movement" rows={moved} columns={moveColumns} getRowId={(row) => itemKey(row.productId, row.option)} resetKey={`${needle}${period.from}${period.to}`} empty={<EmptyState icon={ChartLineUpIcon} title="No stock moved">Nothing came in or went out in this period.</EmptyState>} />
        )}
      </Card>
    </>
  );
}

// ---------- Cash & Bank ----------

function CashBankReport({ period }: { period: Range }) {
  const toast = useToast();
  const owner = readSession()?.role === 'owner';
  const { data, error, reload } = useReport<{ books: Book[] }>(`/reports/cash-book?from=${period.from}&to=${period.to}`);
  const [bookName, setBookName] = useState<Book['book']>('cash');
  const [opening, setOpening] = useState<{ amount: string; asOf: string } | null>(null);
  if (!data) return <Waiting error={error} />;
  const book = data.books.find((one) => one.book === bookName)!;
  const collections = new Map<string, Record<string, number>>();
  for (const one of data.books)
    for (const entry of one.entries)
      if (entry.kind === 'Customer payment') {
        const day = collections.get(entry.day) ?? {};
        day[entry.method] = (day[entry.method] ?? 0) + entry.in;
        collections.set(entry.day, day);
      }
  const methods = ['cash', 'upi', 'bank', 'cheque'] as const;
  const days = [...collections].sort(([a], [b]) => b.localeCompare(a));

  const columns: Column<CashEntry>[] = [
    { key: 'day', header: 'Day', cell: (entry) => <span className="num">{dayLabel(entry.day)}</span> },
    {
      key: 'entry',
      header: 'Entry',
      cell: (entry) => (
        <>
          <Link to={entry.link} className="cell-title">
            {entry.kind} · {entry.ref}
          </Link>
          <div className="cell-sub">
            {entry.party}
            {bookName === 'bank' ? ` · ${PAYMENT_METHODS[entry.method as PaymentMethod] ?? entry.method}` : ''}
          </div>
        </>
      ),
    },
    { key: 'in', header: 'In', align: 'num', cell: (entry) => (entry.in ? money(entry.in) : '') },
    { key: 'out', header: 'Out', align: 'num', cell: (entry) => (entry.out ? money(entry.out) : '') },
    { key: 'balance', header: 'Balance', align: 'num', cell: (entry) => <strong>{money(entry.balance)}</strong> },
  ];

  const saveOpening = async () => {
    if (!opening) return;
    const amount = parseMoney(opening.amount);
    if (Number.isNaN(amount)) return void toast({ tone: 'error', message: 'Enter the opening balance in rupees and paise.' });
    try {
      await api('/reports/book-openings', 'PUT', { book: bookName, amount, asOf: opening.asOf });
      toast({ message: 'Opening balance saved.' });
      setOpening(null);
      reload();
    } catch (problem) {
      toast({ tone: 'error', message: problem instanceof Error ? problem.message : 'Couldn’t save it.' });
    }
  };

  return (
    <>
      <div className="toolbar no-print">
        <Segmented<Book['book']>
          label="Book"
          value={bookName}
          onChange={setBookName}
          options={[
            { value: 'cash', label: 'Cash' },
            { value: 'bank', label: 'Bank, UPI and cheques' },
          ]}
        />
        {owner && <Button onClick={() => setOpening({ amount: book.openingSet ? String(book.openingSet.amount) : '', asOf: book.openingSet?.asOf ?? localDay() })}>Set Opening Balance</Button>}
        <Button
          disabled={!book.entries.length}
          onClick={() =>
            downloadCsv(
              `vimalnath-${bookName}-book-${period.from}-to-${period.to}`,
              ['Day', 'Entry', 'Reference', 'Party', 'Method', 'In', 'Out', 'Balance'],
              [['', 'Opening balance', '', '', '', '', '', book.opening], ...book.entries.map((entry) => [entry.day, entry.kind, entry.ref, entry.party, entry.method, entry.in || '', entry.out || '', entry.balance])],
            )
          }
        >
          Export CSV
        </Button>
      </div>
      <div className="stats">
        <Stat label="Opening balance" icon={WalletIcon} value={money(book.opening)} foot={book.openingSet ? `Books start ${dayLabel(book.openingSet.asOf)}` : 'No opening balance set'} />
        <Stat label="Money in" icon={WalletIcon} value={money(book.in)} />
        <Stat label="Money out" icon={WalletIcon} value={money(book.out)} />
        <Stat label="Closing balance" icon={WalletIcon} value={money(book.closing)} />
      </div>
      <Card className="table-card">
        <DataTable caption={`${bookName === 'cash' ? 'Cash' : 'Bank'} book`} rows={book.entries} columns={columns} getRowId={(entry) => `${entry.link}${entry.ref}${entry.day}${entry.balance}`} pageSize={50} resetKey={`${bookName}${period.from}${period.to}`} empty={<EmptyState icon={WalletIcon} title="No payments in this period">Customer payments, supplier payments, refunds, expenses and GST paid show here.</EmptyState>} />
      </Card>
      <Card className="table-card">
        <CardHeader title="Daily collection" description="Customer payments received each day, by how they paid." />
        {days.length ? (
          <div className="table-scroll">
            <table className="table">
              <caption className="visually-hidden">Daily collection</caption>
              <thead>
                <tr>
                  <th scope="col">Day</th>
                  {methods.map((method) => (
                    <th key={method} scope="col" className="is-num">
                      {PAYMENT_METHODS[method]}
                    </th>
                  ))}
                  <th scope="col" className="is-num">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {days.map(([day, amounts]) => (
                  <tr key={day}>
                    <td className="num">{dayLabel(day)}</td>
                    {methods.map((method) => (
                      <td key={method} className="is-num">
                        {amounts[method] ? money(amounts[method]) : '—'}
                      </td>
                    ))}
                    <td className="is-num" style={{ fontWeight: 600 }}>
                      {money(Object.values(amounts).reduce((sum, amount) => sum + amount, 0))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon={WalletIcon} title="Nothing collected in this period" />
        )}
      </Card>
      <Drawer
        open={Boolean(opening)}
        title={`${bookName === 'cash' ? 'Cash in Hand' : 'Bank Balance'} When the Books Start`}
        description="Count the cash, or read the bank statement, for the start of that day. Payments from then on are added to it."
        onClose={() => setOpening(null)}
        onSubmit={saveOpening}
        footer={
          <>
            <Button onClick={() => setOpening(null)}>Cancel</Button>
            <Button type="submit" variant="primary">
              Save
            </Button>
          </>
        }
      >
        {opening && (
          <div className="form-grid">
            <TextField label="Books start on" type="date" max={localDay()} value={opening.asOf} onChange={(event) => setOpening({ ...opening, asOf: event.target.value })} required />
            <TextField label="Balance that morning" prefix="₹" inputMode="decimal" value={opening.amount} onChange={(event) => setOpening({ ...opening, amount: event.target.value })} placeholder="0" autoComplete="off" required />
          </div>
        )}
      </Drawer>
    </>
  );
}

// ---------- Outstanding ----------

type Owed = { key: string; name: string; phone?: string; bills: number; owed: number; overdue: number; to: string };

function OutstandingReport() {
  const { db } = useData();
  const { suppliers, error } = usePurchasing();
  const creditDays = creditDaysOf(db.settings);
  const customers = grouped(
    db.orders.filter((order) => isBilled(order) && remainingOf(order) > 0),
    (order) => {
      const { key, name } = customerOf(order);
      const status = billStatus(order, creditDays);
      return [{ key, label: name, sub: order.phone, qty: status.state === 'overdue' ? status.remaining : 0, value: status.remaining }];
    },
  ).map((row): Owed => ({ key: row.key, name: row.label, phone: row.sub, bills: row.count, owed: row.value, overdue: row.qty, to: `/customers/${encodeURIComponent(row.key)}` }));
  const owedSuppliers = (suppliers ?? []).filter((supplier) => supplier.outstanding > 0).map((supplier): Owed => ({ key: String(supplier.id), name: supplier.name, phone: supplier.phone, bills: 0, owed: supplier.outstanding, overdue: 0, to: `/suppliers/${supplier.id}` }));
  const table = (caption: string, rows: Owed[], withBills: boolean) => {
    const columns: Column<Owed>[] = [
      { key: 'name', header: caption, sortValue: (row) => row.name.toLowerCase(), cell: (row) => (<><Link to={row.to} className="cell-title">{row.name}</Link>{row.phone && <div className="cell-sub">{row.phone}</div>}</>) },
      ...(withBills ? [{ key: 'bills', header: 'Unpaid bills', align: 'num' as const, sortValue: (row: Owed) => row.bills, cell: (row: Owed) => formatNumber(row.bills) }, { key: 'overdue', header: 'Overdue', align: 'num' as const, sortValue: (row: Owed) => row.overdue, cell: (row: Owed) => (row.overdue ? <span className="money-late">{money(row.overdue)}</span> : '—') }] : []),
      { key: 'owed', header: 'Outstanding', align: 'num', sortValue: (row) => row.owed, cell: (row) => <strong>{money(row.owed)}</strong> },
    ];
    return (
      <Card className="table-card">
        <CardHeader
          title={`${caption}s`}
          description={`${money(rows.reduce((sum, row) => sum + row.owed, 0))} in all`}
          action={
            <Button size="sm" disabled={!rows.length} onClick={() => downloadCsv(`vimalnath-${caption.toLowerCase()}-outstanding`, [caption, 'Phone', ...(withBills ? ['Unpaid bills', 'Overdue'] : []), 'Outstanding'], rows.map((row) => [row.name, row.phone ?? '', ...(withBills ? [row.bills, row.overdue] : []), row.owed]))}>
              Export CSV
            </Button>
          }
        />
        <DataTable caption={`${caption}s outstanding`} rows={rows} columns={columns} getRowId={(row) => row.key} initialSort={{ key: 'owed', direction: 'desc' }} empty={<EmptyState icon={WalletIcon} title="Nothing outstanding" />} />
      </Card>
    );
  };
  return (
    <>
      <div className="stats">
        <Stat label="Customers owe" icon={WalletIcon} value={money(customers.reduce((sum, row) => sum + row.owed, 0))} foot={plural(customers.length, 'customer')} to="/payments" />
        <Stat label="Overdue from customers" icon={WalletIcon} value={money(customers.reduce((sum, row) => sum + row.overdue, 0))} foot={`After ${plural(creditDays, 'day')} of credit`} />
        <Stat label="The shop owes suppliers" icon={WalletIcon} value={suppliers ? money(owedSuppliers.reduce((sum, row) => sum + row.owed, 0)) : '…'} foot={suppliers ? plural(owedSuppliers.length, 'supplier') : (error ?? undefined)} to="/suppliers" />
      </div>
      {table('Customer', customers, true)}
      {suppliers && table('Supplier', owedSuppliers, false)}
    </>
  );
}
