import { CurrencyInrIcon, TrashIcon, WarningCircleIcon } from '@phosphor-icons/react';
import { useState } from 'react';

import { Badge } from '@/components/Badge';
import { Button, IconButton } from '@/components/Button';
import { Card, CardHeader } from '@/components/Card';
import { ConfirmDialog } from '@/components/Dialog';
import { Segmented, TextField } from '@/components/Field';
import { PaymentDrawer } from '@/components/PaymentDrawer';
import { useToast } from '@/components/useToast';
import { ORDER_STATUS, customerOf } from '@/data/orders';
import { PAYMENT_METHODS, PAYMENT_TERMS, billOf, billStatus, creditDaysOf, dayLabel, isBilled, stateLabel, termsOf } from '@/data/payments';
import type { Order, Payment, PaymentTerms } from '@/data/types';
import { useData } from '@/data/useData';
import { formatINR, plural } from '@/lib/format';

/** An order's bill: cash or credit, the amount owed, what's been paid and when the rest is due. Owners and Sales only. */
export function OrderPaymentCard({ order }: { order: Order }) {
  const { db, send } = useData();
  const toast = useToast();
  const [paying, setPaying] = useState(false);
  const [removing, setRemoving] = useState<Payment | null>(null);
  const [touched, setTouched] = useState(false);
  const [billDraft, setBillDraft] = useState(String(billOf(order)));
  // Another order, or the bill saved from elsewhere: the field shows the new bill.
  const [source, setSource] = useState(`${order.id}:${billOf(order)}`);
  if (source !== `${order.id}:${billOf(order)}`) {
    setSource(`${order.id}:${billOf(order)}`);
    setBillDraft(String(billOf(order)));
    setTouched(false);
  }

  const creditDays = creditDaysOf(db.settings);
  const status = billStatus(order, creditDays);
  const state = stateLabel(status);
  const terms = termsOf(order);
  const billed = isBilled(order);
  const customer = customerOf(order).name;
  const payments = [...(order.payments ?? [])].reverse();
  const unpriced = order.lines.some((line) => line.mrp === undefined);
  const to = `/orders/${order.id}`;

  const bill = /^\s*[\d,]+\s*$/.test(billDraft) ? Number(billDraft.replace(/[^\d]/g, '')) : NaN;
  const billError = !Number.isInteger(bill) || bill < 0 ? 'Enter the bill in whole rupees, e.g. 25000.' : bill < status.paid ? `${formatINR(status.paid)} has been paid already, so the bill can’t be less.` : null;
  const billDirty = billDraft.trim() !== String(billOf(order));

  const setTerms = (next: PaymentTerms) =>
    next !== terms &&
    send(`/orders/${order.id}/billing`, 'PUT', { terms: next, bill: order.bill ?? null }, { area: 'orders', summary: `Set ${order.number} to ${PAYMENT_TERMS[next].toLowerCase()} payment`, to });

  const saveBill = async () => {
    setTouched(true);
    if (billError) return;
    const ok = await send(`/orders/${order.id}/billing`, 'PUT', { terms, bill }, { area: 'orders', summary: `Changed the bill for ${order.number} to ${formatINR(bill)}`, to });
    if (ok) toast({ message: `Bill for ${order.number} saved.` });
  };

  const remove = async (payment: Payment) => {
    setRemoving(null);
    const ok = await send(`/orders/payments/${payment.id}`, 'DELETE', undefined, {
      area: 'orders',
      summary: `Removed a ${formatINR(payment.amount)} payment (${PAYMENT_METHODS[payment.method]}, ${dayLabel(payment.paidOn)}) from ${order.number}`,
      to,
    });
    if (ok) toast({ message: 'Payment removed.' });
  };

  const due = status.due ? dayLabel(status.due) : terms === 'cash' ? 'On delivery' : `${plural(creditDays, 'day')} after delivery`;

  return (
    <Card aria-labelledby="payment-title" className="no-print">
      <CardHeader id="payment-title" title="Payment" action={billed && <Badge tone={state.tone}>{state.label}</Badge>} />
      <div className="card__body stack">
        {billed ? (
          <>
            <div className="field">
              <span className="field__label">Terms</span>
              <Segmented<PaymentTerms>
                label="Payment terms"
                value={terms}
                onChange={setTerms}
                options={[
                  { value: 'credit', label: 'Credit' },
                  { value: 'cash', label: 'Cash' },
                ]}
              />
              <p className="field__hint">{terms === 'cash' ? 'Due on delivery.' : `Due ${plural(creditDays, 'day')} after delivery.`}</p>
            </div>
            <TextField
              label="Bill amount"
              prefix="₹"
              inputMode="numeric"
              autoComplete="off"
              value={billDraft}
              onChange={(event) => setBillDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  if (billDirty) void saveBill();
                }
              }}
              error={touched ? billError : null}
              hint={`MRP total ${formatINR(order.total)}. Change it for a discount${unpriced ? ' or for items priced from the catalogue' : ''}.`}
            />
            {billDirty && (
              <div className="row" style={{ justifyContent: 'flex-end' }}>
                <Button
                  size="sm"
                  onClick={() => {
                    setBillDraft(String(billOf(order)));
                    setTouched(false);
                  }}
                >
                  Discard
                </Button>
                <Button size="sm" variant="primary" onClick={saveBill}>
                  Save Bill
                </Button>
              </div>
            )}
            <dl className="kv kv--compact kv--split">
              <dt>Bill</dt>
              <dd className="num">{formatINR(status.bill)}</dd>
              <dt>Paid</dt>
              <dd className="num">{formatINR(status.paid)}</dd>
              <dt>Remaining</dt>
              <dd className={status.state === 'overdue' ? 'num money-late' : 'num'} style={{ fontWeight: 600 }}>
                {formatINR(status.remaining)}
              </dd>
              <dt>Due</dt>
              <dd className={status.state === 'overdue' ? 'money-late' : undefined}>{due}</dd>
            </dl>
            <Button variant="primary" icon={CurrencyInrIcon} disabled={status.remaining === 0} onClick={() => setPaying(true)}>
              Record Payment
            </Button>
          </>
        ) : (
          <p className="muted">{order.status === 'requested' ? 'It’s billed once the customer confirms it.' : `${ORDER_STATUS[order.status].label} orders aren’t billed.`}</p>
        )}
        {!billed && status.paid > 0 && (
          <p className="notice notice--danger" role="status">
            <WarningCircleIcon size={16} weight="bold" aria-hidden />
            <span>{formatINR(status.paid)} was paid on this order. Give it back, then remove the payment below.</span>
          </p>
        )}
      </div>
      {payments.length > 0 && (
        <ul className="list" aria-label="Payments">
          {payments.map((payment) => (
            <li key={payment.id} className="list-row">
              <span className="list-row__main">
                <span className="list-row__title num" style={{ display: 'block' }}>
                  {formatINR(payment.amount)} · {PAYMENT_METHODS[payment.method]}
                </span>
                <span className="list-row__meta">
                  {dayLabel(payment.paidOn)} · {payment.by}
                  {payment.note && ` · ${payment.note}`}
                </span>
              </span>
              <IconButton icon={TrashIcon} tone="danger" label={`Remove the ${formatINR(payment.amount)} payment`} onClick={() => setRemoving(payment)} />
            </li>
          ))}
        </ul>
      )}

      <PaymentDrawer open={paying} onClose={() => setPaying(false)} customer={customer} orders={[order]} logTo={to} />
      <ConfirmDialog
        open={Boolean(removing)}
        title={removing ? `Remove the ${formatINR(removing.amount)} payment?` : 'Remove payment?'}
        body={removing ? `${PAYMENT_METHODS[removing.method]} on ${dayLabel(removing.paidOn)}, recorded by ${removing.by}. ${order.number} will owe it again. Only do this if it was entered by mistake.` : ''}
        confirmLabel="Remove Payment"
        destructive
        onCancel={() => setRemoving(null)}
        onConfirm={() => removing && remove(removing)}
      />
    </Card>
  );
}
