import { ChatCircleTextIcon, ClockIcon, CurrencyInrIcon, MapPinIcon, PhoneIcon, ReceiptIcon, ShoppingCartIcon, UsersThreeIcon } from '@phosphor-icons/react';
import { useMemo } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

import { OrderStatusBadge } from '@/components/Badge';
import { ButtonLink } from '@/components/Button';
import { Card, CardHeader } from '@/components/Card';
import { DataTable, type Column } from '@/components/DataTable';
import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';
import { Stat } from '@/components/Stat';
import { topProducts } from '@/data/analytics';
import { ORDER_STATUS, STATUS_ORDER, customerKey, customersFromOrders, itemCount, whatsappLink } from '@/data/orders';
import { useData } from '@/data/useData';
import type { Order } from '@/data/types';
import { formatDate, formatINR, formatINRCompact, formatNumber, formatRelativeDay, initials, plural, relativePhrase } from '@/lib/format';

export default function CustomerDetailPage() {
  const { key } = useParams();
  const { db } = useData();
  const navigate = useNavigate();

  const orders = useMemo(() => db.orders.filter((order) => customerKey(order.customer) === key), [db.orders, key]);
  const customer = useMemo(() => customersFromOrders(orders)[0], [orders]);

  if (!customer)
    return (
      <>
        <PageHeader title="Customer not found" crumbs={[{ label: 'Customers', to: '/customers' }]} />
        <Card>
          <EmptyState
            icon={UsersThreeIcon}
            title="No orders from this customer"
            action={
              <ButtonLink to="/customers" variant="primary">
                Back to Customers
              </ButtonLink>
            }
          >
            The link may be incomplete, or their orders were removed.
          </EmptyState>
        </Card>
      </>
    );

  const counted = orders.filter((order) => order.status !== 'cancelled');
  const products = topProducts(counted).slice(0, 6);
  const topQty = Math.max(1, ...products.map((product) => product.qty));
  const places = [...new Set(orders.map((order) => order.notes).filter((note): note is string => Boolean(note)))].slice(0, 4);
  const phones = [...new Set(orders.map((order) => order.phone).filter((phone): phone is string => Boolean(phone)))];
  const statusMix = STATUS_ORDER.map((status) => ({ status, count: orders.filter((order) => order.status === status).length })).filter((row) => row.count);
  const averageGapDays = orders.length > 1 ? (new Date(customer.lastOrder).getTime() - new Date(customer.firstOrder).getTime()) / (orders.length - 1) / 86_400_000 : null;

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
        title={customer.name}
        crumbs={[{ label: 'Customers', to: '/customers' }]}
        description={`Customer since ${formatDate(customer.firstOrder)} · last ordered ${relativePhrase(formatRelativeDay(customer.lastOrder))}`}
        actions={
          customer.phone && (
            <>
              <a className="btn btn--secondary" href={`tel:${customer.phone.replace(/\s/g, '')}`}>
                <PhoneIcon size={17} weight="bold" aria-hidden /> Call
              </a>
              <a className="btn btn--secondary" href={whatsappLink(customer.phone)} target="_blank" rel="noreferrer">
                <ChatCircleTextIcon size={17} weight="bold" aria-hidden /> WhatsApp
              </a>
            </>
          )
        }
      />

      <div className="stack-lg">
        <div className="stats">
          <Stat label="Ordered (MRP)" icon={CurrencyInrIcon} value={formatINRCompact(customer.spent)} title={formatINR(customer.spent)} foot="Cancelled orders left out" />
          <Stat label="Orders" icon={ReceiptIcon} value={formatNumber(customer.orders)} foot={`${plural(counted.reduce((sum, order) => sum + itemCount(order), 0), 'item')} in all`} />
          <Stat label="Average order" icon={ShoppingCartIcon} value={formatINRCompact(counted.length ? customer.spent / counted.length : 0)} foot={averageGapDays === null ? 'One order so far' : `Orders every ${Math.max(1, Math.round(averageGapDays))} days on average`} />
          <Stat label="Open orders" icon={ClockIcon} value={formatNumber(customer.open)} foot={customer.open ? 'Not delivered yet' : 'Nothing waiting'} />
        </div>

        <div className="editor">
          <Card className="table-card" aria-labelledby="orders-title">
            <CardHeader id="orders-title" title="Orders" description={plural(orders.length, 'order')} />
            <DataTable
              caption={`Orders from ${customer.name}`}
              rows={orders}
              columns={columns}
              getRowId={(order) => order.id}
              onRowClick={(order) => navigate(`/orders/${order.id}`)}
              initialSort={{ key: 'date', direction: 'desc' }}
              pageSize={10}
              empty={null}
            />
          </Card>

          <div className="stack editor__aside">
            <Card aria-labelledby="contact-title">
              <CardHeader id="contact-title" title="Contact" />
              <div className="card__body stack">
                <div className="row" style={{ gap: 'var(--space-3)' }}>
                  <span className="avatar avatar--lg" aria-hidden>
                    {initials(customer.name)}
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', fontWeight: 600 }}>{customer.name}</span>
                    <span className="cell-sub">{phones.length ? phones.join(', ') : 'No phone number given'}</span>
                  </span>
                </div>
                <div>
                  <p className="field__label" style={{ marginBottom: 6 }}>
                    Delivery notes they’ve used
                  </p>
                  {places.length ? (
                    <ul className="plain-list">
                      {places.map((place) => (
                        <li key={place} className="row" style={{ alignItems: 'flex-start', gap: 8 }}>
                          <MapPinIcon size={16} color="var(--text-2)" aria-hidden style={{ flexShrink: 0, marginTop: 2 }} />
                          {place}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="muted">None given.</p>
                  )}
                </div>
              </div>
            </Card>

            <Card aria-labelledby="mix-title">
              <CardHeader id="mix-title" title="Order status" />
              <ul className="list">
                {statusMix.map(({ status, count }) => (
                  <li key={status} className="list-row">
                    <span className="list-row__main">
                      <OrderStatusBadge status={status} />
                    </span>
                    <span className="num" style={{ fontWeight: 600 }}>
                      {formatNumber(count)}
                    </span>
                    <span className="visually-hidden">{ORDER_STATUS[status].description}</span>
                  </li>
                ))}
              </ul>
            </Card>

            <Card aria-labelledby="buys-title">
              <CardHeader id="buys-title" title="What they order" description="By units, cancelled orders left out." />
              {products.length ? (
                <ul className="list">
                  {products.map((product) => (
                    <li key={product.id}>
                      <Link to={`/products/${product.id}`} className="list-row list-row--link">
                        <span className="list-row__main">
                          <span className="list-row__title" style={{ display: 'block' }}>
                            {product.label}
                          </span>
                          <span className="meter" style={{ display: 'block', margin: '6px 0 4px' }} aria-hidden>
                            <span className="meter__fill" style={{ display: 'block', width: `${(product.qty / topQty) * 100}%` }} />
                          </span>
                          <span className="list-row__meta">
                            {plural(product.qty, 'unit')} · {product.unpriced === product.qty ? 'priced from the catalogue' : formatINRCompact(product.value)}
                          </span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="card__body muted">Nothing delivered or open yet.</p>
              )}
            </Card>
          </div>
        </div>
      </div>
    </>
  );
}
