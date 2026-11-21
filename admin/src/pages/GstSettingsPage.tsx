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
import { api, ApiError } from '@/lib/api';
import { formatDateTime } from '@/lib/format';

const EMPTY: GstSettings = {
  legalName: '',
  tradeName: '',
  gstin: '',
  address: '',
  pincode: '',
  registrationType: 'regular',
  invoicePrefix: 'VSC',
  terms: '',
  phone: '',
  email: '',
  bankName: '',
  bankAccount: '',
  bankBranchIfsc: '',
  declaration: '',
  jurisdiction: '',
};

/** What the form edits: the settings, with the last invoice number as typed. */
type Draft = Omit<GstSettings, 'lastInvoiceNumber' | 'financialYear' | 'updatedAt' | 'updatedBy'> & { lastInvoiceNumber: string };
const draftOf = (settings: GstSettings): Draft => {
  const { lastInvoiceNumber, financialYear: _year, updatedAt: _at, updatedBy: _by, ...rest } = settings;
  return { ...EMPTY, ...rest, lastInvoiceNumber: String(lastInvoiceNumber ?? 0) };
};

/** The shop's GST registration, printed on every tax invoice as in Tally, and where the invoice numbers carry on from. */
export default function GstSettingsPage() {
  const toast = useToast();
  const [saved, setSaved] = useState<GstSettings | null>(null);
  const [draft, setDraft] = useState<Draft>(() => draftOf(EMPTY));
  const [failure, setFailure] = useState<ApiError | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    api<GstSettings>('/gst/settings').then(
      (loaded) => {
        if (!active) return;
        setSaved(loaded);
        setDraft(draftOf(loaded));
      },
      () => {},
    );
    return () => {
      active = false;
    };
  }, []);

  const gstin = draft.gstin.trim().toUpperCase();
  const state = GSTIN.test(gstin) ? stateOfGstin(gstin) : undefined;
  const dirty = saved !== null && JSON.stringify(draft) !== JSON.stringify(draftOf(saved));
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const fieldError = (field: string) => (failure?.field === field ? failure.message : null);
  const year = saved?.financialYear ?? financialYear(localDay()).label;
  const prefix = draft.invoicePrefix.trim().toUpperCase();
  const last = /^\d{1,7}$/.test(draft.lastInvoiceNumber.trim()) ? Number(draft.lastInvoiceNumber.trim()) : null;
  const numberOf = (number: number) => `${prefix ? `${prefix}-` : ''}${year}-${number}`;

  const save = async () => {
    if (last === null) {
      setFailure(new ApiError('Enter a whole number: 0 if no invoice has been issued this year.', 'lastInvoiceNumber'));
      return;
    }
    setSaving(true);
    setFailure(null);
    try {
      const next = await api<GstSettings>('/gst/settings', 'PUT', { ...draft, gstin, invoicePrefix: prefix, lastInvoiceNumber: last });
      await api('/activity', 'POST', { area: 'settings', summary: 'Updated the GST settings', to: '/gst/settings' }).catch(() => null);
      setSaved(next);
      setDraft(draftOf(next));
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
            <TextField className="span-2" label="Legal name" required value={draft.legalName} onChange={(event) => set('legalName', event.target.value)} error={fieldError('legalName')} maxLength={150} hint="Printed at the top of the invoice and beside the signature." />
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
            <TextAreaField
              className="span-2"
              label="Principal place of business"
              required
              value={draft.address}
              onChange={(event) => set('address', event.target.value)}
              error={fieldError('address')}
              rows={2}
              maxLength={500}
              hint={state ? `Printed line by line, then “${state} - ${draft.pincode || 'PIN'}, India”.` : 'Printed line by line, as typed.'}
            />
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
            <TextField label="Contact" value={draft.phone} onChange={(event) => set('phone', event.target.value)} error={fieldError('phone')} maxLength={60} placeholder="e.g. 8698837333, +91-9822632333" />
            <TextField label="E-mail" type="email" value={draft.email} onChange={(event) => set('email', event.target.value)} error={fieldError('email')} maxLength={120} spellCheck={false} />
          </div>
        </Card>

        <Card aria-labelledby="numbering-title">
          <CardHeader id="numbering-title" title="Invoice numbers" description="Carry on from the series you use now, so there are no gaps or repeats." />
          <div className="card__body form-grid">
            <TextField
              label="Invoice prefix"
              value={draft.invoicePrefix}
              onChange={(event) => set('invoicePrefix', event.target.value.toUpperCase())}
              error={fieldError('invoicePrefix')}
              maxLength={6}
              hint={`Numbers look like ${numberOf(412)}, starting again each financial year (1 April).`}
            />
            <TextField
              label={`Last number used in ${year}`}
              value={draft.lastInvoiceNumber}
              onChange={(event) => set('lastInvoiceNumber', event.target.value.replace(/[^\d]/g, ''))}
              error={fieldError('lastInvoiceNumber')}
              inputMode="numeric"
              maxLength={7}
              hint={last === null ? 'Enter 0 if none has been issued this year.' : `The last invoice made in Tally (or here). The next one posted is ${numberOf(last + 1)}.`}
            />
          </div>
        </Card>

        <Card aria-labelledby="bank-title">
          <CardHeader id="bank-title" title="Company’s bank details" description="Printed under the tax summary, for buyers paying by transfer." />
          <div className="card__body form-grid">
            <TextField label="Bank name" value={draft.bankName} onChange={(event) => set('bankName', event.target.value)} maxLength={100} />
            <TextField label="A/c no." value={draft.bankAccount} onChange={(event) => set('bankAccount', event.target.value)} maxLength={40} inputMode="numeric" spellCheck={false} />
            <TextField className="span-2" label="Branch & IFS code" value={draft.bankBranchIfsc} onChange={(event) => set('bankBranchIfsc', event.target.value)} maxLength={120} spellCheck={false} />
          </div>
        </Card>

        <Card aria-labelledby="print-title">
          <CardHeader id="print-title" title="Printed at the foot" />
          <div className="card__body form-grid">
            <TextAreaField className="span-2" label="Declaration" value={draft.declaration} onChange={(event) => set('declaration', event.target.value)} rows={2} maxLength={500} />
            <TextField
              className="span-2"
              label="Jurisdiction"
              value={draft.jurisdiction}
              onChange={(event) => set('jurisdiction', event.target.value)}
              maxLength={100}
              placeholder="e.g. SUBJECT TO NASHIK JURISDICTION"
            />
            <TextAreaField className="span-2" label="Terms" value={draft.terms} onChange={(event) => set('terms', event.target.value)} rows={2} maxLength={1000} placeholder="e.g. Goods once sold will not be taken back." hint="Optional, printed under the declaration." />
          </div>
        </Card>

        {failure && !failure.field && (
          <p className="notice notice--warning" role="alert">
            {failure.message}
          </p>
        )}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          {dirty && <Button onClick={() => saved && setDraft(draftOf(saved))}>Discard</Button>}
          <Button type="submit" variant="primary" disabled={!dirty} loading={saving}>
            Save
          </Button>
        </div>
      </div>
    </form>
  );
}
