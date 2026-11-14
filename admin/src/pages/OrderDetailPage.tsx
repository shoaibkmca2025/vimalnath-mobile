import {
  BookOpenIcon,
  CaretLeftIcon,
  CaretRightIcon,
  ChatCircleTextIcon,
  CheckIcon,
  NoteIcon,
  PhoneIcon,
  PrinterIcon,
  ReceiptIcon,
  TruckIcon,
  WarningCircleIcon,
  XCircleIcon,
} from '@phosphor-icons/react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

import { Badge, OrderStatusBadge } from '@/components/Badge';
import { Button, ButtonLink, IconButton } from '@/components/Button';
import { Card, CardHeader } from '@/components/Card';
import { ConfirmDialog } from '@/components/Dialog';
import { EmptyState } from '@/components/EmptyState';
import { SelectField, TextAreaField } from '@/components/Field';
import { PageHeader } from '@/components/PageHeader';
import { Thumb } from '@/components/Thumb';
import { useToast } from '@/components/useToast';
import { NEXT_ACTION_LABEL, ORDER_STATUS, STATUS_ORDER, customerKey, customersFromOrders, itemCount, nextStatus, whatsappLink } from '@/data/orders';
import { readSession } from '@/data/session';
import { useData } from '@/data/useData';
import type { Order, OrderStatus } from '@/data/types';
import { formatDate, formatDateTime, formatINR, formatNumber, initials, plural } from '@/lib/format';

const STEPS: OrderStatus[] = ['placed', 'confirmed', 'dispatched', 'delivered'];
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
  const [noteSource, setNoteSource] = useState(order);
  if (noteSource !== order) {
    setNoteSource(order);
    if (order?.id !== noteSource?.id) setNoteDraft(order?.internalNote?.text ?? '');
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

  const next = nextStatus(order.status);
  const items = itemCount(order);
  const priced = order.lines.filter((line) => line.mrp !== undefined);
  const unpriced = order.lines.length - priced.length;
  const products = new Map(db.products.map((product) => [product.id, product]));
  const customer = customersFromOrders(db.orders.filter((item) => customerKey(item.customer) === customerKey(order.customer)))[0]!;
  const newer = db.orders[index - 1];
  const older = db.orders[index + 1];
  const reached = (status: OrderStatus) => order.history.findLast((event) => event.status === status);

  return (
    <>
      <PageHeader
        title={`Order ${order.number}`}
        crumbs={[{ label: 'Orders', to: '/orders' }]}
        description={
          <>
            {order.customer} · {plural(items, 'item')} · placed in the app {formatDateTime(order.createdAt)}
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
            {next && (
              <Button variant="primary" icon={next === 'confirmed' ? CheckIcon : next === 'dispatched' ? TruckIcon : undefined} onClick={() => setStatus(next)} className="no-print">
                {NEXT_ACTION_LABEL[next]}
              </Button>
            )}
          </>
        }
      />

      <PrintHeader order={order} company={db.settings} />

      <Card aria-label="Progress" className="no-print" style={{ marginBottom: 'var(--space-4)' }}>
        {order.status === 'cancelled' ? (
          <div className="card__body row" style={{ gap: 'var(--space-3)' }}>
            <XCircleIcon size={22} color="var(--danger)" aria-hidden />
            <span>
              <strong>Cancelled</strong>
              <span className="muted">
                {' '}
                · {reached('cancelled') ? `${formatDateTime(reached('cancelled')!.at)} by ${reached('cancelled')!.by}` : ''}
              </span>
            </span>
          </div>
        ) : (
          <ol className="stepper">
            {STEPS.map((step) => {
              const event = reached(step);
              const state = step === order.status ? 'current' : STEPS.indexOf(step) < STEPS.indexOf(order.status) ? 'done' : 'todo';
              return (
                <li key={step} className="stepper__step" data-state={state} aria-current={state === 'current' ? 'step' : undefined}>
                  <span className="stepper__dot" aria-hidden>
                    {state !== 'todo' && <CheckIcon size={12} weight="bold" />}
                  </span>
                  <span className="stepper__label">{ORDER_STATUS[step].label === 'New' ? 'Placed' : ORDER_STATUS[step].label}</span>
                  <span className="stepper__meta">{event && state !== 'todo' ? `${formatDateTime(event.at)} · ${event.by === 'App' ? 'in the app' : event.by}` : 'Not yet'}</span>
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

          <Card aria-labelledby="notes-title">
            <CardHeader id="notes-title" title="Customer’s notes" description="Typed in the app when the order was placed." />
            <p className="card__body" style={{ display: 'flex', gap: 8 }}>
              <NoteIcon size={18} color="var(--text-2)" aria-hidden style={{ flexShrink: 0, marginTop: 2 }} />
              {order.notes ?? <span className="muted">No delivery notes.</span>}
            </p>
          </Card>

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
        </div>

        <div className="stack editor__aside">
          <Card aria-labelledby="status-title" className="no-print">
            <CardHeader id="status-title" title="Status" action={<OrderStatusBadge status={order.status} />} />
            <div className="card__body stack">
              <p className="muted">{ORDER_STATUS[order.status].description}.</p>
              <SelectField
                label="Change status"
                value={order.status}
                onChange={(event) => setStatus(event.target.value as OrderStatus)}
                options={STATUS_ORDER.map((value) => ({ value, label: ORDER_STATUS[value].label }))}
                hint="The customer sees the new status in their app after its next sync."
              />
            </div>
            <ol className="timeline" aria-label="Status history">
              {[...order.history].reverse().map((step) => (
                <li key={`${step.status}-${step.at}`} className="timeline__item">
                  <span className="timeline__dot" data-tone={ORDER_STATUS[step.status].tone} aria-hidden />
                  <span>
                    <span style={{ fontWeight: 600 }}>{step.status === 'placed' ? 'Placed in the app' : ORDER_STATUS[step.status].label}</span>
                    <span className="cell-sub" style={{ display: 'block' }}>
                      {formatDateTime(step.at)} · {step.by === 'App' ? order.customer : step.by}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          </Card>

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
                  {initials(order.customer)}
                </span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontWeight: 600 }}>{order.customer}</span>
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
                <dt>Orders</dt>
                <dd className="num">{formatNumber(customer.orders)}</dd>
                <dt>Ordered (MRP)</dt>
                <dd className="num">{formatINR(customer.spent)}</dd>
                <dt>Customer since</dt>
                <dd>{formatDate(customer.firstOrder)}</dd>
              </dl>
            </div>
          </Card>

          {order.status !== 'cancelled' && order.status !== 'delivered' && (
            <Button variant="danger-plain" icon={XCircleIcon} onClick={() => setConfirmCancel(true)} className="no-print">
              Cancel Order
            </Button>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmCancel}
        title={`Cancel order ${order.number}?`}
        body={`The order from ${order.customer} will be marked cancelled. You can change the status back later if this was a mistake.`}
        confirmLabel="Cancel Order"
        destructive
        onCancel={() => setConfirmCancel(false)}
        onConfirm={() => {
          setConfirmCancel(false);
          setStatus('cancelled');
        }}
      />
    </>
  );
}

/** Only printed: who the order sheet is from and for, like the order PDF the app shares. */
function PrintHeader({ order, company }: { order: Order; company: { companyName: string; address: string; phone: string; email: string; logo: string } }) {
  return (
    <div className="print-only print-header">
      <div className="row" style={{ gap: 12 }}>
        <img src={company.logo} alt="" width={40} height={40} />
        <div>
          <strong>{company.companyName}</strong>
          <div>{[company.address, company.phone, company.email].filter(Boolean).join(' · ')}</div>
        </div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <strong>Order {order.number}</strong>
        <div>
          {formatDateTime(order.createdAt)} · {ORDER_STATUS[order.status].label}
        </div>
      </div>
    </div>
  );
}
