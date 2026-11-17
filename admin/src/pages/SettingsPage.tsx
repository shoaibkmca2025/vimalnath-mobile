import { DownloadSimpleIcon, InfoIcon } from '@phosphor-icons/react';
import { useState, type FormEvent } from 'react';

import { Button } from '@/components/Button';
import { Card, CardHeader } from '@/components/Card';
import { PasswordField, Segmented, TextAreaField, TextField } from '@/components/Field';
import { ImagePicker } from '@/components/ImagePicker';
import { PageHeader } from '@/components/PageHeader';
import { useToast } from '@/components/useToast';
import { useData } from '@/data/useData';
import type { Settings } from '@/data/types';
import { api, type ApiError } from '@/lib/api';
import { useTheme, type ThemePreference } from '@/lib/theme';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;

/** The same rules as the server: empty, or a version no newer than the latest ("1.9.0" is older than "1.10.0"). */
function minVersionError(min: string, latest: string) {
  if (!min) return null;
  if (!VERSION.test(min)) return 'Enter the version like 1.2.0, or leave it empty.';
  return min.localeCompare(latest, 'en', { numeric: true }) > 0 ? 'The minimum version can’t be newer than the latest version.' : null;
}

function websiteError(url: string) {
  if (!url.trim()) return null;
  try {
    return new URL(url.trim()).protocol === 'https:' ? null : 'Use the secure address, starting with https://.';
  } catch {
    return 'Enter the full address, e.g. https://vimalnath.in.';
  }
}

export default function SettingsPage() {
  const { db, update } = useData();
  const toast = useToast();
  const [theme, setTheme] = useTheme();
  const [draft, setDraft] = useState<Settings>(db.settings);
  const [touched, setTouched] = useState<Set<string>>(new Set());

  const [source, setSource] = useState(db.settings);
  if (source !== db.settings) {
    setSource(db.settings);
    setDraft(db.settings);
  }

  const errors: Record<string, string | null> = {
    companyName: draft.companyName.trim() ? null : 'Enter the company name.',
    email: draft.email.trim() && !EMAIL.test(draft.email.trim()) ? 'Enter an email address like sales@company.com.' : null,
    phone: draft.phone.trim() && draft.phone.replace(/\D/g, '').length < 10 ? 'Enter a 10-digit number, with the area code for landlines.' : null,
    website: websiteError(draft.website),
    appVersion: VERSION.test(draft.appVersion.trim()) ? null : 'Enter the version like 1.2.0.',
    minAppVersion: minVersionError(draft.minAppVersion.trim(), draft.appVersion.trim()),
  };
  const shown = (key: string) => (touched.has(key) ? errors[key] : null);
  const touch = (key: string) => () => setTouched((current) => new Set(current).add(key));
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const dirty = JSON.stringify(draft) !== JSON.stringify(db.settings);

  const save = async () => {
    setTouched(new Set(Object.keys(errors)));
    const firstError = Object.entries(errors).find(([, message]) => message);
    if (firstError) {
      document.getElementById(`setting-${firstError[0]}`)?.focus();
      return;
    }
    const trimmed = Object.fromEntries(Object.entries(draft).map(([key, value]) => [key, value.trim()])) as Settings;
    const ok = await update('settings', () => trimmed, { area: 'settings', summary: 'Updated the company details and app settings', to: '/settings' });
    if (!ok) return;
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
            <div style={{ maxWidth: 220 }}>
              <ImagePicker label="Logo" allowRemove={false} value={draft.logo} onChange={(logo) => logo && set('logo', logo)} hint="Square. Shown on the app’s About screen and on printed orders." />
            </div>
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
          <CardHeader id="about-title" title="App versions" description={`The app is developed by ${db.settings.developer}.`} />
          <div className="card__body form-grid">
            <TextField id="setting-appVersion" label="Latest version" required inputMode="decimal" value={draft.appVersion} onChange={(event) => set('appVersion', event.target.value)} onBlur={touch('appVersion')} error={shown('appVersion')} hint="The newest version in the Play Store and App Store." />
            <TextField
              id="setting-minAppVersion"
              label="Minimum version"
              inputMode="decimal"
              placeholder="Any version"
              value={draft.minAppVersion}
              onChange={(event) => set('minAppVersion', event.target.value)}
              onBlur={touch('minAppVersion')}
              error={shown('minAppVersion')}
              hint="Phones on an older version are asked to update before they order."
            />
          </div>
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

        <Card aria-labelledby="data-title">
          <CardHeader id="data-title" title="Your data" />
          <div className="card__body stack">
            <p className="notice">
              <InfoIcon size={16} weight="bold" aria-hidden />
              <span>
                Everything you edit here is saved on the server. The Activity page is the exception: it lists changes made in this browser only, until the activity log
                moves to the server. Phones send orders and see their status; they get catalogue, content and settings changes once app sync is built.
              </span>
            </p>
            <div>
              <Button icon={DownloadSimpleIcon} onClick={download}>
                Download Data
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
