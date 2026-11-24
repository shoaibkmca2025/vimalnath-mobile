import { ChatCircleTextIcon, ClockIcon, CurrencyInrIcon, DeviceMobileIcon, HandCoinsIcon, MapPinIcon, PhoneIcon, ReceiptIcon, ShoppingCartIcon, UsersThreeIcon, WarningCircleIcon } from '@phosphor-icons/react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

import { Badge, OrderStatusBadge } from '@/components/Badge';
import { Button, ButtonLink } from '@/components/Button';
import { Card, CardHeader } from '@/components/Card';
import { DataTable, type Column } from '@/components/DataTable';
import { EmptyState } from '@/components/EmptyState';
import { TextAreaField, TextField } from '@/components/Field';
import { PageHeader } from '@/components/PageHeader';
import { CustomerGstCard } from '@/components/CustomerGstCard';
import { PaymentDrawer } from '@/components/PaymentDrawer';
import { Stat } from '@/components/Stat';
import { useToast } from '@/components/useToast';
import { topProducts } from '@/data/analytics';
import type { CustomerRecord } from '@/data/customers';
import { ORDER_STATUS, STATUS_ORDER, customerOf, isCounted, itemCount, whatsappLink } from '@/data/orders';
import { PAYMENT_METHODS, accounts, billOf, billStatus, creditDaysOf, dayLabel, isBilled, remainingOf, stateLabel } from '@/data/payments';
import { useData } from '@/data/useData';
import type { Order } from '@/data/types';
import { api, type ApiError } from '@/lib/api';
import { handlesMoney, movesOrders, readSession } from '@/data/session';
import { formatDate, formatINR, formatINRCompact, formatNumber, formatRelativeDay, formatRelativeTime, initials, plural, relativePhrase } from '@/lib/format';

type Draft = { name: string; tags: string; note: string };
const draftOf = (customer: CustomerRecord): Draft => ({ name: customer.name, tags: customer.tags.join(', '), note: customer.note });

export default function CustomerDetailPage() {
  const { key } = useParams();
  const { db } = useData();
  const navigate = useNavigate();
  const toast = useToast();
  const [customer, setCustomer] = useState<CustomerRecord | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [failure, setFailure] = useState<ApiError | null>(null);
  const [saving, setSaving] = useState(false);
  const [paying, setPaying] = useState(false);

  useEffect(() => {
    let active = true;
    api<CustomerRecord>(`/customers/${encodeURIComponent(key ?? '')}`).then(
      (found) => {
        if (!active) return;
        // A merged customer's old link lands on the one it was merged into.
        if (String(found.id) !== key) navigate(`/customers/${found.id}`, { replace: true });
        setCustomer(found);
        setDraft(draftOf(found));
      },
      (error: Error) => active && setLoadError(error.message),
    );
    return () => {
      active = false;
    };
  }, [key, navigate]);

  const orders = useMemo(() => (customer ? db.orders.filter((order) => customerOf(order).key === String(customer.id)) : []), [db.orders, customer]);

  if (!customer || !draft)
    return (
      <>
        <PageHeader title={loadError ? 'Customer not found' : 'Customer'} crumbs={[{ label: 'Customers', to: '/customers' }]} />
        <Card>
          <EmptyState
            icon={UsersThreeIcon}
            title={loadError ? 'This customer doesn’t exist' : 'Loading customer…'}
            action={
              loadError && (
                <ButtonLink to="/customers" variant="primary">
                  Back to Customers
                </ButtonLink>
              )
            }
          >
            {loadError}
          </EmptyState>
        </Card>
      </>
    );

  const counted = orders.filter((order) => isCounted(order.status));
  const products = topProducts(counted).slice(0, 6);
  const topQty = Math.max(1, ...products.map((product) => product.qty));
  const places = [...new Set(orders.map((order) => order.notes).filter((note): note is string => Boolean(note)))].slice(0, 4);
  const sites = [...new Set(orders.map((order) => order.customer).filter(Boolean))].slice(0, 6);
  const phone = customer.phone || orders.find((order) => order.phone)?.phone || '';
  const statusMix = STATUS_ORDER.map((status) => ({ status, count: orders.filter((order) => order.status === status).length })).filter((row) => row.count);
  const averageGapDays =
    customer.firstOrder && customer.lastOrder && customer.orders > 1 ? (new Date(customer.lastOrder).getTime() - new Date(customer.firstOrder).getTime()) / (customer.orders - 1) / 86_400_000 : null;
  const paid = orders.filter((order) => isCounted(order.status)).length;
  const dirty = JSON.stringify(draft) !== JSON.stringify(draftOf(customer));
  const creditDays = creditDaysOf(db.settings);
  const account = accounts(orders, creditDays)[0];
  const received = orders
    .flatMap((order) => (order.payments ?? []).map((payment) => ({ payment, order })))
    .sort((a, b) => b.payment.paidOn.localeCompare(a.payment.paidOn) || b.payment.at.localeCompare(a.payment.at));

  const save = async () => {
    setSaving(true);
    setFailure(null);
    try {
      const tags = draft.tags.split(',').map((tag) => tag.trim()).filter(Boolean);
      const saved = await api<CustomerRecord>(`/customers/${customer.id}`, 'PATCH', { name: draft.name, tags, note: draft.note });
      setCustomer(saved);
      setDraft(draftOf(saved));
      toast({ message: `${saved.name} saved.` });
    } catch (error) {
      setFailure(error as ApiError);
    } finally {
      setSaving(false);
    }
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
          <div className="cell-sub">{order.customer}</div>
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
    { key: 'total', header: 'Bill', align: 'num', sortValue: billOf, cell: (order) => formatINR(billOf(order)) },
    {
      key: 'payment',
      header: 'Payment',
      sortValue: (order) => (isBilled(order) ? remainingOf(order) : -1),
      cell: (order) => {
        if (!isBilled(order)) return <span className="muted">Not billed</span>;
        const status = billStatus(order, creditDays);
        const { label, tone } = stateLabel(status);
        return (
          <>
            <Badge tone={tone}>{label}</Badge>
            {status.state !== 'paid' && status.state !== 'noBill' && <div className="cell-sub num">{formatINR(status.remaining)} left</div>}
          </>
        );
      },
    },
    { key: 'date', header: 'Placed', sortValue: (order) => order.createdAt, cell: (order) => <span className="num">{formatDate(order.createdAt)}</span> },
  ];

  return (
    <>
      <PageHeader
        title={customer.name}
        crumbs={[{ label: 'Customers', to: '/customers' }]}
        description={`Customer since ${formatDate(customer.createdAt)} · ${customer.lastOrder ? `last ordered ${relativePhrase(formatRelativeDay(customer.lastOrder))}` : 'no orders yet'}`}
        actions={
          phone && (
            <>
              <a className="btn btn--secondary" href={`tel:${phone.replace(/\s/g, '')}`}>
                <PhoneIcon size={17} weight="bold" aria-hidden /> Call
              </a>
              <a className="btn btn--secondary" href={whatsappLink(phone)} target="_blank" rel="noreferrer">
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
          <Stat
            label="Average order"
            icon={ShoppingCartIcon}
            value={formatINRCompact(paid > 0 ? customer.spent / paid : 0)}
            foot={averageGapDays === null ? (customer.orders ? 'One order so far' : 'No orders yet') : `Orders every ${plural(Math.max(1, Math.round(averageGapDays)), 'day')} on average`}
          />
          <Stat label="Open orders" icon={ClockIcon} value={formatNumber(customer.open)} foot={customer.open ? 'Not delivered yet' : 'Nothing waiting'} />
        </div>

        <div className="editor">
          <div className="stack">
            <Card aria-labelledby="payments-title">
              <CardHeader
                id="payments-title"
                title="Payments"
                description={`Credit orders fall due ${plural(creditDays, 'day')} after delivery; cash orders on delivery.`}
                action={
                  handlesMoney(readSession()?.role) && (
                    <Button size="sm" variant="primary" icon={HandCoinsIcon} disabled={!account?.remaining} onClick={() => setPaying(true)}>
                      Record Payment
                    </Button>
                  )
                }
              />
              <div className="card__body stack">
                <dl className="kv kv--compact kv--split">
                  <dt>Billed</dt>
                  <dd className="num">{formatINR(account?.billed ?? 0)}</dd>
                  <dt>Paid</dt>
                  <dd className="num">{formatINR(account?.paid ?? 0)}</dd>
                  <dt>Remaining</dt>
                  <dd className="num" style={{ fontWeight: 600 }}>
                    {formatINR(account?.remaining ?? 0)}
                  </dd>
                  <dt>Overdue</dt>
                  <dd className={account?.overdue ? 'num money-late' : 'num'}>{formatINR(account?.overdue ?? 0)}</dd>
                </dl>
                {account && account.overdueBills > 0 && (
                  <p className="notice notice--danger">
                    <WarningCircleIcon size={16} weight="bold" aria-hidden />
                    <span>
                      {formatINR(account.overdue)} is overdue on {plural(account.overdueBills, 'bill')}; the oldest is {plural(account.mostLate, 'day')} late.
                    </span>
                  </p>
                )}
              </div>
              {received.length > 0 && (
                <ul className="list" aria-label={`Payments from ${customer.name}`}>
                  {received.slice(0, 8).map(({ payment, order }) => (
                    <li key={payment.id}>
                      <Link to={`/orders/${order.id}`} className="list-row list-row--link">
                        <span className="list-row__main">
                          <span className="list-row__title num" style={{ display: 'block' }}>
                            {formatINR(payment.amount)} · {PAYMENT_METHODS[payment.method]}
                          </span>
                          <span className="list-row__meta">
                            {dayLabel(payment.paidOn)} · {order.number} · {payment.by}
                            {payment.note && ` · ${payment.note}`}
                          </span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              {received.length > 8 && (
                <p className="card__body muted" style={{ paddingTop: 0 }}>
                  {plural(received.length - 8, 'earlier payment')} on their orders.
                </p>
              )}
            </Card>

            <Card className="table-card" aria-labelledby="orders-title">
              <CardHeader id="orders-title" title="Orders" description={plural(orders.length, 'order')} />
              {orders.length ? (
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
              ) : (
                <p className="card__body muted">No orders yet. They appear here as soon as their app sends one.</p>
              )}
            </Card>

            {movesOrders(readSession()?.role) && (
            <Card aria-labelledby="notes-title">
              <CardHeader id="notes-title" title="Notes and tags" description="Only people using this admin see these." />
              <div className="card__body stack">
                <TextField label="Name" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} error={failure?.field === 'name' ? failure.message : null} required />
                <TextField
                  label="Tags"
                  value={draft.tags}
                  onChange={(event) => setDraft({ ...draft, tags: event.target.value })}
                  hint="Separate with commas, for example dealer, contractor, pays late."
                  error={failure?.field?.startsWith('tags') ? failure.message : null}
                />
                <TextAreaField label="Note" value={draft.note} onChange={(event) => setDraft({ ...draft, note: event.target.value })} rows={4} error={failure?.field === 'note' ? failure.message : null} />
                {failure && !failure.field && (
                  <p className="notice notice--warning" role="alert">
                    {failure.message}
                  </p>
                )}
                <div className="row" style={{ justifyContent: 'flex-end' }}>
                  {dirty && <Button onClick={() => setDraft(draftOf(customer))}>Discard</Button>}
                  <Button variant="primary" disabled={!dirty} loading={saving} onClick={save}>
                    Save
                  </Button>
                </div>
              </div>
            </Card>
            )}
          </div>

          <div className="stack editor__aside">
            <Card aria-labelledby="contact-title">
              <CardHeader id="contact-title" title="Contact" description="From the profile their app sent." />
              <div className="card__body stack">
                <div className="row" style={{ gap: 'var(--space-3)' }}>
                  <span className="avatar avatar--lg" aria-hidden>
                    {initials(customer.name)}
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', fontWeight: 600 }}>{customer.business || customer.name}</span>
                    <span className="cell-sub">{phone || 'No phone number given'}</span>
                  </span>
                </div>
                {customer.tags.length > 0 && (
                  <div className="row-wrap" style={{ gap: 4 }}>
                    {customer.tags.map((tag) => (
                      <Badge key={tag} tone="neutral">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                )}
                <dl className="kv kv--compact">
                  <dt>Email</dt>
                  <dd>{customer.email || '—'}</dd>
                  <dt>City</dt>
                  <dd>{customer.city || '—'}</dd>
                </dl>
                <div>
                  <p className="field__label" style={{ marginBottom: 6 }}>
                    Sites on their orders
                  </p>
                  {sites.length ? <p>{sites.join(', ')}</p> : <p className="muted">None yet.</p>}
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

            <CustomerGstCard customer={customer} onSaved={setCustomer} />

            <Card aria-labelledby="phones-title">
              <CardHeader id="phones-title" title="Their app" description={plural(customer.appUsers.length, 'phone')} />
              <ul className="list">
                {customer.appUsers.map((user) => (
                  <li key={user.id}>
                    <Link to={`/app-users?q=${encodeURIComponent(user.label)}`} className="list-row list-row--link">
                      <DeviceMobileIcon size={18} color="var(--text-2)" aria-hidden />
                      <span className="list-row__main">
                        <span className="list-row__title" style={{ display: 'block' }}>
                          {user.label}
                        </span>
                        <span className="list-row__meta">
                          {user.blocked ? 'Blocked' : user.lastSeenAt ? `Last seen ${formatRelativeTime(user.lastSeenAt).toLowerCase()}` : 'Not connected yet'}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>

            {statusMix.length > 0 && (
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
            )}

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

      {account && <PaymentDrawer open={paying} onClose={() => setPaying(false)} customer={customer.name} orders={account.unpaid} logTo={`/customers/${customer.id}`} />}
    </>
  );
}
