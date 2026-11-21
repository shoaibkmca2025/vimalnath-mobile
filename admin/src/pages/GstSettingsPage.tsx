import { useEffect, useState } from 'react';

import { Button } from '@/components/Button';
import { Card, CardHeader } from '@/components/Card';
import { Segmented, TextAreaField, TextField } from '@/components/Field';
import { PageHeader } from '@/components/PageHeader';
import { useToast } from '@/components/useToast';
import { financialYear } from '@/data/gst';
import { GSTIN, stateOfGstin } from '@/data/india';
import { localDay } from '@/data/payments';
import type { GstSettings } from '@/data/types';
import { api, type ApiError } from '@/lib/api';
import { formatDateTime } from '@/lib/format';

const EMPTY: GstSettings = { legalName: '', tradeName: '', gstin: '', address: '', pincode: '', registrationType: 'regular', invoicePrefix: 'VSC', terms: '' };

/** The shop's GST registration, printed on every tax invoice, and how invoices are numbered. */
export default function GstSettingsPage() {
  const toast = useToast();
  const [saved, setSaved] = useState<GstSettings | null>(null);
  const [draft, setDraft] = useState<GstSettings>(EMPTY);
  const [failure, setFailure] = useState<ApiError | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    api<GstSettings>('/gst/settings').then(
      (loaded) => {
        if (!active) return;
        setSaved(loaded);
        setDraft(loaded);
      },
      () => {},
    );
    return () => {
      active = false;
    };
  }, []);

  const gstin = draft.gstin.trim().toUpperCase();
  const state = GSTIN.test(gstin) ? stateOfGstin(gstin) : undefined;
  const dirty = saved !== null && JSON.stringify(draft) !== JSON.stringify(saved);
  const set = <K extends keyof GstSettings>(key: K, value: GstSettings[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const fieldError = (field: string) => (failure?.field === field ? failure.message : null);
  const year = financialYear(localDay()).label;

  const save = async () => {
    setSaving(true);
    setFailure(null);
    try {
      const next = await api<GstSettings>('/gst/settings', 'PUT', { ...draft, gstin, invoicePrefix: draft.invoicePrefix.trim().toUpperCase() });
      await api('/activity', 'POST', { area: 'settings', summary: 'Updated the GST settings', to: '/gst/settings' }).catch(() => null);
      setSaved(next);
      setDraft(next);
      toast({ message: 'GST settings saved.' });
    } catch (problem) {
      setFailure(problem as ApiError);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <PageHeader
        title="GST Settings"
        description={saved?.updatedAt ? `Printed on every tax invoice. Last changed ${formatDateTime(saved.updatedAt)} by ${saved.updatedBy}.` : 'Printed on every tax invoice. Fill these in before posting the first one.'}
      />
      <div className="stack-lg" style={{ maxWidth: 820 }}>
        <Card aria-labelledby="registration-title">
          <CardHeader id="registration-title" title="Registration" description="As on the GST registration certificate." />
          <div className="card__body form-grid">
            <TextField className="span-2" label="Legal name" required value={draft.legalName} onChange={(event) => set('legalName', event.target.value)} error={fieldError('legalName')} maxLength={150} />
            <TextField label="Trade name" value={draft.tradeName} onChange={(event) => set('tradeName', event.target.value)} maxLength={150} />
            <TextField
              label="GSTIN"
              required
              value={draft.gstin}
              onChange={(event) => set('gstin', event.target.value.toUpperCase())}
              error={fieldError('gstin') ?? (gstin && !GSTIN.test(gstin) ? 'Enter the 15-character GSTIN, e.g. 27AAPFU0939F1ZV.' : null)}
              maxLength={15}
              spellCheck={false}
              hint={state ? `State: ${state} (${gstin.slice(0, 2)}) · PAN ${gstin.slice(2, 12)}` : 'Its first two digits are the shop’s state.'}
            />
            <TextAreaField className="span-2" label="Principal place of business" required value={draft.address} onChange={(event) => set('address', event.target.value)} error={fieldError('address')} rows={2} maxLength={500} />
            <TextField label="PIN code" value={draft.pincode} onChange={(event) => set('pincode', event.target.value)} error={fieldError('pincode')} inputMode="numeric" maxLength={6} />
            <div className="field">
              <span className="field__label">Registration type</span>
              <Segmented<GstSettings['registrationType']>
                label="Registration type"
                value={draft.registrationType}
                onChange={(type) => set('registrationType', type)}
                options={[
                  { value: 'regular', label: 'Regular' },
                  { value: 'composition', label: 'Composition' },
                ]}
              />
              <p className="field__hint">{draft.registrationType === 'composition' ? 'Composition dealers issue bills of supply and claim no input tax credit: tax invoices can’t be posted.' : 'Charges GST on invoices and claims input tax credit. Ask your accountant if unsure.'}</p>
            </div>
          </div>
        </Card>

        <Card aria-labelledby="numbering-title">
          <CardHeader id="numbering-title" title="Invoices" />
          <div className="card__body form-grid">
            <TextField
              label="Invoice prefix"
              value={draft.invoicePrefix}
              onChange={(event) => set('invoicePrefix', event.target.value.toUpperCase())}
              error={fieldError('invoicePrefix')}
              maxLength={6}
              hint={`Numbers look like ${draft.invoicePrefix ? `${draft.invoicePrefix.toUpperCase()}/` : ''}${year}/0001, starting again each financial year (1 April).`}
            />
            <TextAreaField className="span-2" label="Terms printed on invoices" value={draft.terms} onChange={(event) => set('terms', event.target.value)} rows={3} maxLength={1000} placeholder="e.g. Goods once sold will not be taken back. Subject to Pune jurisdiction." />
          </div>
        </Card>

        {failure && !failure.field && (
          <p className="notice notice--warning" role="alert">
            {failure.message}
          </p>
        )}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          {dirty && <Button onClick={() => saved && setDraft(saved)}>Discard</Button>}
          <Button type="submit" variant="primary" disabled={!dirty} loading={saving}>
            Save
          </Button>
        </div>
      </div>
    </form>
  );
}
