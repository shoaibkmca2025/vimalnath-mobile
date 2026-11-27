import {
  BookOpenIcon,
  CaretLeftIcon,
  CaretRightIcon,
  ChatCircleTextIcon,
  CheckIcon,
  NoteIcon,
  PackageIcon,
  PaperPlaneTiltIcon,
  PhoneIcon,
  ProhibitIcon,
  PrinterIcon,
  ReceiptIcon,
  TruckIcon,
  WarehouseIcon,
  WarningCircleIcon,
  XCircleIcon,
} from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

import { Badge, OrderStatusBadge } from '@/components/Badge';
import { Button, ButtonLink, IconButton } from '@/components/Button';
import { Card, CardHeader } from '@/components/Card';
import { ConfirmDialog } from '@/components/Dialog';
import { EmptyState } from '@/components/EmptyState';
import { InvoiceDocument, estimateOf } from '@/components/InvoiceDocument';
import { SelectField, TextAreaField } from '@/components/Field';
import { OrderPaymentCard } from '@/components/OrderPaymentCard';
import { TaxInvoiceCard } from '@/components/TaxInvoiceCard';
import { PageHeader } from '@/components/PageHeader';
import { Thumb } from '@/components/Thumb';
import { useToast } from '@/components/useToast';
import type { CustomerRecord } from '@/data/customers';
import { NEXT_ACTION_LABEL, ORDER_STATUS, STATUS_ORDER, customerOf, customersFromOrders, isOpen, itemCount, nextStatus, stepLabel, stepsOf, whatsappLink } from '@/data/orders';
import { accounts, creditDaysOf } from '@/data/payments';
import { inOrders } from '@/data/requests';
import { handlesMoney, movesOrders, readSession } from '@/data/session';
import { useData } from '@/data/useData';
import type { GstSettings, Order, OrderDelivery, OrderStatus, SalesInvoice } from '@/data/types';
import { api } from '@/lib/api';
import { formatDate, formatDateTime, formatINR, formatNumber, initials, plural } from '@/lib/format';

const SOURCE_NAME = { master: 'Master', office: 'Office', tavic: 'Tavic' } as const;

export default function OrderDetailPage() {
  const { id } = useParams();
  const { db, update } = useData();
  const toast = useToast();
  const navigate = useNavigate();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const index = db.orders.findIndex((item) => item.id === id);
  const order = db.orders[index];

  const [noteDraft, setNoteDraft] = useState(order?.internalNote?.text ?? '');
  const [stockDraft, setStockDraft] = useState(order?.inventoryNote?.text ?? '');
  const [noteSource, setNoteSource] = useState(order);
  if (noteSource !== order) {
    setNoteSource(order);
    if (order?.id !== noteSource?.id) {
      setNoteDraft(order?.internalNote?.text ?? '');
      setStockDraft(order?.inventoryNote?.text ?? '');
    }
  }

  if (!order)
    return (
      <>
        <PageHeader title="Order not found" crumbs={[{ label: 'Orders', to: '/orders' }]} />
        <Card>
          <EmptyState
            icon={ReceiptIcon}
            title="This order doesn’t exist"
            action={
              <ButtonLink to="/orders" variant="primary">
                Back to Orders
              </ButtonLink>
            }
          >
            It may have been removed, or the link is incomplete.
          </EmptyState>
        </Card>
      </>
    );

  const by = () => readSession()?.name ?? 'Admin';
  // Cancelling an order, and bringing a cancelled one back, are the Owner's.
  const owner = readSession()?.role === 'owner';

  const setStatus = async (status: OrderStatus) => {
    if (status === order.status) return;
    const previous = order;
    const ok = await update(
      'orders',
      (orders) => orders.map((item) => (item.id === order.id ? { ...item, status, history: [...item.history, { status, at: new Date().toISOString(), by: by() }] } : item)),
      { area: 'orders', summary: `Marked ${order.number} ${ORDER_STATUS[status].label.toLowerCase()}`, to: `/orders/${order.id}` },
    );
    if (!ok) return;
    toast({
      message: `${order.number} marked ${ORDER_STATUS[status].label.toLowerCase()}.`,
      action: {
        label: 'Undo',
        onAction: () =>
          update('orders', (orders) => orders.map((item) => (item.id === previous.id ? previous : item)), {
            area: 'orders',
            summary: `Undid: ${order.number} back to ${ORDER_STATUS[previous.status].label.toLowerCase()}`,
            to: `/orders/${order.id}`,
          }),
      },
    });
  };

  const noteDirty = noteDraft.trim() !== (order.internalNote?.text ?? '');
  const saveNote = async () => {
    const text = noteDraft.trim();
    const ok = await update(
      'orders',
      (orders) => orders.map((item) => (item.id === order.id ? { ...item, internalNote: text ? { text, at: new Date().toISOString(), by: by() } : undefined } : item)),
      { area: 'orders', summary: text ? `Updated the internal note on ${order.number}` : `Removed the internal note on ${order.number}`, to: `/orders/${order.id}` },
    );
    if (!ok) return;
    setNoteDraft(text);
    toast({ message: text ? 'Internal note saved.' : 'Internal note removed.' });
  };

  const stockDirty = stockDraft.trim() !== (order.inventoryNote?.text ?? '');
  const saveStockNote = async () => {
    const text = stockDraft.trim();
    const ok = await update(
      'orders',
      (orders) => orders.map((item) => (item.id === order.id ? { ...item, inventoryNote: text ? { text, at: new Date().toISOString(), by: by() } : undefined } : item)),
      { area: 'orders', summary: text ? `Updated the inventory note on ${order.number}` : `Removed the inventory note on ${order.number}`, to: `/orders/${order.id}` },
    );
    if (!ok) return;
    setStockDraft(text);
    toast({ message: text ? 'Inventory note saved.' : 'Inventory note removed.' });
  };

  const steps = stepsOf(order);
  const fromAdmin = order.source === 'admin';
  const next = nextStatus(order.status);
  const items = itemCount(order);
  const priced = order.lines.filter((line) => line.mrp !== undefined);
  const unpriced = order.lines.length - priced.length;
  const products = new Map(db.products.map((product) => [product.id, product]));
  const customer = customersFromOrders(db.orders.filter((item) => customerOf(item).key === customerOf(order).key))[0]!;
  const newer = db.orders[index - 1];
  const older = db.orders[index + 1];
  const reached = (status: OrderStatus) => order.history.findLast((event) => event.status === status);
  const ended = reached(order.status);
  // Newest first. A request also shows when the customer's app received it.
  const timeline = [
    ...order.history.map((step) => ({ key: `${step.status}-${step.at}`, label: stepLabel(step.status, step.by), at: step.at, who: step.by === 'App' ? order.customer : step.by, tone: ORDER_STATUS[step.status].tone })),
    ...(order.customerSeenAt ? [{ key: 'received', label: 'Received in their app', at: order.customerSeenAt, who: order.customer, tone: 'info' as const }] : []),
  ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

  return (
    <>
      <PageHeader
        title={`Order ${order.number}`}
        crumbs={[inOrders(order) ? { label: 'Orders', to: '/orders' } : { label: 'Order Requests', to: '/order-requests' }]}
        description={
          <>
            {order.customer} · {plural(items, 'item')} · {fromAdmin ? 'sent to the customer’s app' : 'placed in the app'} {formatDateTime(order.createdAt)}
          </>
        }
        actions={
          <>
            <span className="row no-print" style={{ gap: 4 }}>
              <IconButton icon={CaretLeftIcon} label={newer ? `Newer order, ${newer.number}` : 'No newer order'} disabled={!newer} onClick={() => newer && navigate(`/orders/${newer.id}`)} />
              <IconButton icon={CaretRightIcon} label={older ? `Older order, ${older.number}` : 'No older order'} disabled={!older} onClick={() => older && navigate(`/orders/${older.id}`)} />
            </span>
            <Button icon={PrinterIcon} onClick={() => window.print()} className="no-print">
              Print
            </Button>
            {next && movesOrders(readSession()?.role) && (
              <Button variant="primary" icon={next === 'confirmed' ? CheckIcon : next === 'packed' ? PackageIcon : next === 'dispatched' ? TruckIcon : undefined} onClick={() => setStatus(next)} className="no-print">
                {NEXT_ACTION_LABEL[next]}
              </Button>
            )}
          </>
        }
      />

      <OrderBill order={order} />
      <div className="no-print">
      <CreditWarning order={order} />

      <Card aria-label="Progress" className="no-print" style={{ marginBottom: 'var(--space-4)' }}>
        {order.status === 'cancelled' || order.status === 'declined' ? (
          <div className="card__body row" style={{ gap: 'var(--space-3)' }}>
            {order.status === 'cancelled' ? <XCircleIcon size={22} color="var(--danger)" aria-hidden /> : <ProhibitIcon size={22} color="var(--danger)" aria-hidden />}
            <span>
              <strong>{order.status === 'cancelled' ? 'Cancelled' : 'Declined by the customer'}</strong>
              <span className="muted">
                {' '}
                · {ended ? `${formatDateTime(ended.at)}${ended.by === 'App' ? ' in the app' : ` by ${ended.by}`}` : ''}
              </span>
            </span>
          </div>
        ) : (
          <ol className="stepper">
            {steps.map((step) => {
              const event = reached(step);
              const state = step === order.status ? 'current' : steps.indexOf(step) < steps.indexOf(order.status) ? 'done' : 'todo';
              return (
                <li key={step} className="stepper__step" data-state={state} aria-current={state === 'current' ? 'step' : undefined}>
                  <span className="stepper__dot" aria-hidden>
                    {state !== 'todo' && <CheckIcon size={12} weight="bold" />}
                  </span>
                  <span className="stepper__label">{step === 'placed' ? 'Placed' : step === 'requested' ? 'Sent' : ORDER_STATUS[step].label}</span>
                  <span className="stepper__meta">{event && state !== 'todo' ? `${formatDateTime(event.at)} · ${event.by === 'App' ? (step === 'placed' ? 'in the app' : 'by the customer') : event.by}` : 'Not yet'}</span>
                </li>
              );
            })}
          </ol>
        )}
      </Card>

      <div className="editor">
        <div className="stack">
          <Card aria-labelledby="items-title" className="table-card">
            <CardHeader id="items-title" title="Items" description={`${plural(order.lines.length, 'line')} · ${plural(items, 'item')}`} />
            <div className="table-scroll">
              <table className="table table--items">
                <caption className="visually-hidden">Items in order {order.number}</caption>
                <thead>
                  <tr>
                    <th scope="col">Product</th>
                    <th scope="col" className="is-num">
                      Qty
                    </th>
                    <th scope="col" className="is-num">
                      MRP
                    </th>
                    <th scope="col" className="is-num">
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {order.lines.map((line) => {
                    const product = products.get(line.productId);
                    const page = product?.catalogPage;
                    return (
                      <tr key={`${line.productId}-${line.option ?? ''}`}>
                        <td>
                          <div className="cell-media">
                            <span className="no-print">
                              <Thumb src={product?.image} />
                            </span>
                            <div style={{ minWidth: 0 }}>
                              <Link to={`/products/${line.productId}`} className="cell-title">
                                {line.name}
                              </Link>
                              <div className="cell-sub mono">{line.code}</div>
                              {line.option && (
                                <div className="cell-sub" style={{ whiteSpace: 'normal' }}>
                                  {line.option}
                                  {line.optionCode && line.optionCode !== line.code && <span className="mono"> · {line.optionCode}</span>}
                                </div>
                              )}
                              <p className="line-sum num">
                                {formatNumber(line.qty)} × {line.mrp === undefined ? 'catalogue price' : `${formatINR(line.mrp)} = ${formatINR(line.mrp * line.qty)}`}
                              </p>
                              {line.note && (
                                <p className="line-note">
                                  <NoteIcon size={14} aria-hidden /> {line.note}
                                </p>
                              )}
                              {line.problem && (
                                <div className="no-print" style={{ marginTop: 'var(--space-1)' }}>
                                  <Badge tone="warning" icon={WarningCircleIcon}>
                                    {line.problem}
                                  </Badge>
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="is-num">{formatNumber(line.qty)}</td>
                        <td className="is-num">{line.mrp === undefined ? '—' : formatINR(line.mrp)}</td>
                        <td className="is-num">
                          {line.mrp === undefined ? (
                            <span className="cell-sub" style={{ whiteSpace: 'normal' }}>
                              {page ? `${SOURCE_NAME[page.source]} catalogue, page ${page.page}` : 'From catalogue'}
                            </span>
                          ) : (
                            formatINR(line.mrp * line.qty)
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row" colSpan={3} className="table__total-label">
                      Total at MRP{unpriced ? `, ${plural(priced.length, 'priced line')}` : ''}
                    </th>
                    <td className="is-num table__total">{formatINR(order.total)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            {unpriced > 0 && (
              <p className="card__body notice" style={{ margin: 'var(--space-4)' }}>
                <BookOpenIcon size={16} weight="bold" aria-hidden />
                <span>
                  {plural(unpriced, 'line')} {unpriced === 1 ? 'is' : 'are'} priced from the catalogue page, as in the app, so the total leaves {unpriced === 1 ? 'it' : 'them'}{' '}
                  out. Quote {unpriced === 1 ? 'it' : 'them'} when you confirm.
                </span>
              </p>
            )}
          </Card>

          {order.delivery && <DeliveryCard delivery={order.delivery} />}

          <Card aria-labelledby="notes-title">
            <CardHeader id="notes-title" title={fromAdmin ? 'Delivery notes' : 'Customer’s notes'} description={fromAdmin ? 'Sent to the customer with the request.' : 'Typed in the app when the order was placed.'} />
            <p className="card__body" style={{ display: 'flex', gap: 8 }}>
              <NoteIcon size={18} color="var(--text-2)" aria-hidden style={{ flexShrink: 0, marginTop: 2 }} />
              {order.notes ?? <span className="muted">No delivery notes.</span>}
            </p>
          </Card>

          {movesOrders(readSession()?.role) && (
          <>
          <Card aria-labelledby="internal-title" className="no-print">
            <CardHeader
              id="internal-title"
              title="Internal note"
              description={order.internalNote ? `Last edited by ${order.internalNote.by}, ${formatDateTime(order.internalNote.at)}.` : 'Only people using this admin see it.'}
            />
            <div className="card__body stack">
              <TextAreaField label="Note" value={noteDraft} onChange={(event) => setNoteDraft(event.target.value)} rows={3} placeholder="e.g. Quoted the hinge separately; customer collecting from the godown" />
              <div className="row" style={{ justifyContent: 'flex-end' }}>
                {noteDirty && <Button onClick={() => setNoteDraft(order.internalNote?.text ?? '')}>Discard</Button>}
                <Button variant="primary" disabled={!noteDirty} onClick={saveNote}>
                  Save Note
                </Button>
              </div>
            </div>
          </Card>

          <Card aria-labelledby="stock-title" className="no-print">
            <CardHeader
              id="stock-title"
              title="Inventory note"
              description={order.inventoryNote ? `Last edited by ${order.inventoryNote.by}, ${formatDateTime(order.inventoryNote.at)}.` : 'Written by the inventory team: stock, packing, transport. Staff see it; the customer doesn’t.'}
              action={
                <Link to="/inventory" className="row" style={{ gap: 4 }}>
                  <WarehouseIcon size={14} aria-hidden /> Inventory
                </Link>
              }
            />
            <div className="card__body stack">
              <TextAreaField label="Note" value={stockDraft} onChange={(event) => setStockDraft(event.target.value)} rows={2} placeholder="e.g. VRL Logistics, LR 4471" />
              <div className="row" style={{ justifyContent: 'flex-end' }}>
                {stockDirty && <Button onClick={() => setStockDraft(order.inventoryNote?.text ?? '')}>Discard</Button>}
                <Button variant="primary" disabled={!stockDirty} onClick={saveStockNote}>
                  Save Note
                </Button>
              </div>
            </div>
          </Card>
          </>
          )}
        </div>

        <div className="stack editor__aside">
          <Card aria-labelledby="status-title" className="no-print">
            <CardHeader id="status-title" title="Status" action={<OrderStatusBadge status={order.status} />} />
            <div className="card__body stack">
              <p className="muted">{ORDER_STATUS[order.status].description}.</p>
            {order.status === 'requested' && (
              <p className="notice">
                <PaperPlaneTiltIcon size={16} weight="bold" aria-hidden />
                <span>
                  {order.customerSeenAt
                    ? `Received in ${order.appUser?.label ?? 'the customer'}’s app ${formatDateTime(order.customerSeenAt)}.`
                    : `Not received yet: ${order.appUser?.label ?? 'the customer'}’s app gets it the next time it syncs.`}{' '}
                  When they confirm it, it moves to Orders and the inventory team.
                </span>
              </p>
            )}
              {movesOrders(readSession()?.role) && (
                <SelectField
                  label="Change status"
                  value={order.status}
                  onChange={(event) => setStatus(event.target.value as OrderStatus)}
                  // Cancelling, and bringing a cancelled order back, are the Owner's.
                  options={STATUS_ORDER.filter((value) => owner || value !== 'cancelled' || order.status === 'cancelled').map((value) => ({ value, label: ORDER_STATUS[value].label }))}
                  disabled={!owner && order.status === 'cancelled'}
                  hint={!owner && order.status === 'cancelled' ? 'Only the Owner can bring a cancelled order back.' : 'The customer sees the new status in their app after its next sync.'}
                />
              )}
            </div>
            <ol className="timeline" aria-label="Status history">
              {timeline.map((step) => (
                <li key={step.key} className="timeline__item">
                  <span className="timeline__dot" data-tone={step.tone} aria-hidden />
                  <span>
                    <span style={{ fontWeight: 600 }}>{step.label}</span>
                    <span className="cell-sub" style={{ display: 'block' }}>
                      {formatDateTime(step.at)} · {step.who}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          </Card>

          <OrderPaymentCard order={order} />

          {handlesMoney(readSession()?.role) && <TaxInvoiceCard order={order} />}

          <Card aria-labelledby="customer-title">
            <CardHeader
              id="customer-title"
              title="Customer"
              action={
                <Link to={`/customers/${customer.key}`} className="no-print">
                  View
                </Link>
              }
            />
            <div className="card__body stack">
              <div className="row" style={{ gap: 'var(--space-3)' }}>
                <span className="avatar avatar--lg" aria-hidden>
                  {initials(customer.name)}
                </span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontWeight: 600 }}>{customer.name}</span>
                  {order.customer !== customer.name && <span className="cell-sub" style={{ display: 'block' }}>Site: {order.customer}</span>}
                  <span className="cell-sub">{order.phone ?? 'No phone number given'}</span>
                </span>
              </div>
              {order.phone && (
                <div className="row-wrap no-print">
                  <a className="btn btn--secondary btn--sm" href={`tel:${order.phone.replace(/\s/g, '')}`}>
                    <PhoneIcon size={15} weight="bold" aria-hidden /> Call
                  </a>
                  <a className="btn btn--secondary btn--sm" href={whatsappLink(order.phone)} target="_blank" rel="noreferrer">
                    <ChatCircleTextIcon size={15} weight="bold" aria-hidden /> WhatsApp
                  </a>
                </div>
              )}
              <dl className="kv kv--compact no-print">
                {order.appUser && (
                  <>
                    <dt>Sent from</dt>
                    <dd>
                      <Link to={`/app-users?q=${encodeURIComponent(order.appUser.label)}`}>{order.appUser.label}</Link>
                    </dd>
                  </>
                )}
                {order.appUser?.business && (
                  <>
                    <dt>Shop</dt>
                    <dd>{order.appUser.business}</dd>
                  </>
                )}
                {order.appUser?.phone && (
                  <>
                    <dt>Registered mobile</dt>
                    <dd className="num">{order.appUser.phone}</dd>
                  </>
                )}
                {order.appUser?.gstin && (
                  <>
                    <dt>GSTIN</dt>
                    <dd className="num">{order.appUser.gstin}</dd>
                  </>
                )}
                {order.appUser?.address && (
                  <>
                    <dt>Shop address</dt>
                    <dd>{order.appUser.address}</dd>
                  </>
                )}
                <dt>Orders</dt>
                <dd className="num">{formatNumber(customer.orders)}</dd>
                <dt>Ordered (MRP)</dt>
                <dd className="num">{formatINR(customer.spent)}</dd>
                <dt>Customer since</dt>
                <dd>{formatDate(customer.firstOrder)}</dd>
              </dl>
            </div>
          </Card>

          {owner && order.status !== 'cancelled' && order.status !== 'delivered' && order.status !== 'declined' && (
            <Button variant="danger-plain" icon={XCircleIcon} onClick={() => setConfirmCancel(true)} className="no-print">
              {order.status === 'requested' ? 'Cancel Request' : 'Cancel Order'}
            </Button>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmCancel}
        title={order.status === 'requested' ? `Cancel request ${order.number}?` : `Cancel order ${order.number}?`}
        body={
          order.status === 'requested'
            ? `${order.customer} will no longer be able to confirm it in the app. You can change the status back later if this was a mistake.`
            : `The order from ${order.customer} will be marked cancelled. You can change the status back later if this was a mistake.`
        }
        confirmLabel={order.status === 'requested' ? 'Cancel Request' : 'Cancel Order'}
        destructive
        onCancel={() => setConfirmCancel(false)}
        onConfirm={() => {
          setConfirmCancel(false);
          setStatus('cancelled');
        }}
      />
      </div>
    </>
  );
}

/**
 * What Print gives, laid out as the shop's Tally bills: the order's posted tax invoice, else its estimate (the draft
 * invoice's figures when there is one, as the Owner left them). Only Owners read GST invoices and settings; for others
 * the estimate comes from the order and Stock, with the shop's general details.
 */
function OrderBill({ order }: { order: Order }) {
  const { db } = useData();
  // The Owner and the Accountant read GST invoices and settings.
  const owner = handlesMoney(readSession()?.role);
  const [gst, setGst] = useState<{ settings: GstSettings; invoices: SalesInvoice[] } | null>(null);
  useEffect(() => {
    if (!owner) return;
    let active = true;
    Promise.all([api<GstSettings>('/gst/settings'), api<SalesInvoice[]>(`/gst/invoices?orderId=${encodeURIComponent(order.id)}`)]).then(
      ([settings, invoices]) => active && setGst({ settings, invoices }),
      // Without them it still prints, as an estimate.
      () => {},
    );
    return () => {
      active = false;
    };
  }, [owner, order.id]);
  const current = gst?.invoices.find((invoice) => invoice.status !== 'cancelled');
  return (
    <div className="print-only-block">
      <InvoiceDocument invoice={current ?? estimateOf(order, db.stock)} settings={gst?.settings ?? null} company={db.settings} estimate={current?.status !== 'posted'} />
    </div>
  );
}

/** On an open order: the customer already owes more than the credit limit the Owner or the Accountant set for them. */
function CreditWarning({ order }: { order: Order }) {
  const { db } = useData();
  const id = order.customerRecord?.id;
  const open = isOpen(order.status);
  const [limit, setLimit] = useState<{ id: number; value: number | null } | null>(null);
  useEffect(() => {
    if (!id || !open) return;
    let active = true;
    // Staff who can't see customers (the inventory team) just don't get the warning.
    api<CustomerRecord>(`/customers/${id}`).then(
      (customer) => active && setLimit({ id, value: customer.creditLimit ?? null }),
      () => {},
    );
    return () => {
      active = false;
    };
  }, [id, open]);
  if (!open || !id || limit?.id !== id || limit.value === null) return null;
  const owed = accounts(db.orders.filter((one) => one.customerRecord?.id === id), creditDaysOf(db.settings))[0]?.remaining ?? 0;
  if (owed <= limit.value) return null;
  return (
    <p className="notice notice--danger" role="status" style={{ marginBottom: 'var(--space-4)' }}>
      <WarningCircleIcon size={16} weight="bold" aria-hidden />
      <span>
        {order.customer} owes {formatINR(owed)}, over their credit limit of {formatINR(limit.value)}. <Link to={`/customers/${id}`}>See their payments</Link> before sending more on credit.
      </span>
    </p>
  );
}

const ADDRESS_TYPE: Record<OrderDelivery['addressType'], { label: string; tone: 'info' | 'warning' | 'neutral' }> = {
  saved: { label: 'Saved address', tone: 'neutral' },
  temporary: { label: 'This order only', tone: 'warning' },
  site: { label: 'Site', tone: 'info' },
};

/** Where the order goes, as the customer chose at checkout: copied then, so later profile changes don't move it. */
function DeliveryCard({ delivery }: { delivery: OrderDelivery }) {
  const type = ADDRESS_TYPE[delivery.addressType] ?? ADDRESS_TYPE.temporary;
  return (
    <Card aria-labelledby="delivery-title">
      <CardHeader id="delivery-title" title="Delivery" description="As chosen at checkout." action={<Badge tone={type.tone}>{type.label}</Badge>} />
      <div className="card__body stack">
        <div>
          <span style={{ display: 'block', fontWeight: 600 }}>{delivery.receiverName || 'Receiver not given'}</span>
          {delivery.siteName && <span className="cell-sub" style={{ display: 'block' }}>Site: {delivery.siteName}</span>}
          <span style={{ display: 'block', marginTop: 4 }}>{delivery.line}</span>
        </div>
        <dl className="kv kv--compact">
          <dt>Contact</dt>
          <dd className="num">{delivery.contact ? <a href={`tel:${delivery.contact}`}>{delivery.contact}</a> : '—'}</dd>
          {delivery.alternateContact && (
            <>
              <dt>Alternate</dt>
              <dd className="num">
                <a href={`tel:${delivery.alternateContact}`}>{delivery.alternateContact}</a>
              </dd>
            </>
          )}
          {delivery.instructions && (
            <>
              <dt>Instructions</dt>
              <dd>{delivery.instructions}</dd>
            </>
          )}
        </dl>
        {delivery.contact && (
          <div className="row-wrap no-print">
            <a className="btn btn--secondary btn--sm" href={`tel:${delivery.contact}`}>
              <PhoneIcon size={15} weight="bold" aria-hidden /> Call Receiver
            </a>
          </div>
        )}
      </div>
    </Card>
  );
}
