import { ChatCircleTextIcon, ChatsCircleIcon, CheckIcon, LightbulbIcon, StarIcon, WarningCircleIcon } from '@phosphor-icons/react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';

import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Drawer } from '@/components/Drawer';
import { EmptyState } from '@/components/EmptyState';
import { SearchInput, Segmented, SelectField, TextAreaField } from '@/components/Field';
import { PageHeader } from '@/components/PageHeader';
import { Stat } from '@/components/Stat';
import { useToast } from '@/components/useToast';
import { whatsappLink } from '@/data/orders';
import { FEEDBACK_CHANGED } from '@/data/feedback';
import type { AppFeedback } from '@/data/types';
import { api } from '@/lib/api';
import { formatDateTime, formatNumber, formatRelativeTime, plural } from '@/lib/format';

type Show = 'new' | 'problem' | 'suggestion' | 'all' | 'resolved';

const KIND: Record<AppFeedback['kind'], { label: string; tone: 'danger' | 'info' | 'neutral' }> = {
  problem: { label: 'Problem', tone: 'danger' },
  suggestion: { label: 'Suggestion', tone: 'info' },
  feedback: { label: 'Feedback', tone: 'neutral' },
};
const STATUS: Record<AppFeedback['status'], { label: string; tone: 'warning' | 'neutral' | 'success' }> = {
  new: { label: 'New', tone: 'warning' },
  seen: { label: 'Seen', tone: 'neutral' },
  resolved: { label: 'Resolved', tone: 'success' },
};
/** How many to show before "Show more". */
const PAGE = 40;

function Stars({ rating }: { rating: number }) {
  return (
    <span className="stars" role="img" aria-label={`${rating} of 5 stars`}>
      {[1, 2, 3, 4, 5].map((star) => (
        <StarIcon key={star} size={15} weight={star <= rating ? 'fill' : 'regular'} aria-hidden />
      ))}
    </span>
  );
}

/** What customers say from the app's menu: ratings, problems and ideas. */
export default function FeedbackPage() {
  const toast = useToast();
  const [items, setItems] = useState<AppFeedback[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [show, setShow] = useState<Show>('new');
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [editing, setEditing] = useState<AppFeedback | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [draft, setDraft] = useState<{ status: AppFeedback['status']; staffNote: string }>({ status: 'seen', staffNote: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    api<AppFeedback[]>('/feedback').then(
      (loaded) => {
        if (!active) return;
        setItems(loaded);
        // Nothing new: start on everything, so the page isn't empty.
        if (!loaded.some((item) => item.status === 'new')) setShow('all');
      },
      (error: Error) => active && setLoadError(error.message),
    );
    return () => {
      active = false;
    };
  }, []);

  const all = useMemo(() => items ?? [], [items]);
  const rated = all.filter((item) => item.rating !== null);
  const average = rated.length ? rated.reduce((sum, item) => sum + item.rating!, 0) / rated.length : 0;
  const counts: Record<Show, number> = {
    new: all.filter((item) => item.status === 'new').length,
    problem: all.filter((item) => item.kind === 'problem' && item.status !== 'resolved').length,
    suggestion: all.filter((item) => item.kind === 'suggestion' && item.status !== 'resolved').length,
    all: all.length,
    resolved: all.filter((item) => item.status === 'resolved').length,
  };
  const needle = query.trim().toLowerCase();
  const rows = all.filter(
    (item) =>
      (show === 'all' ? true : show === 'new' ? item.status === 'new' : show === 'resolved' ? item.status === 'resolved' : item.kind === show && item.status !== 'resolved') &&
      (!needle || [item.message, item.staffNote, item.appUser.label, item.appUser.name, item.appUser.business, item.customer?.name ?? '', item.appVersion].some((text) => text.toLowerCase().includes(needle))),
  );

  const change = async (item: AppFeedback, next: { status?: AppFeedback['status']; staffNote?: string }) => {
    try {
      await api(`/feedback/${item.id}`, 'PATCH', next);
      setItems((current) => (current ?? []).map((one) => (one.id === item.id ? { ...one, ...next, handledAt: new Date().toISOString() } : one)));
      window.dispatchEvent(new Event(FEEDBACK_CHANGED));
      return true;
    } catch (error) {
      toast({ tone: 'error', message: `${error instanceof Error ? error.message : 'Something went wrong.'} Your change wasn’t saved.` });
      return false;
    }
  };

  const markAllSeen = async () => {
    const fresh = all.filter((item) => item.status === 'new');
    for (const item of fresh) if (!(await change(item, { status: 'seen' }))) return;
    toast({ message: `${plural(fresh.length, 'item')} marked seen.` });
  };

  const open = (item: AppFeedback) => {
    setEditing(item);
    setDraft({ status: item.status === 'new' ? 'seen' : item.status, staffNote: item.staffNote });
    setDrawerOpen(true);
  };

  const save = async () => {
    if (!editing) return;
    setSaving(true);
    const ok = await change(editing, { status: draft.status, staffNote: draft.staffNote.trim() });
    setSaving(false);
    if (!ok) return;
    setDrawerOpen(false);
    toast({ message: 'Saved.' });
  };

  const who = (item: AppFeedback) => item.customer?.name ?? (item.appUser.name || item.appUser.label);

  return (
    <>
      <PageHeader
        title="Feedback"
        description="What customers send from the app’s menu: ratings, problems and ideas. Each comes with their account, app version and phone."
        actions={
          counts.new > 0 && (
            <Button icon={CheckIcon} onClick={markAllSeen}>
              Mark All Seen
            </Button>
          )
        }
      />

      {items ? (
        <div className="stack-lg">
          <div className="stats">
            <Stat
              label="Average rating"
              icon={StarIcon}
              value={rated.length ? `${average.toFixed(1)} ★` : '—'}
              foot={rated.length ? `From ${plural(rated.length, 'rating')}` : 'No ratings yet'}
            />
            <Stat label="New" icon={ChatsCircleIcon} value={formatNumber(counts.new)} foot={counts.new ? 'Not looked at yet' : 'All caught up'} />
            <Stat label="Open problems" icon={WarningCircleIcon} value={formatNumber(counts.problem)} foot={counts.problem ? <span className="money-late">Reported, not resolved</span> : 'None open'} />
            <Stat label="Open suggestions" icon={LightbulbIcon} value={formatNumber(counts.suggestion)} foot="Ideas from customers" />
          </div>

          {rated.length > 0 && (
            <Card aria-label="Ratings">
              <div className="card__body rating-bars">
                {[5, 4, 3, 2, 1].map((star) => {
                  const count = rated.filter((item) => item.rating === star).length;
                  return (
                    <div key={star} className="rating-bars__row">
                      <span className="num">{star} ★</span>
                      <span className="meter" aria-hidden>
                        <span className="meter__fill" style={{ display: 'block', width: `${(count / rated.length) * 100}%` }} />
                      </span>
                      <span className="num muted">{formatNumber(count)}</span>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          <div>
            <div className="toolbar">
              <Segmented<Show>
                label="Show"
                value={show}
                onChange={(next) => {
                  setShow(next);
                  setLimit(PAGE);
                }}
                options={[
                  { value: 'new', label: 'New', count: counts.new },
                  { value: 'problem', label: 'Problems', count: counts.problem },
                  { value: 'suggestion', label: 'Suggestions', count: counts.suggestion },
                  { value: 'all', label: 'All', count: counts.all },
                  { value: 'resolved', label: 'Resolved', count: counts.resolved },
                ]}
              />
              <SearchInput label="Search feedback" placeholder="Words, customer or app version" value={query} onChange={setQuery} />
            </div>

            <Card>
              {rows.length ? (
                <ul className="list feedback-list">
                  {rows.slice(0, limit).map((item) => (
                    <li key={item.id} className="feedback-item">
                      <div className="row-wrap" style={{ gap: 8 }}>
                        {item.rating !== null && <Stars rating={item.rating} />}
                        <Badge tone={KIND[item.kind].tone}>{KIND[item.kind].label}</Badge>
                        <Badge tone={STATUS[item.status].tone}>{STATUS[item.status].label}</Badge>
                        <span className="cell-sub" title={formatDateTime(item.createdAt)}>
                          {formatRelativeTime(item.createdAt)}
                        </span>
                      </div>
                      {item.message ? <p className="feedback-item__message">{item.message}</p> : <p className="muted feedback-item__message">Rated without a message.</p>}
                      <p className="cell-sub" style={{ margin: 0 }}>
                        {item.customer ? <Link to={`/customers/${item.customer.id}`}>{who(item)}</Link> : who(item)}
                        {item.appUser.business && ` · ${item.appUser.business}`}
                        {item.appUser.phone && ` · ${item.appUser.phone}`}
                        {(item.appVersion || item.platform) && ` · app ${[item.appVersion, item.platform].filter(Boolean).join(', ')}`}
                      </p>
                      {item.staffNote && (
                        <p className="notice" style={{ margin: 0 }}>
                          <ChatCircleTextIcon size={16} weight="bold" aria-hidden />
                          <span>
                            {item.staffNote}
                            {item.handledBy && <span className="muted"> · {item.handledBy}</span>}
                          </span>
                        </p>
                      )}
                      <div className="row-wrap">
                        {item.status === 'new' && (
                          <Button size="sm" onClick={() => void change(item, { status: 'seen' })}>
                            Mark Seen
                          </Button>
                        )}
                        {item.status !== 'resolved' ? (
                          <Button size="sm" icon={CheckIcon} onClick={() => void change(item, { status: 'resolved' })}>
                            Resolve
                          </Button>
                        ) : (
                          <Button size="sm" onClick={() => void change(item, { status: 'seen' })}>
                            Reopen
                          </Button>
                        )}
                        <Button size="sm" variant="plain" onClick={() => open(item)}>
                          {item.staffNote ? 'Edit Note' : 'Add Note'}
                        </Button>
                        {item.appUser.phone && (
                          <a className="btn btn--plain btn--sm" href={whatsappLink(item.appUser.phone)} target="_blank" rel="noreferrer">
                            Reply on WhatsApp
                          </a>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState icon={ChatsCircleIcon} title={needle ? 'Nothing matches' : all.length ? 'Nothing here' : 'No feedback yet'}>
                  {needle ? 'Try other words or a customer’s name.' : all.length ? 'Pick another view above.' : 'Customers send it from Feedback in the app’s menu.'}
                </EmptyState>
              )}
              {rows.length > limit && (
                <div className="card__body" style={{ textAlign: 'center' }}>
                  <Button onClick={() => setLimit((current) => current + PAGE)}>Show {formatNumber(Math.min(PAGE, rows.length - limit))} More</Button>
                </div>
              )}
            </Card>
          </div>
        </div>
      ) : (
        <Card>
          <EmptyState icon={ChatsCircleIcon} title={loadError ? 'Couldn’t load feedback' : 'Loading feedback…'}>
            {loadError}
          </EmptyState>
        </Card>
      )}

      <Drawer
        open={drawerOpen}
        title="Note and status"
        description={editing ? `${KIND[editing.kind].label} from ${who(editing)}` : undefined}
        dirty={Boolean(editing && (draft.staffNote.trim() !== editing.staffNote || draft.status !== editing.status))}
        onClose={() => setDrawerOpen(false)}
        onSubmit={save}
        footer={
          <>
            <Button onClick={() => setDrawerOpen(false)}>Cancel</Button>
            <Button type="submit" variant="primary" loading={saving}>
              Save
            </Button>
          </>
        }
      >
        {editing && (
          <div className="stack">
            {editing.message && <p className="feedback-item__message">{editing.message}</p>}
            <SelectField
              label="Status"
              value={draft.status}
              onChange={(event) => setDraft({ ...draft, status: event.target.value as AppFeedback['status'] })}
              options={[
                { value: 'new', label: 'New' },
                { value: 'seen', label: 'Seen' },
                { value: 'resolved', label: 'Resolved' },
              ]}
            />
            <TextAreaField label="Note" value={draft.staffNote} onChange={(event) => setDraft({ ...draft, staffNote: event.target.value })} rows={4} maxLength={2000} placeholder="e.g. Called them; fixed in app 1.4.1" hint="Only staff see it." />
          </div>
        )}
      </Drawer>
    </>
  );
}
