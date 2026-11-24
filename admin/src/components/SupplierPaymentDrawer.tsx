import { useState } from 'react';

import { Button } from '@/components/Button';
import { Drawer } from '@/components/Drawer';
import { Segmented, SelectField, TextField } from '@/components/Field';
import { useToast } from '@/components/useToast';
import { MONEY_METHODS, PAYMENT_METHODS, localDay } from '@/data/payments';
import { balanceOf, formatMoney, parseMoney } from '@/data/purchases';
import type { Answer } from '@/data/stock';
import type { PaymentMethod, Purchase, Supplier } from '@/data/types';
import { useData } from '@/data/useData';

type Props = {
  open: boolean;
  onClose: () => void;
  supplier: Supplier;
  /** The supplier's bills; those with something to pay are offered. */
  bills: Purchase[];
  /** The bill to pay, when opened from one. */
  billId?: string;
  onSaved: (answer: Answer) => void;
};

/** Records money paid to a supplier: against one of their bills, or on account. */
export function SupplierPaymentDrawer({ open, onClose, supplier, bills, billId, onSaved }: Props) {
  const { send } = useData();
  const toast = useToast();
  const unpaid = bills.filter((bill) => bill.status !== 'cancelled' && balanceOf(bill) > 0);
  const fresh = () => {
    const bill = unpaid.find((one) => one.id === billId) ?? unpaid[0];
    return { against: bill?.id ?? '', amount: bill ? String(balanceOf(bill)) : '', method: 'bank' as PaymentMethod, paidOn: localDay(), note: '' };
  };
  const [draft, setDraft] = useState(fresh);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setDraft(fresh());
      setTouched(false);
    }
  }

  const bill = unpaid.find((one) => one.id === draft.against);
  const amount = parseMoney(draft.amount, null);
  const today = localDay();
  const errors = {
    amount: Number.isNaN(amount) || amount <= 0 ? 'Enter the amount paid, e.g. 25000.' : bill && amount > balanceOf(bill) ? `That’s more than ${bill.number} still owes: ${formatMoney(balanceOf(bill))}.` : null,
    paidOn: !/^\d{4}-\d{2}-\d{2}$/.test(draft.paidOn) ? 'Pick the day it was paid.' : draft.paidOn > today ? 'The day can’t be in the future.' : null,
  };

  const save = async () => {
    setTouched(true);
    if (errors.amount || errors.paidOn) return;
    setSaving(true);
    const answer = await send(
      `/suppliers/${supplier.id}/payments`,
      'POST',
      { purchaseId: bill ? Number(bill.id) : null, amount, method: draft.method, paidOn: draft.paidOn, note: draft.note.trim() },
      { area: 'purchases', summary: `Paid ${supplier.name} ${formatMoney(amount)} (${PAYMENT_METHODS[draft.method]})${bill ? ` for ${bill.number}` : ' on account'}`, to: `/suppliers/${supplier.id}` },
    );
    setSaving(false);
    if (!answer) return;
    toast({ message: `${formatMoney(amount)} paid to ${supplier.name} recorded.` });
    onSaved(answer);
    onClose();
  };

  return (
    <Drawer
      open={open}
      title="Record Payment"
      description={`To ${supplier.name} · owes ${formatMoney(Math.max(0, supplier.outstanding))}`}
      dirty={draft.note.trim() !== ''}
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
        <SelectField
          label="Paying for"
          value={draft.against}
          onChange={(event) => {
            const next = unpaid.find((one) => one.id === event.target.value);
            setDraft({ ...draft, against: event.target.value, amount: next ? String(balanceOf(next)) : draft.amount });
          }}
          options={[
            ...unpaid.map((one) => ({ value: one.id, label: `${one.number}${one.supplierInvoice ? ` (${one.supplierInvoice})` : ''} · ${formatMoney(balanceOf(one))} to pay${one.status === 'draft' ? ' · not received yet' : ''}` })),
            { value: '', label: 'On account (an advance, or the opening balance)' },
          ]}
        />
        <TextField label="Amount" prefix="₹" inputMode="decimal" value={draft.amount} onChange={(event) => setDraft({ ...draft, amount: event.target.value })} error={touched ? errors.amount : null} required autoComplete="off" />
        <div className="field">
          <span className="field__label">Paid by</span>
          <Segmented<PaymentMethod>
            label="Paid by"
            value={draft.method}
            onChange={(method) => setDraft({ ...draft, method })}
            options={MONEY_METHODS.map((method) => ({ value: method, label: PAYMENT_METHODS[method] }))}
          />
        </div>
        <TextField label="Paid on" type="date" max={today} value={draft.paidOn} onChange={(event) => setDraft({ ...draft, paidOn: event.target.value })} error={touched ? errors.paidOn : null} required />
        <TextField label="Note" value={draft.note} onChange={(event) => setDraft({ ...draft, note: event.target.value })} maxLength={300} placeholder="e.g. Cheque 004512, or UTR 4471" autoComplete="off" />
      </div>
    </Drawer>
  );
}
