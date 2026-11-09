import { CheckCircleIcon, CheckIcon, DownloadSimpleIcon, PackageIcon, ReceiptIcon, TruckIcon, XIcon } from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';

import { OrderStatusBadge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { DataTable, type Column } from '@/components/DataTable';
import { EmptyState } from '@/components/EmptyState';
import { SearchInput, Segmented } from '@/components/Field';
import { PageHeader } from '@/components/PageHeader';
import { useToast } from '@/components/useToast';
import { ORDER_STATUS, STATUS_ORDER, itemCount } from '@/data/orders';
import { productTitle } from '@/data/products';
import { readSession } from '@/data/session';
import { useData } from '@/data/useData';
import type { Order, OrderStatus } from '@/data/types';
import { downloadCsv } from '@/lib/csv';
import { formatDate, formatINR, formatNumber, formatRelativeDay, plural } from '@/lib/format';

type Filter = 'all' | OrderStatus;

export default function OrdersPage() {
  const { db, update } = useData();
  const toast = useToast();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const status = (STATUS_ORDER as string[]).includes(params.get('status') ?? '') ? (params.get('status') as OrderStatus) : 'all';
  const productId = params.get('product');
  const product = productId ? db.products.find((item) => item.id === productId) : undefined;
  const setFilters = (next: { status?: Filter; product?: string | null }) => {
    setSelected(new Set());
    const nextStatus = next.status ?? status;
    const nextProduct = next.product === undefined ? productId : next.product;
    setParams({ ...(nextStatus !== 'all' && { status: nextStatus }), ...(nextProduct && { product: nextProduct }) }, { replace: true });
  };
  const setStatus = (next: Filter) => setFilters({ status: next });

  const counts = useMemo(() => {
    const scoped = productId ? db.orders.filter((order) => order.lines.some((line) => line.productId === productId)) : db.orders;
    const map: Record<string, number> = { all: scoped.length };
    for (const order of scoped) map[order.status] = (map[order.status] ?? 0) + 1;
    return map;
  }, [db.orders, productId]);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    // Phone numbers match on digits alone, so "98220" finds "+91 98220 …".
    const digits = needle.replace(/\D/g, '');
    return db.orders.filter(
      (order) =>
        (status === 'all' || order.status === status) &&
        (!productId || order.lines.some((line) => line.productId === productId)) &&
        (!needle ||
          [order.number, order.customer, order.notes ?? '', ...order.lines.flatMap((line) => [line.code, line.optionCode ?? ''])].some((field) => field.toLowerCase().includes(needle)) ||
          (digits.length >= 4 && (order.phone ?? '').replace(/\D/g, '').includes(digits))),
    );
  }, [db.orders, status, query, productId]);

  const shownValue = rows.filter((order) => order.status !== 'cancelled').reduce((sum, order) => sum + order.total, 0);

  const exportRows = () =>
    downloadCsv(
      'vimalnath-orders',
      ['Order', 'Placed', 'Customer', 'Phone', 'Status', 'Lines', 'Items', 'Total (MRP)', 'Notes'],
      rows.map((order) => [order.number, order.createdAt.slice(0, 16).replace('T', ' '), order.customer, order.phone, ORDER_STATUS[order.status].label, order.lines.length, itemCount(order), order.total, order.notes]),
    );

  const move = (ids: string[], from: OrderStatus, to: OrderStatus) => {
    const eligible = ids.filter((id) => db.orders.find((order) => order.id === id)?.status === from);
    if (!eligible.length) {
      toast({ message: `None of the selected orders are ${ORDER_STATUS[from].label.toLowerCase()}.`, tone: 'info' });
      return;
    }
    const previous = db.orders;
    const at = new Date().toISOString();
    const by = readSession()?.name ?? 'Admin';
    const numbers = eligible.map((id) => db.orders.find((order) => order.id === id)!.number);
    update(
      'orders',
      (orders) => orders.map((order) => (eligible.includes(order.id) ? { ...order, status: to, history: [...order.history, { status: to, at, by }] } : order)),
      {
        area: 'orders',
        summary: `Marked ${numbers.length === 1 ? numbers[0] : plural(numbers.length, 'order')} ${ORDER_STATUS[to].label.toLowerCase()}`,
        to: numbers.length === 1 ? `/orders/${eligible[0]}` : '/orders',
      },
    );
    setSelected(new Set());
    toast({
      message: `${plural(eligible.length, 'order')} marked ${ORDER_STATUS[to].label.toLowerCase()}.`,
      action: {
        label: 'Undo',
        onAction: () => update('orders', () => previous, { area: 'orders', summary: `Undid: ${plural(eligible.length, 'order')} back to ${ORDER_STATUS[from].label.toLowerCase()}`, to: '/orders' }),
      },
    });
  };

  const columns: Column<Order>[] = [
    {
      key: 'number',
      header: 'Order',
      sortValue: (order) => order.number,
      cell: (order) => (
        <>
          <Link to={`/orders/${order.id}`} className="cell-title num">
            {order.number}
          </Link>
          <div className="cell-sub">{formatRelativeDay(order.createdAt)}</div>
        </>
      ),
    },
    {
      key: 'customer',
      header: 'Customer',
      sortValue: (order) => order.customer,
      cell: (order) => (
        <>
          {order.customer}
          <div className="cell-sub">{order.phone ?? 'No phone given'}</div>
        </>
      ),
    },
    { key: 'status', header: 'Status', sortValue: (order) => STATUS_ORDER.indexOf(order.status), cell: (order) => <OrderStatusBadge status={order.status} /> },
    {
      key: 'items',
      header: 'Items',
      align: 'num',
      sortValue: itemCount,
      cell: (order) => (
        <>
          {formatNumber(itemCount(order))}
          <div className="cell-sub">{plural(order.lines.length, 'line')}</div>
        </>
      ),
    },
    { key: 'total', header: 'Total (MRP)', align: 'num', sortValue: (order) => order.total, cell: (order) => formatINR(order.total) },
    { key: 'date', header: 'Placed', sortValue: (order) => order.createdAt, cell: (order) => <span className="num">{formatDate(order.createdAt)}</span> },
  ];

  return (
    <>
      <PageHeader
        title="Orders"
        description="Orders placed from the app’s cart. Confirm new ones, then move each along as it’s dispatched and delivered."
        actions={
          <Button icon={DownloadSimpleIcon} onClick={exportRows} disabled={!rows.length}>
            Export CSV
          </Button>
        }
      />

      <div className="toolbar">
        <Segmented<Filter>
          label="Filter by status"
          value={status}
          onChange={setStatus}
          options={[{ value: 'all', label: 'All', count: counts.all }, ...STATUS_ORDER.map((value) => ({ value, label: ORDER_STATUS[value].label, count: counts[value] ?? 0 }))]}
        />
        <SearchInput label="Search orders" placeholder="Order, customer, phone or product code" value={query} onChange={setQuery} />
      </div>

      <div className="filter-summary">
        {product && (
          <span className="chip">
            <PackageIcon size={14} aria-hidden />
            Contains {productTitle(product)}
            <button type="button" className="chip__remove" aria-label={`Stop filtering by ${productTitle(product)}`} onClick={() => setFilters({ product: null })}>
              <XIcon size={12} weight="bold" aria-hidden />
            </button>
          </span>
        )}
        <span className="muted" aria-live="polite">
          {plural(rows.length, 'order')} · {formatINR(shownValue)} at MRP{rows.some((order) => order.status === 'cancelled') ? ', cancelled left out' : ''}
        </span>
      </div>

      <Card className="table-card">
        <DataTable
          caption="Orders"
          rows={rows}
          columns={columns}
          getRowId={(order) => order.id}
          onRowClick={(order) => navigate(`/orders/${order.id}`)}
          selectable
          selected={selected}
          onSelectedChange={setSelected}
          resetKey={`${status}|${query}|${productId ?? ''}`}
          initialSort={{ key: 'date', direction: 'desc' }}
          bulkActions={(ids) => (
            <>
              <Button size="sm" icon={CheckIcon} onClick={() => move(ids, 'placed', 'confirmed')}>
                Confirm
              </Button>
              <Button size="sm" icon={TruckIcon} onClick={() => move(ids, 'confirmed', 'dispatched')}>
                Mark Dispatched
              </Button>
              <Button size="sm" icon={CheckCircleIcon} onClick={() => move(ids, 'dispatched', 'delivered')}>
                Mark Delivered
              </Button>
            </>
          )}
          empty={
            <EmptyState
              icon={ReceiptIcon}
              title={db.orders.length ? 'No orders match' : 'No orders yet'}
              action={
                (query || status !== 'all' || productId) && (
                  <Button
                    onClick={() => {
                      setQuery('');
                      setFilters({ status: 'all', product: null });
                    }}
                  >
                    Clear Filters
                  </Button>
                )
              }
            >
              {db.orders.length ? 'Try a different status or search.' : 'Orders placed in the app will appear here.'}
            </EmptyState>
          }
        />
      </Card>
    </>
  );
}
