import { BellIcon, CheckCircleIcon, DeviceMobileIcon, EnvelopeSimpleIcon, GlobeIcon, InfoIcon, MegaphoneIcon, WarningIcon } from '@phosphor-icons/react';
import { useCallback, useEffect, useState } from 'react';

import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Card, CardHeader } from '@/components/Card';
import { ConfirmDialog } from '@/components/Dialog';
import { EmptyState } from '@/components/EmptyState';
import { Segmented, SelectField, Switch, TextAreaField, TextField } from '@/components/Field';
import { PageHeader } from '@/components/PageHeader';
import { useToast } from '@/components/useToast';
import { CATEGORY_LABEL, type InboxCategory } from '@/data/inbox';
import type { Tone } from '@/data/orders';
import { api } from '@/lib/api';
import { formatDateTime, plural } from '@/lib/format';

type Template = { event: string; channel: 'push' | 'email' | 'inbox'; audience: 'customer' | 'staff'; category: InboxCategory; title: string; body: string };
type Sent = { id: number; event: string; channel: 'push' | 'email'; recipient: string; appUser: string; orderNumber: string | null; title: string; status: 'pending' | 'sent' | 'failed' | 'skipped'; attempts: number; error: string | null; createdAt: string; deviceKind: 'fcm' | 'expo' | 'web' | null };
type Reminders = { paymentReminders: boolean; remindDaysBefore: number; overdueEveryDays: number; updatedBy: string | null; updatedAt: string | null };
type Page = { setup: { email: boolean; fcm: boolean }; templates: Template[]; recipients: string[]; log: Sent[]; devices: { kind: 'fcm' | 'expo' | 'web'; phones: number; accounts: number }[]; reminders: Reminders };
type Announcement = { id: number; audience: 'customers' | 'staff'; target: { accountIds?: number[]; roles?: string[] }; category: InboxCategory; title: string; body: string; createdBy: string; createdAt: string; recipients: number; read: number; pushes: { sent: number; failed: number; pending: number; skipped: number } };
type AppUser = { id: number; label: string; name: string; business: string; phone: string; blocked: boolean };

/** What each event is, for the wording list: who hears it, and when. */
const EVENT_NAME: Record<string, string> = {
  placed: 'New order (email and notification center)',
  received: 'Order received',
  requested: 'Order sent to confirm',
  confirmed: 'Order confirmed',
  dispatched: 'Order dispatched',
  delivered: 'Order delivered',
  cancelled: 'Order cancelled',
  order_updated: 'Order bill changed',
  payment_received: 'Payment received',
  payment_due: 'Payment due soon',
  payment_overdue: 'Payment overdue',
  invoice_created: 'Tax invoice ready',
  invoice_updated: 'Tax invoice corrected',
  invoice_paid: 'Paid in full',
  credit_note: 'Credit note',
  return_recorded: 'Return or replacement recorded',
  return_approved: 'Return approved',
  return_rejected: 'Return not approved',
  return_completed: 'Return complete',
  request_answered: 'Customer answered an order request',
  payment_recorded: 'Payment recorded',
  payments_overdue: 'Daily overdue summary',
  low_stock: 'Low stock',
  out_of_stock: 'Out of stock',
  stock_updated: 'Stock counted or adjusted',
  purchase_received: 'Purchase received',
  bill_finalized: 'Counter bill made',
  bill_updated: 'Counter bill corrected',
  bill_paid: 'Counter bill paid in full',
  credit_note_issued: 'Credit note issued',
  discount_request: 'Discount approval asked',
  discount_decided: 'Discount approved or refused',
  return_requested: 'New return or replacement',
  return_decided: 'Return approved or refused',
  return_finished: 'Return complete',
  customer_registered: 'New app account',
  customer_updated: 'Customer changed their profile',
};
const STATUS: Record<Sent['status'], { label: string; tone: Tone }> = {
  sent: { label: 'Sent', tone: 'success' },
  pending: { label: 'Sending', tone: 'info' },
  failed: { label: 'Failed', tone: 'danger' },
  skipped: { label: 'Not set up', tone: 'warning' },
};
const DEVICE: Record<'fcm' | 'expo' | 'web', string> = { fcm: 'Android (Firebase)', expo: 'Android (Expo)', web: 'Web app' };
const ROLES = [
  { value: 'owner', label: 'Owners' },
  { value: 'sales', label: 'Sales' },
  { value: 'inventory', label: 'Inventory' },
  { value: 'accountant', label: 'Accountant' },
  { value: 'catalogue', label: 'Catalogue' },
] as const;
const ANNOUNCE_CATEGORIES: InboxCategory[] = ['announcements', 'system', 'orders', 'payments', 'billing', 'returns'];

type Audience = 'all' | 'chosen' | 'staff';
type Draft = { audience: Audience; accountIds: number[]; roles: string[]; category: InboxCategory; title: string; body: string };
const blank = (): Draft => ({ audience: 'all', accountIds: [], roles: [], category: 'announcements', title: '', body: '' });

/**
 * Notifications (Owners): announcements to customers or staff and what became of them, automatic payment reminders,
 * the wording of every event, new-order emails, and the log of everything sent to phones and inboxes.
 */
export default function NotificationsPage() {
  const toast = useToast();
  const [page, setPage] = useState<Page | null>(null);
  const [history, setHistory] = useState<Announcement[]>([]);
  const [failure, setFailure] = useState<string | null>(null);
  const [emails, setEmails] = useState('');
  const [templates, setTemplates] = useState<Template[]>([]);
  const [reminders, setReminders] = useState<Reminders | null>(null);
  const [draft, setDraft] = useState<Draft>(blank);
  const [users, setUsers] = useState<AppUser[] | null>(null);
  const [userSearch, setUserSearch] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<{ form: string; message: string } | null>(null);
  const [wordingFor, setWordingFor] = useState<'customer' | 'staff'>('customer');

  const load = useCallback(
    () =>
      Promise.all([api<Page>('/notifications'), api<Announcement[]>('/notifications/announcements')]).then(
        ([loaded, announced]) => {
          setPage(loaded);
          setHistory(announced);
          setEmails(loaded.recipients.join('\n'));
          setTemplates(loaded.templates);
          setReminders(loaded.reminders);
          setFailure(null);
        },
        (problem: unknown) => setFailure(problem instanceof Error ? problem.message : 'Something went wrong.'),
      ),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);
  // The app users to choose from, the first time someone chooses.
  useEffect(() => {
    if (draft.audience !== 'chosen' || users) return;
    api<AppUser[]>('/app-users').then(setUsers, () => setUsers([]));
  }, [draft.audience, users]);

  /** Runs a save; a refusal shows beside its form, and the page reloads so the log and lists are current. */
  const save = async (form: string, request: () => Promise<unknown>, done: string) => {
    setError(null);
    try {
      await request();
      toast({ message: done });
      await load();
      return true;
    } catch (problem) {
      setError({ form, message: problem instanceof Error ? problem.message : 'Something went wrong.' });
      return false;
    }
  };
  const addresses = emails.split(/[\s,;]+/).filter(Boolean);
  const errorFor = (form: string) => (error?.form === form ? error.message : null);

  if (failure) return <p className="notice notice--warning">{failure}</p>;
  if (!page || !reminders) return null;

  const phones = page.devices.reduce((sum, row) => sum + row.phones, 0);
  const shownUsers = (users ?? []).filter((user) => !user.blocked && `${user.label} ${user.name} ${user.business} ${user.phone}`.toLowerCase().includes(userSearch.trim().toLowerCase()));
  const ready = draft.title.trim() && draft.body.trim() && (draft.audience !== 'chosen' || draft.accountIds.length) && (draft.audience !== 'staff' || draft.roles.length);
  const audienceText = draft.audience === 'all' ? 'every app user' : draft.audience === 'chosen' ? plural(draft.accountIds.length, 'chosen customer') : `staff (${draft.roles.map((role) => ROLES.find((one) => one.value === role)?.label).join(', ')})`;
  const shownTemplates = templates.filter((template) => template.audience === wordingFor);

  return (
    <>
      <PageHeader title="Notifications" description="Announcements, payment reminders, the wording of every message, and a record of everything sent." />

      <div className="stack-lg" style={{ maxWidth: 860 }}>
        <Card aria-labelledby="setup-title">
          <CardHeader id="setup-title" title="Set-up" />
          <ul className="list">
            <li className="list-row">
              {page.setup.fcm ? <CheckCircleIcon size={20} color="var(--success)" aria-hidden /> : <WarningIcon size={20} color="var(--warning)" aria-hidden />}
              <div className="list-row__main">
                <p className="list-row__title">Android phone alerts (Firebase)</p>
                <p className="list-row__meta">
                  {page.setup.fcm
                    ? 'The server sends alerts to Android phones.'
                    : 'Not set up: the server has no Firebase key (FCM_SERVICE_ACCOUNT). Messages still reach the app’s Notification Center; phones aren’t alerted.'}
                </p>
              </div>
            </li>
            <li className="list-row">
              {page.setup.email ? <CheckCircleIcon size={20} color="var(--success)" aria-hidden /> : <WarningIcon size={20} color="var(--warning)" aria-hidden />}
              <div className="list-row__main">
                <p className="list-row__title">New-order emails</p>
                <p className="list-row__meta">{page.setup.email ? 'Staff emails are on.' : 'Off: the server has no email login (SMTP_URL).'}</p>
              </div>
            </li>
            <li className="list-row">
              <DeviceMobileIcon size={20} aria-hidden />
              <div className="list-row__main">
                <p className="list-row__title">{plural(phones, 'phone')} take alerts</p>
                <p className="list-row__meta">{page.devices.length ? page.devices.map((row) => `${DEVICE[row.kind]}: ${row.phones}`).join(' · ') : 'No phone has allowed alerts yet.'}</p>
              </div>
            </li>
          </ul>
        </Card>

        <Card aria-labelledby="announce-title">
          <CardHeader id="announce-title" title="Send an announcement" description="Shown in each person’s Notification Center, and as a phone alert where they allow it. Important alerts come even to people who turned announcements off." />
          <div className="card__body stack">
            <div className="field">
              <span className="field__label">To</span>
              <Segmented<Audience>
                label="To"
                value={draft.audience}
                onChange={(audience) => setDraft({ ...draft, audience })}
                options={[
                  { value: 'all', label: 'All Customers' },
                  { value: 'chosen', label: 'Chosen Customers' },
                  { value: 'staff', label: 'Staff' },
                ]}
              />
            </div>
            {draft.audience === 'chosen' && (
              <div className="field">
                <TextField label="Find customers" value={userSearch} onChange={(event) => setUserSearch(event.target.value)} placeholder="Name, business or mobile" />
                <p className="field__hint">{plural(draft.accountIds.length, 'customer')} chosen.</p>
                <div className="check-grid" style={{ maxHeight: 220, overflow: 'auto' }}>
                  {users === null ? (
                    <span className="muted">Loading…</span>
                  ) : (
                    shownUsers.slice(0, 200).map((user) => (
                      <label key={user.id} className="check">
                        <input
                          type="checkbox"
                          checked={draft.accountIds.includes(user.id)}
                          onChange={(event) => setDraft({ ...draft, accountIds: event.target.checked ? [...draft.accountIds, user.id] : draft.accountIds.filter((id) => id !== user.id) })}
                        />
                        {user.name || user.label}
                        {user.business && <span className="muted"> · {user.business}</span>}
                      </label>
                    ))
                  )}
                </div>
              </div>
            )}
            {draft.audience === 'staff' && (
              <div className="field">
                <span className="field__label">Roles</span>
                <div className="check-grid">
                  {ROLES.map((role) => (
                    <label key={role.value} className="check">
                      <input type="checkbox" checked={draft.roles.includes(role.value)} onChange={(event) => setDraft({ ...draft, roles: event.target.checked ? [...draft.roles, role.value] : draft.roles.filter((one) => one !== role.value) })} />
                      {role.label}
                    </label>
                  ))}
                </div>
              </div>
            )}
            <SelectField label="Category" value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value as InboxCategory })} options={ANNOUNCE_CATEGORIES.map((value) => ({ value, label: CATEGORY_LABEL[value] }))} hint="Important always alerts; the others follow each person’s choices." />
            <TextField label="Title" value={draft.title} maxLength={100} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="e.g. New price list" />
            <TextAreaField label="Message" rows={3} value={draft.body} maxLength={400} onChange={(event) => setDraft({ ...draft, body: event.target.value })} placeholder="e.g. The Feb 2027 Taiton prices are now in the app." error={errorFor('announce')} />
            <div>
              <Button variant="primary" icon={MegaphoneIcon} disabled={!ready} onClick={() => setConfirming(true)}>
                Send Announcement
              </Button>
            </div>
          </div>
        </Card>

        <Card aria-labelledby="history-title">
          <CardHeader id="history-title" title="Announcements sent" description="Who they went to, how many have read them, and how the phone alerts went." />
          {history.length === 0 ? (
            <EmptyState icon={MegaphoneIcon} title="No announcements yet" />
          ) : (
            <ul className="list">
              {history.map((sent) => (
                <li key={sent.id} className="list-row">
                  {sent.audience === 'staff' ? <GlobeIcon size={20} aria-hidden /> : <MegaphoneIcon size={20} aria-hidden />}
                  <div className="list-row__main">
                    <p className="list-row__title">{sent.title}</p>
                    <p className="list-row__meta">
                      {[
                        sent.audience === 'staff' ? (sent.target.roles ? `Staff: ${sent.target.roles.join(', ')}` : 'All staff') : sent.target.accountIds ? plural(sent.target.accountIds.length, 'chosen customer') : 'All customers',
                        CATEGORY_LABEL[sent.category],
                        `${sent.read} of ${sent.recipients} read`,
                        sent.audience === 'customers' ? `${sent.pushes.sent} alerts sent${sent.pushes.failed ? `, ${sent.pushes.failed} failed` : ''}${sent.pushes.pending ? `, ${sent.pushes.pending} sending` : ''}${sent.pushes.skipped ? `, ${sent.pushes.skipped} not set up` : ''}` : null,
                        `${sent.createdBy}, ${formatDateTime(sent.createdAt)}`,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card aria-labelledby="reminders-title">
          <CardHeader
            id="reminders-title"
            title="Payment reminders"
            description={`The Owner and Accountant get a daily summary of overdue bills. Customers get a reminder before a bill is due and while it’s overdue, once these are on.${reminders.updatedAt ? ` Last changed ${formatDateTime(reminders.updatedAt)} by ${reminders.updatedBy}.` : ''}`}
          />
          <div className="card__body stack">
            <Switch label="Remind customers about payments" description="Off by default, so turning it on doesn’t surprise customers with old bills." checked={reminders.paymentReminders} onChange={(on) => setReminders({ ...reminders, paymentReminders: on })} />
            <div className="form-grid">
              <TextField label="Remind before the due day" suffix="days" inputMode="numeric" value={String(reminders.remindDaysBefore)} onChange={(event) => setReminders({ ...reminders, remindDaysBefore: Number(event.target.value.replace(/\D/g, '')) })} />
              <TextField label="Then, while overdue, every" suffix="days" inputMode="numeric" value={String(reminders.overdueEveryDays)} onChange={(event) => setReminders({ ...reminders, overdueEveryDays: Number(event.target.value.replace(/\D/g, '')) })} error={errorFor('reminders')} />
            </div>
            <div>
              <Button variant="primary" onClick={() => save('reminders', () => api('/notifications/settings', 'PUT', { paymentReminders: reminders.paymentReminders, remindDaysBefore: reminders.remindDaysBefore, overdueEveryDays: reminders.overdueEveryDays }), reminders.paymentReminders ? 'Customer payment reminders are on.' : 'Customer payment reminders are off.')}>
                Save Reminders
              </Button>
            </div>
          </div>
        </Card>

        <Card aria-labelledby="wording-title">
          <CardHeader
            id="wording-title"
            title="Message wording"
            description="Words in {braces} are filled in for each message, e.g. {number}, {customer}, {total}, {amount}."
            action={
              <Segmented<'customer' | 'staff'>
                label="Messages for"
                value={wordingFor}
                onChange={setWordingFor}
                options={[
                  { value: 'customer', label: 'Customers' },
                  { value: 'staff', label: 'Staff' },
                ]}
              />
            }
          />
          <div className="card__body stack-lg">
            {shownTemplates.map((template) => (
              <fieldset key={template.event} className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
                <legend className="field__label">
                  {EVENT_NAME[template.event] ?? template.event} <span className="muted">· {CATEGORY_LABEL[template.category] ?? template.category}</span>
                </legend>
                <TextField label="Title" value={template.title} maxLength={100} onChange={(event) => setTemplates((current) => current.map((item) => (item.event === template.event ? { ...item, title: event.target.value } : item)))} />
                <TextAreaField label="Message" rows={2} value={template.body} maxLength={400} onChange={(event) => setTemplates((current) => current.map((item) => (item.event === template.event ? { ...item, body: event.target.value } : item)))} />
              </fieldset>
            ))}
            {errorFor('wording') && (
              <p className="field__error" role="alert">
                {errorFor('wording')}
              </p>
            )}
            <div>
              <Button variant="primary" onClick={() => save('wording', () => api('/notifications/templates', 'PUT', { templates: templates.map(({ event, title, body }) => ({ event, title, body })) }), 'Message wording saved. New messages use it.')}>
                Save Wording
              </Button>
            </div>
          </div>
        </Card>

        <Card aria-labelledby="recipients-title">
          <CardHeader id="recipients-title" title="New-order emails" description="Who gets an email when an order arrives from the app (the office also sees it in its notification center)." />
          <div className="card__body stack">
            <TextAreaField label="Send to" rows={3} value={emails} onChange={(event) => setEmails(event.target.value)} placeholder={'orders@vimalnath.in\nowner@vimalnath.in'} hint="One address per line, up to 10." error={errorFor('recipients')} />
            <div>
              <Button variant="primary" icon={EnvelopeSimpleIcon} onClick={() => save('recipients', () => api('/notifications/recipients', 'PUT', { emails: addresses }), addresses.length ? `New-order emails go to ${plural(addresses.length, 'address', 'addresses')}.` : 'New-order emails are off.')}>
                Save Addresses
              </Button>
            </div>
          </div>
        </Card>

        <Card aria-labelledby="log-title">
          <CardHeader id="log-title" title="Delivery log" description="The newest 300 phone alerts and emails: what was sent, to whom, and whether it arrived." />
          {page.log.length === 0 ? (
            <EmptyState icon={BellIcon} title="Nothing sent yet">
              Alerts appear here once phones allow them; emails once the server has an email login.
            </EmptyState>
          ) : (
            <ul className="list">
              {page.log.map((sent) => (
                <li key={sent.id} className="list-row">
                  {sent.channel === 'email' ? <EnvelopeSimpleIcon size={20} aria-hidden /> : <DeviceMobileIcon size={20} aria-hidden />}
                  <div className="list-row__main">
                    <p className="list-row__title" style={{ display: 'block' }}>
                      {sent.title}
                    </p>
                    <p className="list-row__meta" style={{ display: 'block' }}>
                      {[
                        sent.channel === 'email' ? `Email to ${sent.recipient}` : `${sent.deviceKind ? DEVICE[sent.deviceKind] : sent.recipient ? 'Phone' : 'App'} · ${sent.appUser || 'an app user'}`,
                        sent.orderNumber,
                        formatDateTime(sent.createdAt),
                        sent.attempts > 1 ? `${sent.attempts} tries` : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                    {sent.error && sent.status !== 'sent' && (
                      <p className="field__error" style={{ display: 'block' }}>
                        {sent.error}
                      </p>
                    )}
                  </div>
                  {sent.channel === 'push' && !sent.recipient ? <Badge tone="neutral">In app only</Badge> : <Badge tone={STATUS[sent.status].tone}>{STATUS[sent.status].label}</Badge>}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <p className="notice">
          <InfoIcon size={16} weight="bold" aria-hidden />
          <span>Every person chooses which kinds of messages alert them (in the app under Settings → Notifications, in the admin from the bell). Old notifications are cleared after 6 months once read, and after a year in any case.</span>
        </p>
      </div>

      <ConfirmDialog
        open={confirming}
        title="Send this announcement?"
        body={`“${draft.title.trim()}” goes to ${audienceText}, in their Notification Center and as a phone alert where they allow it. It can’t be called back.`}
        confirmLabel="Send"
        onCancel={() => setConfirming(false)}
        onConfirm={async () => {
          setConfirming(false);
          setError(null);
          try {
            const body = {
              audience: draft.audience === 'staff' ? 'staff' : 'customers',
              ...(draft.audience === 'chosen' ? { accountIds: draft.accountIds } : {}),
              ...(draft.audience === 'staff' ? { roles: draft.roles } : {}),
              category: draft.category,
              title: draft.title.trim(),
              body: draft.body.trim(),
            };
            const { queued, users: reached } = await api<{ queued: number; users: number }>('/notifications/announce', 'POST', body);
            await api('/activity', 'POST', { area: 'content', summary: `Sent the announcement “${draft.title.trim()}” to ${audienceText}`, to: '/notifications' }).catch(() => null);
            toast({ message: reached ? `Sent to ${plural(reached, 'person', 'people')}${queued ? `, ${plural(queued, 'phone')} alerted` : ''}.` : 'Nobody to send it to yet.' });
            setDraft(blank());
            await load();
          } catch (problem) {
            setError({ form: 'announce', message: problem instanceof Error ? problem.message : 'Something went wrong.' });
          }
        }}
      />
    </>
  );
}
