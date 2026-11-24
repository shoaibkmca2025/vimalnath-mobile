import { useState } from 'react';

import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/Dialog';
import { Drawer } from '@/components/Drawer';
import { Switch, TextAreaField, TextField } from '@/components/Field';
import { useToast } from '@/components/useToast';
import { GSTIN, STATES, stateOfGstin } from '@/data/india';
import { parseMoney } from '@/data/purchases';
import type { Supplier } from '@/data/types';
import { useData } from '@/data/useData';

type Draft = Record<'name' | 'company' | 'contactPerson' | 'phone' | 'email' | 'gstin' | 'address' | 'state' | 'openingBalance' | 'paymentDays' | 'bankDetails' | 'notes', string> & { archived: boolean };

const draftOf = (supplier: Supplier | null): Draft => ({
  name: supplier?.name ?? '',
  company: supplier?.company ?? '',
  contactPerson: supplier?.contactPerson ?? '',
  phone: supplier?.phone ?? '',
  email: supplier?.email ?? '',
  gstin: supplier?.gstin ?? '',
  address: supplier?.address ?? '',
  state: supplier?.state ?? '',
  openingBalance: supplier?.openingBalance ? String(supplier.openingBalance) : '',
  paymentDays: supplier?.paymentDays === null || supplier?.paymentDays === undefined ? '' : String(supplier.paymentDays),
  bankDetails: supplier?.bankDetails ?? '',
  notes: supplier?.notes ?? '',
  archived: supplier?.archived ?? false,
});

function errorsOf(draft: Draft) {
  const opening = parseMoney(draft.openingBalance);
  const gstin = draft.gstin.trim().toUpperCase();
  return {
    name: draft.name.trim() ? null : 'Enter the supplier’s name.',
    phone: draft.phone.trim() && draft.phone.replace(/\D/g, '').length < 10 ? 'Enter a 10-digit number, with the area code for landlines.' : null,
    email: draft.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email.trim()) ? 'Enter an email address like sales@supplier.com.' : null,
    gstin: gstin && !GSTIN.test(gstin) ? 'Enter the 15-character GSTIN, e.g. 27AAPFU0939F1ZV.' : null,
    openingBalance: Number.isNaN(opening) || opening < 0 ? 'Enter rupees and paise, e.g. 12500.' : null,
    paymentDays: draft.paymentDays.trim() && !(/^\d{1,3}$/.test(draft.paymentDays.trim()) && Number(draft.paymentDays) <= 365) ? 'Enter whole days, 0 to 365.' : null,
  };
}

/** Adds a supplier, or edits one: contact, GST details, opening balance and payment terms. */
export function SupplierDrawer({ open, supplier, onClose, onSaved, onDeleted }: { open: boolean; supplier: Supplier | null; onClose: () => void; onSaved: (supplier: Supplier) => void; onDeleted?: () => void }) {
  const { send } = useData();
  const toast = useToast();
  const [draft, setDraft] = useState<Draft>(() => draftOf(supplier));
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [source, setSource] = useState<string | null>(null);
  const sourceKey = open ? `${supplier?.id ?? 'new'}` : null;
  if (sourceKey !== source) {
    setSource(sourceKey);
    if (sourceKey) {
      setDraft(draftOf(supplier));
      setTouched(false);
    }
  }

  const errors = errorsOf(draft);
  const firstError = Object.entries(errors).find(([, message]) => message);
  const shown = (field: keyof typeof errors) => (touched ? errors[field] : null);
  const set = <K extends keyof Draft>(field: K, value: Draft[K]) => setDraft((current) => ({ ...current, [field]: value }));
  const dirty = JSON.stringify(draft) !== JSON.stringify(draftOf(supplier));

  const save = async () => {
    setTouched(true);
    if (firstError) {
      document.getElementById(`supplier-${firstError[0]}`)?.focus();
      return;
    }
    setSaving(true);
    const body = {
      name: draft.name.trim(),
      company: draft.company.trim(),
      contactPerson: draft.contactPerson.trim(),
      phone: draft.phone.trim(),
      email: draft.email.trim(),
      gstin: draft.gstin.trim().toUpperCase(),
      address: draft.address.trim(),
      state: draft.state.trim(),
      openingBalance: parseMoney(draft.openingBalance),
      paymentDays: draft.paymentDays.trim() ? Number(draft.paymentDays) : null,
      bankDetails: draft.bankDetails.trim(),
      notes: draft.notes.trim(),
      archived: draft.archived,
    };
    const saved = await send(supplier ? `/suppliers/${supplier.id}` : '/suppliers', supplier ? 'PUT' : 'POST', body, {
      area: 'purchases',
      summary: supplier ? `Edited the supplier ${body.name}${body.archived && !supplier.archived ? ' (archived)' : ''}` : `Added the supplier ${body.name}`,
      to: '/suppliers',
    });
    setSaving(false);
    if (!saved) return;
    toast({ message: supplier ? `${body.name} saved.` : `${body.name} added.` });
    onSaved(saved as unknown as Supplier);
  };

  const remove = async () => {
    setDeleting(false);
    if (!supplier) return;
    if (await send(`/suppliers/${supplier.id}`, 'DELETE', undefined, { area: 'purchases', summary: `Deleted the supplier ${supplier.name}`, to: '/suppliers' })) {
      toast({ message: `${supplier.name} deleted.` });
      onDeleted?.();
    }
  };

  const field = (name: keyof Draft & keyof typeof errors, label: string, extra: Partial<Parameters<typeof TextField>[0]> = {}) => (
    <TextField id={`supplier-${name}`} label={label} value={draft[name] as string} onChange={(event) => set(name, event.target.value)} error={shown(name)} autoComplete="off" {...extra} />
  );
  const used = Boolean(supplier && (supplier.bills || supplier.drafts || supplier.paid));

  return (
    <Drawer
      open={open}
      title={supplier ? `Edit ${supplier.name}` : 'Add Supplier'}
      description={supplier ? undefined : 'Someone the shop buys from.'}
      dirty={dirty}
      onClose={onClose}
      onSubmit={save}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={saving}>
            {supplier ? 'Save' : 'Add Supplier'}
          </Button>
        </>
      }
    >
      <div className="stack-lg">
        <div className="form-grid">
          {field('name', 'Name', { required: true, className: 'span-2', placeholder: 'e.g. Ganesh Glass Traders', maxLength: 100 })}
          <TextField label="Company" value={draft.company} onChange={(event) => set('company', event.target.value)} maxLength={150} autoComplete="off" />
          <TextField label="Contact person" value={draft.contactPerson} onChange={(event) => set('contactPerson', event.target.value)} maxLength={100} autoComplete="off" />
          {field('phone', 'Phone', { inputMode: 'tel', maxLength: 30 })}
          {field('email', 'Email', { type: 'email', maxLength: 120 })}
          {field('gstin', 'GSTIN', {
            maxLength: 15,
            spellCheck: false,
            style: { textTransform: 'uppercase' },
            onChange: (event) => {
              const gstin = event.target.value.toUpperCase();
              const state = gstin.length >= 2 ? stateOfGstin(gstin) : undefined;
              setDraft((current) => ({ ...current, gstin, state: state && !current.state ? state : current.state }));
            },
            hint: 'Its first two digits fill in the state.',
          })}
          <TextField label="State" value={draft.state} onChange={(event) => set('state', event.target.value)} list="supplier-states" maxLength={50} autoComplete="off" />
          <datalist id="supplier-states">
            {STATES.map((state) => (
              <option key={state} value={state} />
            ))}
          </datalist>
          <TextAreaField className="span-2" label="Address" value={draft.address} onChange={(event) => set('address', event.target.value)} rows={2} maxLength={500} />
        </div>
        <div className="form-grid">
          {field('openingBalance', 'Opening balance', { inputMode: 'decimal', prefix: '₹', hint: 'What the shop owed them before using this admin.' })}
          {field('paymentDays', 'Payment terms', { inputMode: 'numeric', suffix: 'days', hint: 'Days to pay a bill. Bills unpaid after this show as overdue.' })}
          <TextAreaField className="span-2" label="Bank details" value={draft.bankDetails} onChange={(event) => set('bankDetails', event.target.value)} rows={2} maxLength={500} placeholder="Bank, account number, IFSC, UPI ID" />
          <TextAreaField className="span-2" label="Notes" value={draft.notes} onChange={(event) => set('notes', event.target.value)} rows={2} maxLength={2000} />
        </div>
        {supplier && (
          <div className="stack">
            <Switch label="Archived" description="Archived suppliers keep their bills and payments, but aren’t offered for new bills." checked={draft.archived} onChange={(archived) => set('archived', archived)} />
            {!used && (
              <span>
                <Button size="sm" variant="danger-plain" onClick={() => setDeleting(true)}>
                  Delete Supplier
                </Button>
              </span>
            )}
          </div>
        )}
      </div>
      <ConfirmDialog
        open={deleting}
        title={`Delete ${supplier?.name ?? 'this supplier'}?`}
        body="They have no bills or payments, so nothing else is affected."
        confirmLabel="Delete"
        destructive
        onCancel={() => setDeleting(false)}
        onConfirm={remove}
      />
    </Drawer>
  );
}
