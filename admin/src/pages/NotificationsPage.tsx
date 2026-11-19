import { BellIcon, DeviceMobileIcon, EnvelopeSimpleIcon, InfoIcon, MegaphoneIcon } from '@phosphor-icons/react';
import { useCallback, useEffect, useState } from 'react';

import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Card, CardHeader } from '@/components/Card';
import { ConfirmDialog } from '@/components/Dialog';
import { EmptyState } from '@/components/EmptyState';
import { TextAreaField, TextField } from '@/components/Field';
import { PageHeader } from '@/components/PageHeader';
import { useToast } from '@/components/useToast';
import type { Tone } from '@/data/orders';
import { api } from '@/lib/api';
import { formatDateTime, plural } from '@/lib/format';

type Template = { event: string; channel: 'push' | 'email'; title: string; body: string };
type Sent = { id: number; event: string; channel: 'push' | 'email'; recipient: string; appUser: string; orderNumber: string | null; title: string; status: 'pending' | 'sent' | 'failed' | 'skipped'; attempts: number; error: string | null; createdAt: string };
type Page = { setup: { email: boolean }; templates: Template[]; recipients: string[]; log: Sent[] };

const EVENT_NAME: Record<string, string> = {
  placed: 'New order, email to staff',
  confirmed: 'Order confirmed, push to the customer',
  dispatched: 'Order dispatched, push to the customer',
  delivered: 'Order delivered, push to the customer',
  cancelled: 'Order cancelled, push to the customer',
};
const STATUS: Record<Sent['status'], { label: string; tone: Tone }> = {
  sent: { label: 'Sent', tone: 'success' },
  pending: { label: 'Sending', tone: 'info' },
  failed: { label: 'Failed', tone: 'danger' },
  skipped: { label: 'Not set up', tone: 'warning' },
};

/** Module 10: who hears about orders, in what words, and what was actually sent. Owners only. */
export default function NotificationsPage() {
  const toast = useToast();
  const [page, setPage] = useState<Page | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [emails, setEmails] = useState('');
  const [templates, setTemplates] = useState<Template[]>([]);
  const [broadcast, setBroadcast] = useState({ title: '', body: '' });
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<{ form: string; message: string } | null>(null);

  const load = useCallback(
    () =>
      api<Page>('/notifications').then(
        (loaded) => {
          setPage(loaded);
          setEmails(loaded.recipients.join('\n'));
          setTemplates(loaded.templates);
          setFailure(null);
        },
        (problem: unknown) => setFailure(problem instanceof Error ? problem.message : 'Something went wrong.'),
      ),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);

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
  if (!page) return null;

  return (
    <>
      <PageHeader title="Notifications" description="New-order emails to staff, order updates on customers’ phones, and a record of everything sent." />

      <div className="stack-lg" style={{ maxWidth: 820 }}>
        <p className="notice">
          <InfoIcon size={16} weight="bold" aria-hidden />
          <span>
            {page.setup.email ? 'Staff emails are on.' : 'Staff emails are off: the server has no email login yet. Add SMTP_URL to its settings (see server/.env.example); until then they show as “Not set up” below.'}{' '}
            Every order update and message appears on the app’s Notifications screen. Phones also get them as notifications once the app is built with your Expo (EAS) project and the customer allows them.
          </span>
        </p>

        <Card aria-labelledby="recipients-title">
          <CardHeader id="recipients-title" title="New-order emails" description="Who gets an email when an order arrives from the app." />
          <div className="card__body stack">
            <TextAreaField label="Send to" rows={3} value={emails} onChange={(event) => setEmails(event.target.value)} placeholder={'orders@vimalnath.in\nowner@vimalnath.in'} hint="One address per line, up to 10." error={errorFor('recipients')} />
            <div>
              <Button variant="primary" icon={EnvelopeSimpleIcon} onClick={() => save('recipients', () => api('/notifications/recipients', 'PUT', { emails: addresses }), addresses.length ? `New-order emails go to ${plural(addresses.length, 'address', 'addresses')}.` : 'New-order emails are off.')}>
                Save Addresses
              </Button>
            </div>
          </div>
        </Card>

        <Card aria-labelledby="wording-title">
          <CardHeader id="wording-title" title="Message wording" description="Filled in for each order: {number}, {customer}, {total} and {items}." />
          <div className="card__body stack-lg">
            {templates.map((template, index) => (
              <fieldset key={template.event} className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
                <legend className="field__label">{EVENT_NAME[template.event] ?? template.event}</legend>
                <TextField label="Title" value={template.title} maxLength={100} onChange={(event) => setTemplates((current) => current.map((item, i) => (i === index ? { ...item, title: event.target.value } : item)))} />
                <TextAreaField label="Message" rows={2} value={template.body} maxLength={400} onChange={(event) => setTemplates((current) => current.map((item, i) => (i === index ? { ...item, body: event.target.value } : item)))} />
              </fieldset>
            ))}
            {errorFor('wording') && (
              <p className="field__error" role="alert">
                {errorFor('wording')}
              </p>
            )}
            <div>
              <Button variant="primary" onClick={() => save('wording', () => api('/notifications/templates', 'PUT', { templates }), 'Message wording saved. New messages use it.')}>
                Save Wording
              </Button>
            </div>
          </div>
        </Card>

        <Card aria-labelledby="broadcast-title">
          <CardHeader id="broadcast-title" title="Message every app user" description="For news everyone should hear, like a new price list. Every app user sees it on the app’s Notifications screen; phones that take notifications also get it as one." />
          <div className="card__body stack">
            <TextField label="Title" value={broadcast.title} maxLength={100} onChange={(event) => setBroadcast({ ...broadcast, title: event.target.value })} placeholder="e.g. New price list" />
            <TextAreaField label="Message" rows={2} value={broadcast.body} maxLength={400} onChange={(event) => setBroadcast({ ...broadcast, body: event.target.value })} placeholder="e.g. The Feb 2027 Taiton prices are now in the app." error={errorFor('broadcast')} />
            <div>
              <Button icon={MegaphoneIcon} disabled={!broadcast.title.trim() || !broadcast.body.trim()} onClick={() => setConfirming(true)}>
                Send to All App Users
              </Button>
            </div>
          </div>
        </Card>

        <Card aria-labelledby="log-title">
          <CardHeader id="log-title" title="Delivery log" description="The newest 300 messages: what was sent, to whom, and whether it arrived." />
          {page.log.length === 0 ? (
            <EmptyState icon={BellIcon} title="Nothing sent yet">
              Messages appear here as orders arrive and move on.
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
                      {[sent.channel === 'email' ? `Email to ${sent.recipient}` : `${sent.recipient ? 'Push' : 'App'} to ${sent.appUser || 'an app user'}`, sent.orderNumber, formatDateTime(sent.createdAt)].filter(Boolean).join(' · ')}
                    </p>
                    {sent.error && sent.status !== 'sent' && (
                      <p className="field__error" style={{ display: 'block' }}>
                        {sent.error}
                      </p>
                    )}
                  </div>
                  {/* No push address (e.g. the web app): nothing to set up, it waits on the app's Notifications screen. */}
                  {sent.channel === 'push' && !sent.recipient ? <Badge tone="neutral">In app only</Badge> : <Badge tone={STATUS[sent.status].tone}>{STATUS[sent.status].label}</Badge>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <ConfirmDialog
        open={confirming}
        title="Send to every app user?"
        body={`“${broadcast.title.trim()}” goes to every app user, on their Notifications screen and as a notification where their phone takes them. It can’t be called back.`}
        confirmLabel="Send"
        onCancel={() => setConfirming(false)}
        onConfirm={async () => {
          setConfirming(false);
          setError(null);
          try {
            const { queued, users } = await api<{ queued: number; users: number }>('/notifications/broadcast', 'POST', { title: broadcast.title.trim(), body: broadcast.body.trim() });
            toast({ message: users ? `Sent to ${plural(users, 'app user')}${queued ? `, ${plural(queued, 'phone')} as a notification` : ''}.` : 'No app users yet, so nothing was sent.' });
            setBroadcast({ title: '', body: '' });
            await load();
          } catch (problem) {
            setError({ form: 'broadcast', message: problem instanceof Error ? problem.message : 'Something went wrong.' });
          }
        }}
      />
    </>
  );
}
