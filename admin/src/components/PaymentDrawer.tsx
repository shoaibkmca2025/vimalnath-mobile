import { useState } from 'react';

import { Button } from '@/components/Button';
import { Drawer } from '@/components/Drawer';
import { Segmented, TextField } from '@/components/Field';
import { useToast } from '@/components/useToast';
import { PAYMENT_METHODS, localDay, remainingOf, splitPayment } from '@/data/payments';
import type { Order, PaymentMethod } from '@/data/types';
import { useData } from '@/data/useData';
import { formatINR, plural } from '@/lib/format';

type Props = {
  open: boolean;
  onClose: () => void;
  /** Who paid, for the title and the activity log. */
  customer: string;
  /** Their bills with something left to pay, oldest first. The money clears the oldest first. */
  orders: Order[];
  /** Where the activity log entry links to. */
  logTo: string;
};

type Draft = { amount: string; method: PaymentMethod; paidOn: string; note: string };
const fresh = (): Draft => ({ amount: '', method: 'cash', paidOn: localDay(), note: '' });
/** "35,000", "₹35000" and " 35 000 " are all ₹35,000. */
const rupees = (text: string) => (/^\s*₹?[\d,\s]+\s*$/.test(text) && /\d/.test(text) ? Number(text.replace(/[^\d]/g, '')) : NaN);

/** Records money a customer paid: against one order, or spread over their unpaid bills, oldest first. */
export function PaymentDrawer({ open, onClose, customer, orders, logTo }: Props) {
  const { send } = useData();
  const toast = useToast();
  const [draft, setDraft] = useState<Draft>(fresh);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    // Each time it opens, it starts empty and dated today.
    if (open) {
      setDraft(fresh());
      setTouched(false);
    }
  }

  const owed = orders.reduce((sum, order) => sum + remainingOf(order), 0);
  const amount = rupees(draft.amount);
  const today = localDay();
  const errors = {
    amount: !draft.amount.trim()
      ? 'Enter the amount they paid.'
      : !Number.isInteger(amount) || amount <= 0
        ? 'Enter the amount in whole rupees, e.g. 25000.'
        : amount > owed
          ? `That’s more than they owe: ${formatINR(owed)}.`
          : null,
    paidOn: !/^\d{4}-\d{2}-\d{2}$/.test(draft.paidOn) ? 'Pick the day they paid.' : draft.paidOn > today ? 'The day can’t be in the future.' : null,
  };
  const valid = !errors.amount && !errors.paidOn;
  const split = valid ? splitPayment(orders, amount) : [];
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((current) => ({ ...current, [key]: value }));

  const save = async () => {
    setTouched(true);
    if (!valid) {
      document.getElementById(errors.amount ? 'payment-amount' : 'payment-day')?.focus();
      return;
    }
    setSaving(true);
    const note = draft.note.trim();
    const numbers = split.map((part) => part.order.number).join(', ');
    const ok = await send(
      '/orders/payments',
      'POST',
      { payments: split.map((part) => ({ orderId: Number(part.order.id), amount: part.amount, method: draft.method, paidOn: draft.paidOn, note })) },
      { area: 'orders', summary: `Recorded ${formatINR(amount)} (${PAYMENT_METHODS[draft.method]}) from ${customer} for ${numbers}`, to: logTo },
    );
    setSaving(false);
    if (!ok) return;
    toast({ message: `${formatINR(amount)} recorded for ${customer}.` });
    onClose();
  };

  const single = orders.length === 1 ? orders[0] : undefined;
  return (
    <Drawer
      open={open}
      title="Record Payment"
      description={single ? `${customer} · ${single.number}` : customer}
      dirty={Boolean(draft.amount.trim() || draft.note.trim())}
      onClose={onClose}
      onSubmit={save}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={saving}>
            Record Payment
          </Button>
        </>
      }
    >
      <div className="stack">
        <TextField
          id="payment-amount"
          label="Amount"
          prefix="₹"
          inputMode="numeric"
          autoComplete="off"
          value={draft.amount}
          onChange={(event) => set('amount', event.target.value)}
          onBlur={() => draft.amount && setTouched(true)}
          error={touched ? errors.amount : null}
          required
          hint={single ? `${single.number} still owes ${formatINR(owed)}.` : `They owe ${formatINR(owed)} on ${plural(orders.length, 'bill')}. It pays the oldest first.`}
        />
        <div>
          <Button size="sm" variant="plain" onClick={() => set('amount', String(owed))}>
            Paid in full: {formatINR(owed)}
          </Button>
        </div>
        <div className="field">
          <span className="field__label">Paid by</span>
          <Segmented<PaymentMethod>
            label="Paid by"
            value={draft.method}
            onChange={(method) => set('method', method)}
            options={(Object.keys(PAYMENT_METHODS) as PaymentMethod[]).map((method) => ({ value: method, label: PAYMENT_METHODS[method] }))}
          />
        </div>
        <TextField id="payment-day" label="Paid on" type="date" max={today} value={draft.paidOn} onChange={(event) => set('paidOn', event.target.value)} error={touched ? errors.paidOn : null} required />
        <TextField
          label="Note"
          value={draft.note}
          onChange={(event) => set('note', event.target.value)}
          maxLength={300}
          autoComplete="off"
          placeholder="e.g. Cheque 004512, or UPI ref 4471"
          hint="Only staff see it."
        />
        {split.length > 0 && !single && (
          <div>
            <p className="field__label" style={{ marginBottom: 6 }}>
              How it’s applied
            </p>
            <ul className="payment-split">
              {split.map((part) => (
                <li key={part.order.id}>
                  <span className="num">{part.order.number}</span>
                  <span className="num">
                    {formatINR(part.amount)}
                    <span className="muted">{part.clears ? ' · clears it' : ` of ${formatINR(remainingOf(part.order))}`}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Drawer>
  );
}
