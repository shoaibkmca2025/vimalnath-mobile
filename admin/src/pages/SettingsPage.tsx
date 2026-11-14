import { ArrowCounterClockwiseIcon, DownloadSimpleIcon, InfoIcon } from '@phosphor-icons/react';
import { useEffect, useState, type FormEvent } from 'react';
import { useLocation } from 'react-router';

import { Button } from '@/components/Button';
import { Card, CardHeader } from '@/components/Card';
import { ConfirmDialog } from '@/components/Dialog';
import { PasswordField, Segmented, TextAreaField, TextField } from '@/components/Field';
import { PageHeader } from '@/components/PageHeader';
import { useToast } from '@/components/useToast';
import { useData } from '@/data/useData';
import type { Settings } from '@/data/types';
import { api, type ApiError } from '@/lib/api';
import { useTheme, type ThemePreference } from '@/lib/theme';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function websiteError(url: string) {
  if (!url.trim()) return null;
  try {
    return new URL(url.trim()).protocol === 'https:' ? null : 'Use the secure address, starting with https://.';
  } catch {
    return 'Enter the full address, e.g. https://vimalnath.in.';
  }
}

export default function SettingsPage() {
  const { db, update, reset, hasChanges } = useData();
  const toast = useToast();
  const location = useLocation();
  const [theme, setTheme] = useTheme();
  const [draft, setDraft] = useState<Settings>(db.settings);
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [confirmReset, setConfirmReset] = useState(false);

  const [source, setSource] = useState(db.settings);
  if (source !== db.settings) {
    setSource(db.settings);
    setDraft(db.settings);
  }

  // The "Preview data" pill in the top bar links straight to that section.
  useEffect(() => {
    if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: 'start' });
  }, [location.hash]);

  const errors: Record<string, string | null> = {
    companyName: draft.companyName.trim() ? null : 'Enter the company name.',
    email: draft.email.trim() && !EMAIL.test(draft.email.trim()) ? 'Enter an email address like sales@company.com.' : null,
    phone: draft.phone.trim() && draft.phone.replace(/\D/g, '').length < 10 ? 'Enter a 10-digit number, with the area code for landlines.' : null,
    website: websiteError(draft.website),
  };
  const shown = (key: string) => (touched.has(key) ? errors[key] : null);
  const touch = (key: string) => () => setTouched((current) => new Set(current).add(key));
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const dirty = JSON.stringify(draft) !== JSON.stringify(db.settings);

  const save = () => {
    setTouched(new Set(Object.keys(errors)));
    const firstError = Object.entries(errors).find(([, message]) => message);
    if (firstError) {
      document.getElementById(`setting-${firstError[0]}`)?.focus();
      return;
    }
    update('settings', () => ({ ...draft, companyName: draft.companyName.trim(), email: draft.email.trim(), website: draft.website.trim(), phone: draft.phone.trim() }), {
      area: 'settings',
      summary: 'Updated the company details and app defaults',
      to: '/settings',
    });
    setTouched(new Set());
    toast({ message: 'Settings saved.' });
  };

  const download = () => {
    const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `vimalnath-admin-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  return (
    <>
      <PageHeader title="Settings" description="Company details, app defaults and how this admin looks." />

      <div className="stack-lg" style={{ maxWidth: 760 }}>
        <Card aria-labelledby="company-title">
          <CardHeader id="company-title" title="Company" description="How Vimalnath appears to people using the app." />
          <div className="card__body form-grid">
            <TextField id="setting-companyName" label="Company name" required value={draft.companyName} onChange={(event) => set('companyName', event.target.value)} onBlur={touch('companyName')} error={shown('companyName')} autoComplete="organization" />
            <TextField label="Tagline" value={draft.tagline} onChange={(event) => set('tagline', event.target.value)} />
            <TextField id="setting-phone" label="Phone" type="tel" autoComplete="tel" value={draft.phone} onChange={(event) => set('phone', event.target.value)} onBlur={touch('phone')} error={shown('phone')} placeholder="+91" />
            <TextField id="setting-email" label="Email" type="email" autoComplete="email" value={draft.email} onChange={(event) => set('email', event.target.value)} onBlur={touch('email')} error={shown('email')} placeholder="sales@company.com" />
            <TextField id="setting-website" className="span-2" label="Website" type="url" inputMode="url" value={draft.website} onChange={(event) => set('website', event.target.value)} onBlur={touch('website')} error={shown('website')} placeholder="https://" />
            <TextAreaField className="span-2" label="Address" value={draft.address} onChange={(event) => set('address', event.target.value)} rows={3} autoComplete="street-address" />
          </div>
        </Card>

        <Card aria-labelledby="defaults-title">
          <CardHeader id="defaults-title" title="App defaults" />
          <div className="card__body stack-lg">
            <div className="field">
              <span className="field__label">Size unit</span>
              <Segmented<Settings['defaultUnit']>
                label="Size unit"
                value={draft.defaultUnit}
                onChange={(unit) => set('defaultUnit', unit)}
                options={[
                  { value: 'mm', label: 'Millimetres (mm)' },
                  { value: 'in', label: 'Inches (″)' },
                ]}
              />
              <p className="field__hint">The unit the glass calculator and bar optimizer start in. People can still switch on their phone.</p>
            </div>
            <TextField label="Price list edition" value={draft.priceListEdition} onChange={(event) => set('priceListEdition', event.target.value)} hint="The price list the app’s prices come from, e.g. Taiton · Feb 2026." />
          </div>
        </Card>

        <Card aria-labelledby="about-title">
          <CardHeader id="about-title" title="About the app" />
          <dl className="card__body kv">
            <dt>App version</dt>
            <dd className="num">{db.settings.appVersion}</dd>
            <dt>Developed by</dt>
            <dd>{db.settings.developer}</dd>
          </dl>
        </Card>

        <ChangePassword />

        <Card aria-labelledby="appearance-title">
          <CardHeader id="appearance-title" title="Appearance" description="Light matches the mobile app. Applies to this admin on this device." />
          <div className="card__body">
            <Segmented<ThemePreference>
              label="Theme"
              value={theme}
              onChange={setTheme}
              options={[
                { value: 'light', label: 'Light' },
                { value: 'dark', label: 'Dark' },
                { value: 'system', label: 'Match System' },
              ]}
            />
          </div>
        </Card>

        <Card aria-labelledby="preview-data-title" id="preview-data" style={{ scrollMarginTop: 'calc(var(--topbar-height) + 16px)' }}>
          <CardHeader id="preview-data-title" title="Preview data" />
          <div className="card__body stack">
            <p className="notice">
              <InfoIcon size={16} weight="bold" aria-hidden />
              <span>
                Orders, products, categories and price lists are saved on the server, along with staff and app users. Edits to bar sections, banners, videos and
                settings are saved in this browser only. Phones send orders and see their status; they get catalogue changes once app sync is built.
              </span>
            </p>
            <div className="row-wrap">
              <Button icon={DownloadSimpleIcon} onClick={download}>
                Download Data
              </Button>
              <Button variant="danger-plain" icon={ArrowCounterClockwiseIcon} disabled={!hasChanges} onClick={() => setConfirmReset(true)}>
                Reset to App Data
              </Button>
            </div>
          </div>
        </Card>
      </div>

      {dirty && (
        <div className="savebar" role="region" aria-label="Save settings" style={{ maxWidth: 760 }}>
          <span className="savebar__text">Unsaved changes</span>
          <Button
            onClick={() => {
              setDraft(db.settings);
              setTouched(new Set());
            }}
          >
            Discard
          </Button>
          <Button variant="primary" onClick={save}>
            Save Settings
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={confirmReset}
        title="Reset to the app’s data?"
        body="Every edit saved only in this browser — bar sections, banners, videos and settings — is discarded. Orders and the catalogue are on the server and stay as they are. Download a copy first if you might need it."
        confirmLabel="Reset"
        destructive
        onCancel={() => setConfirmReset(false)}
        onConfirm={() => {
          setConfirmReset(false);
          reset();
          toast({ message: 'Preview data reset to the app’s data.', tone: 'info' });
        }}
      />
    </>
  );
}

function ChangePassword() {
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [failure, setFailure] = useState<ApiError | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setFailure(null);
    try {
      await api('/auth/change-password', 'POST', { current, password });
      setCurrent('');
      setPassword('');
      toast({ message: 'Password changed. Your other devices are signed out.' });
    } catch (error) {
      setFailure(error as ApiError);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card aria-labelledby="password-title">
      <CardHeader id="password-title" title="Your password" />
      <form className="card__body stack" onSubmit={save} noValidate>
        <PasswordField label="Current password" autoComplete="current-password" value={current} onChange={(event) => setCurrent(event.target.value)} error={failure?.field === 'current' ? failure.message : null} required />
        <PasswordField label="New password" autoComplete="new-password" hint="At least 10 characters." value={password} onChange={(event) => setPassword(event.target.value)} error={failure?.field === 'password' ? failure.message : null} required />
        {failure && !failure.field && (
          <p className="notice notice--warning" role="alert">
            {failure.message}
          </p>
        )}
        <div>
          <Button type="submit" variant="primary" loading={saving} disabled={!current || !password}>
            Change Password
          </Button>
        </div>
      </form>
    </Card>
  );
}
