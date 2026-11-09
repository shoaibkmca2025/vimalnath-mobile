import {
  BookOpenIcon,
  CalculatorIcon,
  CaretRightIcon,
  ClockIcon,
  CurrencyInrIcon,
  ImageSquareIcon,
  ReceiptIcon,
  ShoppingCartIcon,
  TagIcon,
  type Icon,
} from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';

import { OrderStatusBadge } from '@/components/Badge';
import { ButtonLink } from '@/components/Button';
import { Card, CardHeader } from '@/components/Card';
import { AreaChart } from '@/components/Charts';
import { Segmented } from '@/components/Field';
import { PageHeader } from '@/components/PageHeader';
import { Stat } from '@/components/Stat';
import { DAY, averageStepHours, bucket, change, dailySeries, ordersBetween, salesByCategory, topCustomers, topProducts, totals, type Ranked } from '@/data/analytics';
import { ORDER_STATUS } from '@/data/orders';
import { readSession } from '@/data/session';
import { useData } from '@/data/useData';
import type { OrderStatus } from '@/data/types';
import { formatDate, formatDay, formatHours, formatINR, formatINRCompact, formatNumber, formatPercent, formatRelativeTime, formatWeekday, plural, relativePhrase } from '@/lib/format';
import { getSystemRange } from '@/generated/app-lib/glass-calculator';

type Range = '7' | '30' | '90';
type Measure = 'value' | 'orders';

function greeting(hour: number) {
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

const PIPELINE: OrderStatus[] = ['placed', 'confirmed', 'dispatched'];

export default function DashboardPage() {
  const { db } = useData();
  const session = readSession();
  const [params, setParams] = useSearchParams();
  const range: Range = params.get('range') === '7' || params.get('range') === '90' ? (params.get('range') as Range) : '30';
  const [measure, setMeasure] = useState<Measure>('value');
  // Read the clock once when the page opens, so figures don't shift between renders.
  const [now] = useState(() => Date.now());
  const days = Number(range);

  const stats = useMemo(() => {
    const daily = dailySeries(db.orders, days, now);
    // The chart's first day, so the tiles and the chart always add up to the same figures.
    const start = daily[0]!.date.getTime();
    const current = ordersBetween(db.orders, start, now + 1);
    const previous = ordersBetween(db.orders, start - days * DAY, start);
    const waiting = db.orders.filter((order) => order.status === 'placed');
    const oldestWaiting = waiting.reduce<string | null>((oldest, order) => (!oldest || order.createdAt < oldest ? order.createdAt : oldest), null);
    const pipeline = PIPELINE.map((status) => {
      const orders = db.orders.filter((order) => order.status === status);
      return { status, count: orders.length, value: orders.reduce((sum, order) => sum + order.total, 0) };
    });
    const inPeriod = db.orders.filter((order) => new Date(order.createdAt).getTime() >= start);
    return {
      current: totals(current),
      previous: totals(previous),
      daily,
      waiting: waiting.length,
      oldestWaiting,
      pipeline,
      delivered: inPeriod.filter((order) => order.status === 'delivered').length,
      cancelled: inPeriod.filter((order) => order.status === 'cancelled').length,
      toConfirm: averageStepHours(db.orders, 'placed', 'confirmed'),
      toDispatch: averageStepHours(db.orders, 'confirmed', 'dispatched'),
      toDeliver: averageStepHours(db.orders, 'dispatched', 'delivered'),
      categories: salesByCategory(current, db.products, db.categories).slice(0, 6),
      products: topProducts(current).slice(0, 5),
      customers: topCustomers(current).slice(0, 5),
    };
  }, [db, days, now]);

  const health = useMemo(() => {
    const products = db.products;
    const visible = products.filter((product) => product.visible);
    return {
      total: products.length,
      visible: visible.length,
      priced: products.filter((product) => product.options.length > 0).length,
      photo: products.filter((product) => product.image).length,
      featured: products.filter((product) => product.featured && product.visible).length,
      bySource: (['master', 'office', 'tavic'] as const).map((source) => ({ source, count: products.filter((product) => product.catalogPage.source === source).length })),
    };
  }, [db.products]);

  const configurations = Object.values(db.cutlist.configurations).flat();
  // The app's own calculator says which configurations have a confirmed formula.
  const placeholderFormulas = configurations.filter((configuration) => !getSystemRange(configuration.name)).length;

  const attention: { icon: Icon; title: string; detail: string; to: string; count: number }[] = [
    {
      icon: ClockIcon,
      title: 'Orders to confirm',
      detail: stats.oldestWaiting ? `Oldest placed ${relativePhrase(formatRelativeTime(stats.oldestWaiting, now))}` : 'Customers are waiting to hear back',
      to: '/orders?status=placed',
      count: stats.waiting,
    },
    { icon: CalculatorIcon, title: 'Glass sizes on a placeholder formula', detail: 'Synchro and folding: opening − 20 mm until confirmed', to: '/formulas', count: placeholderFormulas },
    { icon: CurrencyInrIcon, title: 'Products without a price', detail: 'Shown as “price in catalogue” in the app', to: '/products?view=missing-price', count: health.total - health.priced },
    { icon: ImageSquareIcon, title: 'Products without a photo', detail: 'Shown with a placeholder in the app', to: '/products?view=missing-photo', count: health.total - health.photo },
    { icon: BookOpenIcon, title: 'Price lists not published', detail: 'Shown as “coming soon” in the app', to: '/price-lists', count: db.catalogues.filter((list) => !list.url).length },
    { icon: TagIcon, title: 'Hidden categories', detail: 'Not shown in the Shop', to: '/categories', count: db.categories.filter((category) => !category.visible).length },
  ];
  const pending = attention.filter((item) => item.count > 0);

  const periodLabel = `vs previous ${days} days`;
  const first = stats.daily[0]!.date;
  const chartPoints = stats.daily.map((point) => ({
    key: point.date.toISOString(),
    label: formatWeekday(point.date),
    axisLabel: formatDay(point.date),
    value: measure === 'value' ? point.value : point.orders,
    detail: measure === 'value' ? plural(point.orders, 'order') : formatINR(point.value),
  }));
  const peakDay = stats.daily.reduce((best, point) => (point.value > best.value ? point : best), stats.daily[0]!);
  const categoryTop = stats.categories[0]?.value || 1;
  const recentOrders = db.orders.slice(0, 6);

  return (
    <div className="stack-lg">
      <PageHeader
        title="Dashboard"
        description={`${greeting(new Date(now).getHours())}, ${session?.name.split(' ')[0] ?? 'there'}. Orders, catalogue and calculators in the Vimalnath app at a glance.`}
        actions={
          <ButtonLink to="/orders?status=placed" variant="primary" icon={ReceiptIcon}>
            Review New Orders
          </ButtonLink>
        }
      />

      <div className="toolbar">
        <Segmented<Range>
          label="Period"
          value={range}
          onChange={(next) => setParams(next === '30' ? {} : { range: next }, { replace: true })}
          options={[
            { value: '7', label: '7 days' },
            { value: '30', label: '30 days' },
            { value: '90', label: '90 days' },
          ]}
        />
        <p className="muted">
          {formatDate(first.toISOString())} – today · cancelled orders left out · amounts at MRP
        </p>
      </div>

      <div className="stats">
        <Stat
          label="Order value"
          icon={CurrencyInrIcon}
          value={formatINRCompact(stats.current.value)}
          title={formatINR(stats.current.value)}
          delta={change(stats.current.value, stats.previous.value)}
          deltaLabel={periodLabel}
          trend={bucket(stats.daily, 12, (point) => point.value)}
        />
        <Stat
          label="Orders"
          icon={ReceiptIcon}
          value={formatNumber(stats.current.orders)}
          delta={change(stats.current.orders, stats.previous.orders)}
          deltaLabel={periodLabel}
          trend={bucket(stats.daily, 12, (point) => point.orders)}
          to="/orders"
        />
        <Stat
          label="Average order"
          icon={ShoppingCartIcon}
          value={formatINRCompact(stats.current.average)}
          title={formatINR(stats.current.average)}
          delta={change(stats.current.average, stats.previous.average)}
          deltaLabel={periodLabel}
          foot={`${formatNumber(stats.current.items)} items ordered`}
        />
        <Stat
          label="Waiting to confirm"
          icon={ClockIcon}
          value={formatNumber(stats.waiting)}
          foot={stats.toConfirm === null ? 'Confirm new orders to start tracking' : `Usually confirmed within ${formatHours(stats.toConfirm)}`}
          to="/orders?status=placed"
        />
      </div>

      <div className="dashboard-grid">
        <Card aria-labelledby="chart-title">
          <CardHeader
            id="chart-title"
            title={measure === 'value' ? 'Order value per day' : 'Orders per day'}
            description={
              peakDay.value > 0
                ? `Busiest day: ${formatWeekday(peakDay.date)}, ${formatINR(peakDay.value)} from ${plural(peakDay.orders, 'order')}.`
                : 'No orders in this period.'
            }
            action={
              <Segmented<Measure>
                label="Measure"
                value={measure}
                onChange={setMeasure}
                options={[
                  { value: 'value', label: 'Value' },
                  { value: 'orders', label: 'Orders' },
                ]}
              />
            }
          />
          <div className="card__body">
            <AreaChart
              points={chartPoints}
              label={`${measure === 'value' ? 'Order value' : 'Orders'} per day over the last ${days} days`}
              format={measure === 'value' ? formatINR : (value) => plural(value, 'order')}
              formatAxis={measure === 'value' ? (value) => (value ? formatINRCompact(value).replace('.0', '') : '₹0') : (value) => formatNumber(value)}
            />
            <details className="disclosure">
              <summary>Show as a table</summary>
              <div className="table-scroll" style={{ maxHeight: 280 }}>
                <table className="table">
                  <caption className="visually-hidden">Orders and order value per day</caption>
                  <thead>
                    <tr>
                      <th scope="col">Day</th>
                      <th scope="col" className="is-num">
                        Orders
                      </th>
                      <th scope="col" className="is-num">
                        Value (MRP)
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...stats.daily].reverse().map((point) => (
                      <tr key={point.date.toISOString()}>
                        <td>{formatWeekday(point.date)}</td>
                        <td className="is-num">{formatNumber(point.orders)}</td>
                        <td className="is-num">{formatINR(point.value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </div>
        </Card>

        <Card aria-labelledby="pipeline-title">
          <CardHeader id="pipeline-title" title="Open orders" description="Where every unfinished order is right now." />
          <ul className="list">
            {stats.pipeline.map(({ status, count, value }) => (
              <li key={status}>
                <Link to={`/orders?status=${status}`} className="list-row list-row--link">
                  <span className="list-row__main">
                    <OrderStatusBadge status={status} />
                    <span className="list-row__meta" style={{ display: 'block', marginTop: 4 }}>
                      {ORDER_STATUS[status].description}
                    </span>
                  </span>
                  <span style={{ textAlign: 'right' }}>
                    <span className="num" style={{ display: 'block', fontWeight: 600 }}>
                      {formatNumber(count)}
                    </span>
                    <span className="list-row__meta num">{formatINRCompact(value)}</span>
                  </span>
                  <CaretRightIcon size={14} color="var(--text-3)" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
          <dl className="card__body kv kv--compact kv--split" style={{ borderTop: '1px solid var(--border)' }}>
            <dt>Average time to confirm</dt>
            <dd className="num">{stats.toConfirm === null ? '—' : formatHours(stats.toConfirm)}</dd>
            <dt>Confirmed to dispatched</dt>
            <dd className="num">{stats.toDispatch === null ? '—' : formatHours(stats.toDispatch)}</dd>
            <dt>Dispatched to delivered</dt>
            <dd className="num">{stats.toDeliver === null ? '—' : formatHours(stats.toDeliver)}</dd>
            <dt>Delivered, {days} days</dt>
            <dd className="num">{formatNumber(stats.delivered)}</dd>
            <dt>Cancelled, {days} days</dt>
            <dd className="num">{formatNumber(stats.cancelled)}</dd>
          </dl>
        </Card>
      </div>

      <div className="dashboard-grid dashboard-grid--3">
        <Card aria-labelledby="category-title">
          <CardHeader id="category-title" title="Sales by category" description={`Share of ${formatINRCompact(stats.current.value)} ordered.`} />
          {stats.categories.length ? (
            <ul className="list">
              {stats.categories.map((row) => (
                <li key={row.id} className="list-row bar-row">
                  <span className="list-row__main">
                    <span className="bar-row__head">
                      <span className="list-row__title">{row.label}</span>
                      <span className="num">{formatINRCompact(row.value)}</span>
                    </span>
                    <span className="meter" aria-hidden>
                      <span className="meter__fill" style={{ display: 'block', width: `${(row.value / categoryTop) * 100}%` }} />
                    </span>
                    <span className="list-row__meta">
                      {formatPercent(row.value, stats.current.value)} · {plural(row.orders, 'order')} · {plural(row.qty, 'item')}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="card__body muted">No orders in this period.</p>
          )}
        </Card>

        <Card aria-labelledby="top-title">
          <CardHeader id="top-title" title="Top products" description="By order value in this period." />
          <RankedList
            rows={stats.products}
            to={(id) => `/products/${id}`}
            meta={(row) => `${row.sub} · ${plural(row.qty, 'unit')}`}
            empty="No products ordered in this period."
          />
        </Card>

        <Card aria-labelledby="customers-title">
          <CardHeader id="customers-title" title="Top customers" description="By order value in this period." />
          <RankedList rows={stats.customers} to={(id) => `/customers/${id}`} meta={(row) => plural(row.orders, 'order')} empty="No customers ordered in this period." />
        </Card>
      </div>

      <div className="dashboard-grid">
        <Card aria-labelledby="recent-title" className="table-card">
          <CardHeader
            id="recent-title"
            title="Latest orders"
            action={
              <ButtonLink to="/orders" variant="plain" size="sm">
                View All
              </ButtonLink>
            }
          />
          <div className="table-scroll">
            <table className="table">
              <caption className="visually-hidden">Six most recent orders</caption>
              <thead>
                <tr>
                  <th scope="col">Order</th>
                  <th scope="col">Customer</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="is-num">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {recentOrders.map((order) => (
                  <tr key={order.id}>
                    <td>
                      <Link className="cell-title num" to={`/orders/${order.id}`}>
                        {order.number}
                      </Link>
                      <div className="cell-sub">{formatRelativeTime(order.createdAt, now)}</div>
                    </td>
                    <td>
                      {order.customer}
                      <div className="cell-sub">{plural(order.lines.length, 'line')}</div>
                    </td>
                    <td>
                      <OrderStatusBadge status={order.status} />
                    </td>
                    <td className="is-num">{formatINR(order.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card aria-labelledby="attention-title">
          <CardHeader id="attention-title" title="Needs attention" description={pending.length ? 'Things people using the app will notice.' : undefined} />
          {pending.length ? (
            <ul className="list">
              {pending.map(({ icon: ItemIcon, title, detail, to, count }) => (
                <li key={title}>
                  <Link to={to} className="list-row list-row--link">
                    <span className="icon-tile" aria-hidden>
                      <ItemIcon size={18} />
                    </span>
                    <span className="list-row__main">
                      <span className="list-row__title" style={{ display: 'block' }}>
                        {title}
                      </span>
                      <span className="list-row__meta">{detail}</span>
                    </span>
                    <span className="num" style={{ fontWeight: 600 }}>
                      {formatNumber(count)}
                    </span>
                    <CaretRightIcon size={14} color="var(--text-3)" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="card__body muted">Everything’s in order. Nothing needs your attention right now.</p>
          )}
        </Card>
      </div>

      <div className="dashboard-grid">
        <Card aria-labelledby="catalogue-title">
          <CardHeader
            id="catalogue-title"
            title="Catalogue in the app"
            description={`${formatNumber(health.visible)} of ${formatNumber(health.total)} products shown in the Shop.`}
            action={
              <ButtonLink to="/products" variant="plain" size="sm">
                Products
              </ButtonLink>
            }
          />
          <div className="card__body coverage">
            <Coverage label="With an exact MRP" part={health.priced} whole={health.total} hint="The rest open their catalogue page for prices" />
            <Coverage label="With a photo" part={health.photo} whole={health.total} hint="The rest show a placeholder" />
            <Coverage label="Featured systems" part={health.featured} whole={health.visible} hint="Shown first in the Shop" />
          </div>
          <dl className="card__body kv kv--compact" style={{ borderTop: '1px solid var(--border)' }}>
            {health.bySource.map(({ source, count }) => (
              <div key={source} style={{ display: 'contents' }}>
                <dt>{SOURCE_LABEL[source]}</dt>
                <dd className="num">{plural(count, 'product')}</dd>
              </div>
            ))}
            <dt>Glass formulas</dt>
            <dd>
              <Link to="/formulas">
                {configurations.length - placeholderFormulas} of {configurations.length} have a formula
              </Link>
            </dd>
          </dl>
        </Card>

        <Card aria-labelledby="activity-title">
          <CardHeader
            id="activity-title"
            title="Recent activity"
            action={
              <ButtonLink to="/activity" variant="plain" size="sm">
                View All
              </ButtonLink>
            }
          />
          <ol className="list">
            {db.activity.slice(0, 6).map((entry) => (
              <li key={entry.id} className="list-row" style={{ alignItems: 'flex-start' }}>
                <span className="list-row__main">
                  {entry.to ? (
                    <Link to={entry.to} className="list-row__title" style={{ color: 'var(--text)', display: 'block' }}>
                      {entry.summary}
                    </Link>
                  ) : (
                    <span className="list-row__title" style={{ display: 'block' }}>
                      {entry.summary}
                    </span>
                  )}
                  <span className="list-row__meta">
                    {entry.by} · {formatRelativeTime(entry.at, now)}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </div>
  );
}

const SOURCE_LABEL = { master: 'Master catalogue', office: 'Office catalogue', tavic: 'Tavic catalogue' } as const;

function Coverage({ label, part, whole, hint }: { label: string; part: number; whole: number; hint: string }) {
  return (
    <div className="coverage__item">
      <p className="coverage__value num">{formatPercent(part, whole)}</p>
      <p className="coverage__label">{label}</p>
      <span className="meter" aria-hidden>
        <span className="meter__fill" style={{ display: 'block', width: whole ? `${(part / whole) * 100}%` : 0 }} />
      </span>
      <p className="list-row__meta">
        {formatNumber(part)} of {formatNumber(whole)}. {hint}.
      </p>
    </div>
  );
}

function RankedList({
  rows,
  to,
  meta,
  empty,
}: {
  rows: Ranked[];
  to: (id: string) => string;
  meta: (row: Ranked) => string;
  empty: string;
}) {
  if (!rows.length) return <p className="card__body muted">{empty}</p>;
  return (
    <ol className="list">
      {rows.map((row, index) => (
        <li key={row.id}>
          <Link to={to(row.id)} className="list-row list-row--link">
            <span className="rank num" aria-hidden>
              {index + 1}
            </span>
            <span className="list-row__main">
              <span className="list-row__title" style={{ display: 'block' }}>
                {row.label}
              </span>
              <span className="list-row__meta">{meta(row)}</span>
            </span>
            <span className="num" style={{ fontWeight: 600 }}>
              {row.unpriced === row.qty ? <span className="muted">From catalogue</span> : formatINRCompact(row.value)}
            </span>
          </Link>
        </li>
      ))}
    </ol>
  );
}
