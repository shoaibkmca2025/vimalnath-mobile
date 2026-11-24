import { useEffect, useState } from 'react';

import { Button } from '@/components/Button';
import { Card, CardHeader } from '@/components/Card';
import { Segmented, Switch, TextAreaField, TextField } from '@/components/Field';
import { PageHeader } from '@/components/PageHeader';
import { useToast } from '@/components/useToast';
import { REFUND_METHODS } from '@/data/returns';
import type { RefundMethod, ReturnAction, ReturnSettings } from '@/data/types';
import { useData } from '@/data/useData';
import { ApiError, api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';

const ACTIONS: { action: ReturnAction; label: string; hint: string }[] = [
  { action: 'create', label: 'Record returns', hint: 'Start a return or replacement, and change it until it’s decided.' },
  { action: 'approve', label: 'Approve or reject', hint: 'Decide, issue credit notes, close, and cancel after the goods are in.' },
  { action: 'receive', label: 'Receive goods', hint: 'Take the goods back in, and give replacement goods out.' },
  { action: 'inspect', label: 'Quality check', hint: 'Decide what goes back on sale and what is damaged or defective.' },
  { action: 'refund', label: 'Pay refunds', hint: 'Record refunds and collections.' },
];
const ROLES: { role: 'sales' | 'catalogue' | 'inventory'; label: string }[] = [
  { role: 'sales', label: 'Sales' },
  { role: 'inventory', label: 'Inventory' },
  { role: 'catalogue', label: 'Catalogue' },
];

type Draft = Omit<ReturnSettings, 'eligibilityDays' | 'updatedBy' | 'updatedAt'> & { eligibilityDays: string };
const draftOf = (settings: ReturnSettings): Draft => {
  const { updatedBy: _by, updatedAt: _at, ...rest } = settings;
  return { ...rest, eligibilityDays: String(settings.eligibilityDays) };
};

/** How the shop handles returns. Nothing here changes a return already made. */
export default function ReturnSettingsPage() {
  const toast = useToast();
  const { db } = useData();
  const [saved, setSaved] = useState<ReturnSettings | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [failure, setFailure] = useState<ApiError | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    api<ReturnSettings>('/returns/settings').then(
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

  if (!draft || !saved) return <PageHeader title="Return Settings" crumbs={[{ label: 'Returns', to: '/returns' }]} description="Loading…" />;
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((current) => current && { ...current, [key]: value });
  const dirty = JSON.stringify(draft) !== JSON.stringify(draftOf(saved));
  const days = /^\d{1,4}$/.test(draft.eligibilityDays.trim()) ? Number(draft.eligibilityDays) : NaN;
  const fieldError = (field: string) => (failure?.field === field ? failure.message : null);
  const toggle = <T extends string>(list: T[], value: T, on: boolean) => (on ? [...new Set([...list, value])] : list.filter((one) => one !== value));

  const save = async () => {
    if (Number.isNaN(days)) {
      setFailure(new ApiError('Enter whole days: 0 for no limit.', 'eligibilityDays'));
      return;
    }
    setSaving(true);
    setFailure(null);
    try {
      const next = await api<ReturnSettings>('/returns/settings', 'PUT', { ...draft, eligibilityDays: days });
      await api('/activity', 'POST', { area: 'settings', summary: 'Updated the return settings', to: '/returns/settings' }).catch(() => null);
      setSaved(next);
      setDraft(draftOf(next));
      toast({ message: 'Return settings saved.' });
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
        title="Return Settings"
        crumbs={[{ label: 'Returns', to: '/returns' }]}
        description={saved.updatedAt ? `Last changed ${formatDateTime(saved.updatedAt)} by ${saved.updatedBy}. Changes apply to returns from now on.` : 'Changes apply to returns from now on; returns already made keep what they were.'}
      />
      <div className="stack-lg" style={{ maxWidth: 860 }}>
        <Card aria-labelledby="eligibility-title">
          <CardHeader id="eligibility-title" title="What can come back" description="Never refused by these: a return outside them is flagged for whoever approves." />
          <div className="card__body form-grid">
            <TextField
              label="Return period (days after delivery)"
              inputMode="numeric"
              value={draft.eligibilityDays}
              onChange={(event) => set('eligibilityDays', event.target.value.replace(/[^\d]/g, ''))}
              error={fieldError('eligibilityDays')}
              hint={days === 0 ? 'No limit.' : Number.isNaN(days) ? undefined : `Returns after ${days} days are flagged and always wait for approval.`}
            />
            <div className="field span-2">
              <span className="field__label">Returnable categories</span>
              <p className="field__hint" style={{ marginTop: 0 }}>
                None ticked: every category. Ticked: others are flagged.
              </p>
              <div className="check-grid">
                {db.categories.map((category) => (
                  <label key={category.id} className="check">
                    <input type="checkbox" checked={draft.eligibleCategories.includes(category.id)} onChange={(event) => set('eligibleCategories', toggle(draft.eligibleCategories, category.id, event.target.checked))} />
                    {category.label}
                  </label>
                ))}
              </div>
            </div>
          </div>
        </Card>

        <Card aria-labelledby="approval-title">
          <CardHeader id="approval-title" title="Approvals and replacements" />
          <div className="card__body stack">
            <Switch label="Returns need approval" description="Off: a return is approved as it’s recorded by someone allowed to approve (unless it’s flagged)." checked={draft.requireApproval} onChange={(on) => set('requireApproval', on)} />
            <Switch label="Refunds need approval" description="On: a refund waits for someone allowed to approve before it can be paid." checked={draft.refundApproval} onChange={(on) => set('refundApproval', on)} />
            <Switch label="Allow replacements" description="Customers can swap goods for other goods." checked={draft.allowReplacements} onChange={(on) => set('allowReplacements', on)} />
          </div>
        </Card>

        <Card aria-labelledby="stock-title">
          <CardHeader id="stock-title" title="Stock" description="Returned goods never reach stock that can be sold without a check or a rule saying so." />
          <div className="card__body stack">
            <div className="field">
              <span className="field__label">Restocking</span>
              <Segmented<ReturnSettings['restockRule']>
                label="Restocking"
                value={draft.restockRule}
                onChange={(rule) => set('restockRule', rule)}
                options={[
                  { value: 'inspect', label: 'Check everything first' },
                  { value: 'unopened', label: 'Unopened straight back on sale' },
                ]}
              />
            </div>
            <div className="field">
              <span className="field__label">Damaged goods</span>
              <Segmented<ReturnSettings['damagedHandling']>
                label="Damaged goods"
                value={draft.damagedHandling}
                onChange={(handling) => set('damagedHandling', handling)}
                options={[
                  { value: 'keep', label: 'Keep in damaged stock' },
                  { value: 'write_off', label: 'Write off' },
                ]}
              />
              <p className="field__hint">{draft.damagedHandling === 'keep' ? 'Kept apart, to send back to the supplier or sell as seconds.' : 'They leave stock when checked.'}</p>
            </div>
            <Switch label="Allow negative stock for replacements" description="Off: a replacement can’t give out more than is in stock." checked={draft.allowNegativeStock} onChange={(on) => set('allowNegativeStock', on)} />
          </div>
        </Card>

        <Card aria-labelledby="gst-title">
          <CardHeader id="gst-title" title="GST" description="For orders with a posted tax invoice. Ask your accountant which treatment applies; nothing is filed from here." />
          <div className="card__body stack">
            <Switch label="Issue the credit note when goods come back" description="Off: issue it from the return when you’re ready." checked={draft.creditNoteOnReceipt} onChange={(on) => set('creditNoteOnReceipt', on)} />
            <div className="field">
              <span className="field__label">Replacements</span>
              <Segmented<ReturnSettings['replacementTax']>
                label="Replacements"
                value={draft.replacementTax}
                onChange={(treatment) => set('replacementTax', treatment)}
                options={[
                  { value: 'invoice', label: 'Credit note + new tax invoice' },
                  { value: 'none', label: 'No GST documents' },
                ]}
              />
              <p className="field__hint">
                {draft.replacementTax === 'invoice'
                  ? 'The goods back get a credit note; the goods given, a tax invoice (drafted, to post).'
                  : 'For like-for-like swaps (e.g. under warranty) where your accountant agrees no new supply is made.'}
              </p>
            </div>
          </div>
        </Card>

        <Card aria-labelledby="numbers-title">
          <CardHeader id="numbers-title" title="Numbering" />
          <div className="card__body form-grid">
            <TextField label="Return prefix" value={draft.returnPrefix} onChange={(event) => set('returnPrefix', event.target.value.toUpperCase())} error={fieldError('returnPrefix')} maxLength={6} hint={`e.g. ${draft.returnPrefix || 'RET'}-0001`} />
            <TextField label="Credit note prefix" value={draft.creditNotePrefix} onChange={(event) => set('creditNotePrefix', event.target.value.toUpperCase())} error={fieldError('creditNotePrefix')} maxLength={6} hint={`e.g. ${draft.creditNotePrefix || 'CN'}-26-27-1, each financial year`} />
            <TextField
              label="Supplier return prefix"
              value={draft.supplierReturnPrefix}
              onChange={(event) => set('supplierReturnPrefix', event.target.value.toUpperCase())}
              error={fieldError('supplierReturnPrefix')}
              maxLength={6}
              hint={`e.g. ${draft.supplierReturnPrefix || 'SRN'}-0001`}
            />
          </div>
        </Card>

        <Card aria-labelledby="refund-title">
          <CardHeader id="refund-title" title="Refund methods" description="What staff can choose when refunding." />
          <div className="card__body">
            <div className="check-grid">
              {(Object.keys(REFUND_METHODS) as RefundMethod[]).map((method) => (
                <label key={method} className="check">
                  <input type="checkbox" checked={draft.refundMethods.includes(method)} onChange={(event) => set('refundMethods', toggle(draft.refundMethods, method, event.target.checked))} />
                  {REFUND_METHODS[method]}
                </label>
              ))}
            </div>
            {fieldError('refundMethods') && <p className="field__error">{fieldError('refundMethods')}</p>}
          </div>
        </Card>

        <Card aria-labelledby="permissions-title" className="table-card">
          <CardHeader id="permissions-title" title="Staff permissions" description="Owners can always do everything." />
          <div className="table-scroll">
            <table className="table">
              <caption className="visually-hidden">Who may do what with returns</caption>
              <thead>
                <tr>
                  <th scope="col">Step</th>
                  {ROLES.map((role) => (
                    <th key={role.role} scope="col" style={{ textAlign: 'center' }}>
                      {role.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ACTIONS.map(({ action, label, hint }) => (
                  <tr key={action}>
                    <td>
                      <div className="cell-title">{label}</div>
                      <div className="cell-sub">{hint}</div>
                    </td>
                    {ROLES.map(({ role, label: roleLabel }) => (
                      <td key={role} style={{ textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          aria-label={`${roleLabel}: ${label}`}
                          checked={draft.permissions[action].includes(role)}
                          onChange={(event) => set('permissions', { ...draft.permissions, [action]: toggle(draft.permissions[action], role, event.target.checked) })}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card aria-labelledby="terms-title">
          <CardHeader id="terms-title" title="Return terms" />
          <div className="card__body">
            <TextAreaField label="Printed on return receipts" value={draft.terms} onChange={(event) => set('terms', event.target.value)} rows={3} maxLength={2000} placeholder="e.g. Goods are taken back within 30 days of delivery, unused and in their packing." />
          </div>
        </Card>

        {failure && !failure.field && (
          <p className="notice notice--warning" role="alert">
            {failure.message}
          </p>
        )}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          {dirty && <Button onClick={() => setDraft(draftOf(saved))}>Discard</Button>}
          <Button type="submit" variant="primary" disabled={!dirty} loading={saving}>
            Save
          </Button>
        </div>
      </div>
    </form>
  );
}
