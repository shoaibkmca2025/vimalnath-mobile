import { DownloadSimpleIcon, InfoIcon } from '@phosphor-icons/react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { Button } from '@/components/Button';
import { Card, CardHeader } from '@/components/Card';
import { PasswordField, Segmented, TextAreaField, TextField } from '@/components/Field';
import { ImagePicker } from '@/components/ImagePicker';
import { PageHeader } from '@/components/PageHeader';
import { useToast } from '@/components/useToast';
import { useData } from '@/data/useData';
import type { Settings } from '@/data/types';
import { api, type ApiError } from '@/lib/api';
import { formatDateTime, formatRelativeTime } from '@/lib/format';
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
    announcementTo: draft.announcementFrom && draft.announcementTo && draft.announcementTo < draft.announcementFrom ? 'The notice can’t end before it starts.' : null,
    kerfMm: /^\d{1,2}(\.\d)?$/.test(draft.kerfMm.trim()) && Number(draft.kerfMm) <= 20 ? null : 'Enter the cutting loss in mm, from 0 to 20, e.g. 3 or 2.5.',
    creditDays: /^\d{1,3}$/.test(draft.creditDays.trim()) && Number(draft.creditDays) <= 365 ? null : 'Enter the number of days, from 0 to 365, e.g. 30.',
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
            <TextField
              id="setting-kerfMm"
              label="Bar Optimizer cutting loss (mm)"
              inputMode="decimal"
              value={draft.kerfMm}
              onChange={(event) => set('kerfMm', event.target.value)}
              onBlur={touch('kerfMm')}
              error={shown('kerfMm')}
              hint="The blade width lost at each cut. The optimizer starts with it; people can still change it on their phone."
            />
            <TextField label="Price list edition" value={draft.priceListEdition} onChange={(event) => set('priceListEdition', event.target.value)} hint="The price list the app’s prices come from, e.g. Taiton · Feb 2026." />
          </div>
        </Card>

        <Card aria-labelledby="payments-title">
          <CardHeader id="payments-title" title="Payments" />
          <div className="card__body stack">
            <TextField
              id="setting-creditDays"
              label="Credit period"
              inputMode="numeric"
              suffix="days"
              value={draft.creditDays}
              onChange={(event) => set('creditDays', event.target.value)}
              onBlur={touch('creditDays')}
              error={shown('creditDays')}
              hint="A credit order falls due this many days after it’s delivered; a cash order on delivery. Bills unpaid after that show in red under Payments."
            />
          </div>
        </Card>

        <Card aria-labelledby="announcement-title">
          <CardHeader id="announcement-title" title="Announcement" description="A notice at the top of the app’s Shop, for example a holiday closure or a new price list. Leave it empty to show none." />
          <div className="card__body form-grid">
            <TextAreaField className="span-2" label="Notice" value={draft.announcement} onChange={(event) => set('announcement', event.target.value)} rows={2} maxLength={200} placeholder="e.g. Closed 10–12 November for Diwali. Orders placed now are confirmed on the 13th." />
            <TextField label="Show from" type="date" value={draft.announcementFrom} onChange={(event) => set('announcementFrom', event.target.value)} hint="Empty: from now." />
            <TextField
              id="setting-announcementTo"
              label="Show until"
              type="date"
              value={draft.announcementTo}
              onChange={(event) => set('announcementTo', event.target.value)}
              onBlur={touch('announcementTo')}
              error={shown('announcementTo')}
              hint="Empty: until you clear the notice."
            />
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
              hint="Phones linked to the shop on an older version are asked to update before they order."
            />
          </div>
        </Card>

        <ChangePassword />

        <SignedInDevices />

        <Card aria-labelledby="appearance-title">
          <CardHeader id="appearance-title" title="Appearance" description="Light matches the mobile app. Applies to this admin on this device. You can also switch it from the top bar on any page." />
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
                Everything you edit here is saved on the server, and so is the Activity log of who changed what. Phones linked to the shop send orders, see their status,
                and get your catalogue, content and settings changes when they next open the app.
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

type Session = { id: number; device: string; createdAt: string; lastUsedAt: string; current: boolean };

/** "Chrome on Windows" from a browser's user agent: enough to tell your own devices apart. */
function deviceName(agent: string) {
  const browser = /Edg\//.test(agent) ? 'Edge' : /Chrome\//.test(agent) ? 'Chrome' : /Firefox\//.test(agent) ? 'Firefox' : /Safari\//.test(agent) ? 'Safari' : 'A browser';
  const system = /Android/.test(agent) ? 'Android' : /iPhone|iPad/.test(agent) ? 'iPhone or iPad' : /Windows/.test(agent) ? 'Windows' : /Mac OS/.test(agent) ? 'Mac' : /Linux/.test(agent) ? 'Linux' : '';
  return system ? `${browser} on ${system}` : browser;
}

/** Module 2.6: where you're signed in, and a way to sign the other devices out, for example a lost phone. */
function SignedInDevices() {
  const toast = useToast();
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const load = useCallback(
    () =>
      api<Session[]>('/auth/sessions').then(
        (list) => {
          setSessions(list);
          setFailure(null);
        },
        (error: unknown) => setFailure(error instanceof Error ? error.message : 'Something went wrong.'),
      ),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);

  const signOut = async (session?: Session) => {
    try {
      await api(session ? `/auth/sessions/${session.id}` : '/auth/sessions', 'DELETE');
      toast({ message: session ? `${deviceName(session.device)} is signed out.` : 'Your other devices are signed out.' });
    } catch (error) {
      toast({ tone: 'error', message: error instanceof Error ? error.message : 'Something went wrong.' });
    }
    await load();
  };
  const others = sessions?.filter((session) => !session.current).length ?? 0;

  return (
    <Card aria-labelledby="devices-title">
      <CardHeader
        id="devices-title"
        title="Signed-in devices"
        description="Where you're signed in to this admin. Sign out a device you no longer use or have lost."
        action={
          others > 0 && (
            <Button size="sm" variant="danger-plain" onClick={() => signOut()}>
              Sign Out Other Devices
            </Button>
          )
        }
      />
      {failure ? (
        <p className="card__body notice notice--warning" role="alert">
          {failure}
        </p>
      ) : (
        <ul className="list">
          {sessions?.map((session) => (
            <li key={session.id} className="list-row">
              <div className="list-row__main">
                <p className="list-row__title">
                  {deviceName(session.device)}
                  {session.current && <span className="muted"> · This device</span>}
                </p>
                <p className="list-row__meta">
                  Signed in {formatDateTime(session.createdAt)} · last used {formatRelativeTime(session.lastUsedAt)}
                </p>
              </div>
              {!session.current && (
                <Button size="sm" onClick={() => signOut(session)}>
                  Sign Out
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
