import { PlusIcon, ReceiptIcon, TrashIcon } from '@phosphor-icons/react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';

import { BillDocument } from '@/components/BillDocument';
import { Button, IconButton } from '@/components/Button';
import { Card, CardHeader } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { Segmented, Switch, TextAreaField, TextField } from '@/components/Field';
import { ImagePicker } from '@/components/ImagePicker';
import { PageHeader } from '@/components/PageHeader';
import { useToast } from '@/components/useToast';
import { computeInvoice, setUnitPrints } from '@/data/gst';
import { localDay } from '@/data/payments';
import { readSession } from '@/data/session';
import type { BillingSettings, BillingSetup, MeasurementUnit, SalesInvoice } from '@/data/types';
import { useData } from '@/data/useData';
import { useBilling } from '@/hooks/useBilling';
import { ApiError, api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';

type Editable = Omit<BillingSettings, 'gstin' | 'registrationType' | 'invoicePrefix' | 'updatedBy' | 'updatedAt'>;
type Draft = Omit<Editable, 'dueDays' | 'quotationDays'> & { dueDays: string; quotationDays: string };
const KEYS = [
  'legalName',
  'tradeName',
  'address',
  'pincode',
  'phone',
  'email',
  'bankName',
  'bankAccount',
  'bankBranchIfsc',
  'terms',
  'declaration',
  'jurisdiction',
  'heading',
  'footer',
  'logo',
  'signature',
  'themeColor',
  'paperSize',
  'template',
  'pricesIncludeGst',
  'allowNegativeStock',
] as const satisfies readonly (keyof Editable)[];
const draftOf = (settings: BillingSettings): Draft => ({ ...(Object.fromEntries(KEYS.map((key) => [key, settings[key]])) as Omit<Draft, 'dueDays' | 'quotationDays'>), dueDays: String(settings.dueDays), quotationDays: String(settings.quotationDays) });
const THEMES = ['#1d4ed8', '#0f766e', '#7c3aed', '#b45309', '#be123c', '#111827'];

/** A sample bill to preview the design with, in the shop's own units and rates. */
function sample(settings: BillingSettings): SalesInvoice {
  const figures = computeInvoice(
    [
      { productId: '', option: '', description: 'SS Door Handle 8"', detail: 'Matt finish', sku: 'DH-08', hsn: '83024110', qty: 12, unit: 'pcs', rate: 450, discountPct: 10, discountAmount: 0, gstRate: 18, lineType: 'goods' as const, categoryLabel: 'Door Handles' },
      { productId: '', option: '', description: 'Aluminium Section 3"', detail: 'Powder coated', sku: 'AL-3', hsn: '76042910', qty: 36, unit: 'feet', rate: 85, discountPct: 0, discountAmount: 0, gstRate: 18, lineType: 'goods' as const },
      { productId: '', option: '', description: 'Transportation charges', detail: '', sku: '', hsn: '996511', qty: 1, unit: 'pcs', rate: 300, discountPct: 0, discountAmount: 0, gstRate: 18, lineType: 'charge' as const },
    ],
    false,
    { billDiscount: 200 },
  );
  return {
    id: 'sample',
    number: `${settings.invoicePrefix ? `${settings.invoicePrefix}-` : ''}26-27-412`,
    invoiceDate: localDay(),
    status: 'posted',
    source: 'counter',
    customerName: 'Sample Customer',
    customerPhone: '98220 00000',
    billingAddress: 'College Road, Nashik',
    placeOfSupply: 'Maharashtra',
    posCode: '27',
    interstate: false,
    billDiscount: figures.billDiscount,
    taxable: figures.taxable,
    cgst: figures.cgst,
    sgst: figures.sgst,
    igst: figures.igst,
    roundOff: figures.roundOff,
    total: figures.total,
    paid: 5000,
    items: figures.lines,
    createdBy: '',
    createdAt: new Date().toISOString(),
  };
}

/** Invoice Settings: how bills look (design, paper, colour, logo, signature) and how billing behaves. */
export default function InvoiceSettingsPage() {
  const { setup, setSetup, error } = useBilling({ invoices: false });
  const owner = readSession()?.role === 'owner';
  if (!setup)
    return (
      <>
        <PageHeader title="Invoice Settings" crumbs={[{ label: 'Billing', to: '/billing' }]} />
        <Card>
          <EmptyState icon={ReceiptIcon} title={error ? 'Couldn’t load the settings' : 'Loading…'}>
            {error}
          </EmptyState>
        </Card>
      </>
    );
  if (!owner)
    return (
      <>
        <PageHeader title="Invoice Settings" crumbs={[{ label: 'Billing', to: '/billing' }]} />
        <Card>
          <EmptyState icon={ReceiptIcon} title="Only an Owner changes these" />
        </Card>
      </>
    );
  return <SettingsForm key={setup.settings.updatedAt ?? 'new'} setup={setup} onSaved={setSetup} />;
}

function SettingsForm({ setup, onSaved }: { setup: BillingSetup; onSaved: (setup: BillingSetup) => void }) {
  const toast = useToast();
  const { db } = useData();
  const saved = setup.settings;
  const [draft, setDraft] = useState<Draft>(() => draftOf(saved));
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<ApiError | null>(null);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const dirty = JSON.stringify(draft) !== JSON.stringify(draftOf(saved));
  const fieldError = (field: string) => (failure?.field === field ? failure.message : null);
  const dueDays = /^\d{1,3}$/.test(draft.dueDays.trim()) ? Number(draft.dueDays) : NaN;
  const quotationDays = /^\d{1,3}$/.test(draft.quotationDays.trim()) ? Number(draft.quotationDays) : NaN;
  const previewSettings: BillingSettings = { ...saved, ...draft, dueDays: dueDays || 0, quotationDays: quotationDays || 15 };
  const example = useMemo(() => sample(saved), [saved]);

  const save = async () => {
    if (Number.isNaN(dueDays) || dueDays > 365) return setFailure(new ApiError('Enter 0 to 365 days.', 'dueDays'));
    if (Number.isNaN(quotationDays) || quotationDays < 1 || quotationDays > 365) return setFailure(new ApiError('Enter 1 to 365 days.', 'quotationDays'));
    setSaving(true);
    setFailure(null);
    try {
      const answer = await api<{ settings: BillingSettings; units: MeasurementUnit[] }>('/billing/settings', 'PUT', { ...draft, dueDays, quotationDays });
      await api('/activity', 'POST', { area: 'settings', summary: 'Updated the Invoice Settings', to: '/billing/settings' }).catch(() => null);
      onSaved({ ...setup, settings: answer.settings, units: answer.units });
      toast({ message: 'Invoice Settings saved.' });
    } catch (problem) {
      setFailure(problem instanceof ApiError ? problem : new ApiError('Couldn’t save.'));
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
        title="Invoice Settings"
        crumbs={[{ label: 'Billing', to: '/billing' }]}
        description={
          <>
            How counter bills and quotations look and behave. The GSTIN, registration type and invoice numbers are under <Link to="/gst/settings">GST Settings</Link>.
            {saved.updatedAt && ` Last changed ${formatDateTime(saved.updatedAt)} by ${saved.updatedBy}.`}
          </>
        }
      />
      <div className="settings-split">
        <div className="stack-lg">
          <Card aria-labelledby="design-title">
            <CardHeader id="design-title" title="Design" description="The preview shows a sample bill as it will print." />
            <div className="card__body stack">
              <div className="field">
                <span className="field__label">Template</span>
                <Segmented<BillingSettings['template']>
                  label="Template"
                  value={draft.template}
                  onChange={(value) => set('template', value)}
                  options={[
                    { value: 'classic', label: 'Classic (Tally)' },
                    { value: 'modern', label: 'Modern' },
                    { value: 'compact', label: 'Compact' },
                  ]}
                />
              </div>
              <div className="field">
                <span className="field__label">Paper</span>
                <Segmented<BillingSettings['paperSize']>
                  label="Paper"
                  value={draft.paperSize}
                  onChange={(value) => set('paperSize', value)}
                  options={[
                    { value: 'A4', label: 'A4' },
                    { value: 'A5', label: 'A5' },
                    { value: 'thermal', label: 'Thermal 80 mm' },
                  ]}
                />
                <p className="field__hint">Thermal prints a till-roll receipt whatever the template.</p>
              </div>
              <div className="field">
                <span className="field__label" id="theme-label">
                  Colour
                </span>
                <div className="row" role="radiogroup" aria-labelledby="theme-label" style={{ gap: 8 }}>
                  {THEMES.map((color) => (
                    <button
                      key={color}
                      type="button"
                      role="radio"
                      aria-checked={draft.themeColor.toLowerCase() === color}
                      aria-label={color}
                      className="swatch"
                      style={{ background: color }}
                      onClick={() => set('themeColor', color)}
                    />
                  ))}
                  <input className="swatch swatch--custom" type="color" aria-label="Another colour" value={draft.themeColor} onChange={(event) => set('themeColor', event.target.value)} />
                </div>
                <p className="field__hint">Used by the Modern and Compact templates.</p>
              </div>
              <TextField label="Heading" value={draft.heading} onChange={(event) => set('heading', event.target.value.toUpperCase())} maxLength={40} placeholder="TAX INVOICE" hint="Empty prints TAX INVOICE (BILL OF SUPPLY for a composition dealer)." />
              <div className="form-grid">
                <ImagePicker label="Logo" value={draft.logo} onChange={(image) => set('logo', image)} hint="Empty uses the app’s logo." />
                <ImagePicker label="Signature" value={draft.signature} onChange={(image) => set('signature', image)} shape="wide" hint="A photo of the signature on white, printed above Authorised Signatory." />
              </div>
              <TextAreaField label="Footer" value={draft.footer} onChange={(event) => set('footer', event.target.value)} rows={2} maxLength={300} placeholder="e.g. Thank you for your business!" />
            </div>
          </Card>

          <Card aria-labelledby="business-title">
            <CardHeader id="business-title" title="Business details" description="Printed at the top of every bill." />
            <div className="card__body form-grid">
              <TextField className="span-2" label="Business name" required value={draft.legalName} onChange={(event) => set('legalName', event.target.value)} error={fieldError('legalName')} maxLength={150} />
              <TextField className="span-2" label="Trade name" value={draft.tradeName} onChange={(event) => set('tradeName', event.target.value)} maxLength={150} />
              <TextAreaField className="span-2" label="Address" value={draft.address} onChange={(event) => set('address', event.target.value)} rows={2} maxLength={500} />
              <TextField label="PIN code" value={draft.pincode} onChange={(event) => set('pincode', event.target.value)} error={fieldError('pincode')} inputMode="numeric" maxLength={6} />
              <TextField label="Contact" value={draft.phone} onChange={(event) => set('phone', event.target.value)} maxLength={60} />
              <TextField className="span-2" label="E-mail" type="email" value={draft.email} onChange={(event) => set('email', event.target.value)} maxLength={120} spellCheck={false} />
              <TextField label="Bank name" value={draft.bankName} onChange={(event) => set('bankName', event.target.value)} maxLength={100} />
              <TextField label="A/c no." value={draft.bankAccount} onChange={(event) => set('bankAccount', event.target.value)} maxLength={40} spellCheck={false} />
              <TextField className="span-2" label="Branch & IFS code" value={draft.bankBranchIfsc} onChange={(event) => set('bankBranchIfsc', event.target.value)} maxLength={120} spellCheck={false} />
              <TextAreaField className="span-2" label="Terms & conditions" value={draft.terms} onChange={(event) => set('terms', event.target.value)} rows={3} maxLength={1000} placeholder="e.g. Goods once sold will not be taken back." />
              <TextAreaField className="span-2" label="Declaration" value={draft.declaration} onChange={(event) => set('declaration', event.target.value)} rows={2} maxLength={500} />
              <TextField className="span-2" label="Jurisdiction" value={draft.jurisdiction} onChange={(event) => set('jurisdiction', event.target.value)} maxLength={100} placeholder="e.g. SUBJECT TO NASHIK JURISDICTION" />
            </div>
          </Card>

          <Card aria-labelledby="behaviour-title">
            <CardHeader id="behaviour-title" title="Billing" />
            <div className="card__body stack">
              <Switch label="Rates include GST" description="New bills start with rates typed GST included (MRP-style). Each bill can still switch." checked={draft.pricesIncludeGst} onChange={(on) => set('pricesIncludeGst', on)} />
              <Switch
                label="Allow billing below zero stock"
                description="Off: a bill is refused when an item hasn’t enough stock (an Owner can still allow it on one bill). On: every bill may take stock below zero."
                checked={draft.allowNegativeStock}
                onChange={(on) => set('allowNegativeStock', on)}
              />
              <div className="form-grid">
                <TextField label="Payment due after" suffix="days" inputMode="numeric" value={draft.dueDays} onChange={(event) => set('dueDays', event.target.value)} error={fieldError('dueDays')} hint="0 for no due date: paid at the counter." />
                <TextField label="Quotations valid for" suffix="days" inputMode="numeric" value={draft.quotationDays} onChange={(event) => set('quotationDays', event.target.value)} error={fieldError('quotationDays')} />
              </div>
            </div>
          </Card>

          <Units units={setup.units} onChange={(units) => onSaved({ ...setup, units })} />

          {failure && !failure.field && (
            <p className="notice notice--warning" role="alert">
              {failure.message}
            </p>
          )}
          <div className="row savebar-inline" style={{ justifyContent: 'flex-end' }}>
            {dirty && <Button onClick={() => setDraft(draftOf(saved))}>Discard</Button>}
            <Button type="submit" variant="primary" disabled={!dirty} loading={saving}>
              Save
            </Button>
          </div>
        </div>
        <FitPreview width={previewSettings.paperSize === 'thermal' ? 320 : previewSettings.paperSize === 'A5' ? 760 : 1000}>
          <BillDocument invoice={example} settings={previewSettings} company={db.settings} />
        </FitPreview>
      </div>
    </form>
  );
}

/** The sample bill scaled down to the pane's width, as a page is in a print preview: the whole design at a glance. */
function FitPreview({ width, children }: { width: number; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const pane = ref.current;
    if (!pane) return;
    const observer = new ResizeObserver(([entry]) => {
      const room = entry!.contentRect.width;
      setScale(Math.min(1, Math.max(0.3, room / width)));
    });
    observer.observe(pane);
    return () => observer.disconnect();
  }, [width]);
  return (
    <div ref={ref} className="settings-split__preview" aria-label="Preview">
      <div className="settings-split__page" style={{ width, zoom: scale }}>
        {children}
      </div>
    </div>
  );
}

/** The units a bill line can be in: the stock units (fixed) and the shop's own. */
function Units({ units, onChange }: { units: MeasurementUnit[]; onChange: (units: MeasurementUnit[]) => void }) {
  const toast = useToast();
  const [label, setLabel] = useState('');
  const [print, setPrint] = useState('');
  const [failure, setFailure] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const add = async () => {
    setBusy('add');
    setFailure(null);
    try {
      const answer = await api<{ units: MeasurementUnit[] }>('/billing/units', 'POST', { label: label.trim(), print: print.trim() });
      setUnitPrints(answer.units);
      onChange(answer.units);
      toast({ message: `${label.trim().toUpperCase()} added.` });
      setLabel('');
      setPrint('');
    } catch (problem) {
      setFailure(problem instanceof ApiError ? problem : new ApiError('Couldn’t add it.'));
    } finally {
      setBusy(null);
    }
  };
  const remove = async (unit: MeasurementUnit) => {
    setBusy(unit.code);
    try {
      const answer = await api<{ units: MeasurementUnit[] }>(`/billing/units/${encodeURIComponent(unit.code)}`, 'DELETE');
      onChange(answer.units);
      toast({ message: `${unit.label} removed.` });
    } catch (problem) {
      toast({ tone: 'error', message: problem instanceof Error ? problem.message : 'Couldn’t remove it.' });
    } finally {
      setBusy(null);
    }
  };
  return (
    <Card aria-labelledby="units-title">
      <CardHeader id="units-title" title="Units" description="A counted item is always billed in its stock unit; items typed by hand can use any of these." />
      <ul className="list">
        {units.map((unit) => (
          <li key={unit.code} className="list-row">
            <div style={{ flex: 1, minWidth: 0 }}>
              <span className="list-row__title">{unit.label}</span>
              <div className="cell-sub">
                Prints as {unit.print}
                {unit.builtIn ? ' · built in' : ''}
              </div>
            </div>
            {!unit.builtIn && <IconButton icon={TrashIcon} label={`Remove ${unit.label}`} tone="danger" disabled={busy === unit.code} onClick={() => void remove(unit)} />}
          </li>
        ))}
      </ul>
      <div className="card__body form-grid" style={{ alignItems: 'end' }}>
        <TextField label="New unit" value={label} onChange={(event) => setLabel(event.target.value)} maxLength={20} placeholder="e.g. Bundle" error={failure?.field === 'label' ? failure.message : null} />
        <TextField label="Prints as" value={print} onChange={(event) => setPrint(event.target.value)} maxLength={12} placeholder="e.g. BDL" hint="Optional: the name, in capitals." />
        <div className="span-2">
          <Button icon={PlusIcon} loading={busy === 'add'} disabled={!label.trim()} onClick={() => void add()}>
            Add Unit
          </Button>
          {failure && !failure.field && <p className="field__error">{failure.message}</p>}
        </div>
      </div>
    </Card>
  );
}
