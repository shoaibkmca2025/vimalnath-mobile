import { useState } from 'react';

import { Button } from '@/components/Button';
import { Card, CardHeader } from '@/components/Card';
import { SelectField, TextAreaField, TextField } from '@/components/Field';
import { useToast } from '@/components/useToast';
import type { CustomerRecord } from '@/data/customers';
import { GSTIN, STATES, stateOfGstin } from '@/data/india';
import { api, type ApiError } from '@/lib/api';

type Draft = Pick<CustomerRecord, 'gstin' | 'legalName' | 'billingAddress' | 'state' | 'pincode'>;
const draftOf = (customer: CustomerRecord): Draft => ({ gstin: customer.gstin ?? '', legalName: customer.legalName ?? '', billingAddress: customer.billingAddress ?? '', state: customer.state ?? '', pincode: customer.pincode ?? '' });

/** What a tax invoice prints about the buyer. A GSTIN makes their invoices B2B; the state decides CGST + SGST or IGST. */
export function CustomerGstCard({ customer, onSaved }: { customer: CustomerRecord; onSaved: (customer: CustomerRecord) => void }) {
  const toast = useToast();
  const [draft, setDraft] = useState<Draft>(() => draftOf(customer));
  const [failure, setFailure] = useState<ApiError | null>(null);
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(draftOf(customer));
  const gstin = draft.gstin.trim().toUpperCase();
  const gstinError = failure?.field === 'gstin' ? failure.message : gstin && !GSTIN.test(gstin) ? 'Enter the 15-character GSTIN, e.g. 27AAPFU0939F1ZV.' : null;

  const save = async () => {
    if (gstinError) return;
    setSaving(true);
    setFailure(null);
    try {
      const saved = await api<CustomerRecord>(`/customers/${customer.id}`, 'PATCH', { ...draft, gstin });
      onSaved(saved);
      setDraft(draftOf(saved));
      toast({ message: 'GST details saved. New invoices use them.' });
    } catch (problem) {
      setFailure(problem as ApiError);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card aria-labelledby="customer-gst-title">
      <CardHeader id="customer-gst-title" title="GST details" description="Printed on their tax invoices. Leave the GSTIN empty for an unregistered buyer." />
      <div className="card__body stack">
        <TextField
          label="GSTIN"
          value={draft.gstin}
          onChange={(event) => {
            const value = event.target.value.toUpperCase();
            const state = value.length >= 2 ? stateOfGstin(value) : undefined;
            setDraft((current) => ({ ...current, gstin: value, state: state ?? current.state }));
          }}
          error={gstinError}
          maxLength={15}
          spellCheck={false}
          hint="Its first two digits fill in the state."
        />
        <TextField label="Legal name" value={draft.legalName} onChange={(event) => setDraft({ ...draft, legalName: event.target.value })} maxLength={150} hint="As registered, if it differs from the name above." />
        <TextAreaField label="Billing address" value={draft.billingAddress} onChange={(event) => setDraft({ ...draft, billingAddress: event.target.value })} rows={2} maxLength={500} />
        <SelectField label="State" value={draft.state} onChange={(event) => setDraft({ ...draft, state: event.target.value })} options={[{ value: '', label: 'Choose…' }, ...STATES.map((state) => ({ value: state, label: state }))]} />
        <TextField label="PIN code" value={draft.pincode} onChange={(event) => setDraft({ ...draft, pincode: event.target.value })} error={failure?.field === 'pincode' ? failure.message : null} inputMode="numeric" maxLength={6} />
        {failure && !failure.field && (
          <p className="notice notice--warning" role="alert">
            {failure.message}
          </p>
        )}
        {dirty && (
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <Button onClick={() => setDraft(draftOf(customer))}>Discard</Button>
            <Button variant="primary" loading={saving} onClick={save}>
              Save
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
