import { ArchiveIcon, BellIcon, ChatCircleIcon, CurrencyInrIcon, MegaphoneIcon, PackageIcon, ReceiptIcon, ArrowUUpLeftIcon, TrashIcon, UsersThreeIcon, WarningIcon, type Icon } from '@phosphor-icons/react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';

import { Button, IconButton } from '@/components/Button';
import { Card, CardHeader } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { SearchInput, Segmented, SelectField, Switch } from '@/components/Field';
import { PageHeader } from '@/components/PageHeader';
import { useToast } from '@/components/useToast';
import { CATEGORY_LABEL, deleteFromInbox, fetchInbox, readInbox, sinceLabel, type InboxCategory, type InboxItem, type InboxPreferences } from '@/data/inbox';
import { api } from '@/lib/api';
import { formatDateTime, plural } from '@/lib/format';

const ICON: Record<InboxCategory, Icon> = {
  orders: PackageIcon,
  payments: CurrencyInrIcon,
  inventory: ArchiveIcon,
  billing: ReceiptIcon,
  returns: ArrowUUpLeftIcon,
  customers: UsersThreeIcon,
  announcements: MegaphoneIcon,
  system: WarningIcon,
};
type Filter = 'all' | 'unread' | 'read';
const CHOICES: { key: keyof InboxPreferences; label: string; description: string }[] = [
  { key: 'orders_enabled', label: 'Orders', description: 'New orders from the app, and answers to order requests.' },
  { key: 'payments_enabled', label: 'Payments', description: 'Payments recorded, and the daily overdue summary.' },
  { key: 'inventory_enabled', label: 'Stock', description: 'Running low or out, counts, and purchases received.' },
  { key: 'billing_enabled', label: 'Billing', description: 'Counter bills, credit notes and discount approvals.' },
  { key: 'returns_enabled', label: 'Returns', description: 'New returns and replacements, decisions, completion.' },
  { key: 'customers_enabled', label: 'Customers', description: 'New app accounts and profile changes.' },
  { key: 'announcements_enabled', label: 'Announcements', description: 'Messages from the Owner. Important ones always come.' },
];

/**
 * The staff Notification Center: everything this person was told, newest first, a page at a time, with their own
 * choices of what to be told about. A kind turned off still arrives, already read.
 */
export default function InboxPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<Filter>('all');
  const [category, setCategory] = useState<InboxCategory | ''>('');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<InboxItem[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [unread, setUnread] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [choices, setChoices] = useState<InboxPreferences | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const load = useCallback(() => {
    let active = true;
    fetchInbox({ filter, category: category || undefined, q: query || undefined }).then(
      (page) => {
        if (!active) return;
        setItems(page.notifications);
        setNext(page.next);
        setUnread(page.unread);
        setError(null);
      },
      (problem: unknown) => active && setError(problem instanceof Error ? problem.message : 'Couldn’t load notifications.'),
    );
    return () => {
      active = false;
    };
  }, [filter, category, query]);
  useEffect(load, [load]);
  useEffect(() => {
    api<InboxPreferences>('/inbox/preferences').then(setChoices, () => {});
  }, []);

  const loadMore = async () => {
    if (!next) return;
    setMore(true);
    try {
      const page = await fetchInbox({ filter, category: category || undefined, q: query || undefined, before: next });
      setItems((current) => [...(current ?? []), ...page.notifications]);
      setNext(page.next);
    } finally {
      setMore(false);
    }
  };

  const open = (item: InboxItem) => {
    if (!item.read) {
      setItems((current) => current?.map((one) => (one.id === item.id ? { ...one, read: true } : one)) ?? null);
      void readInbox([item.id]).then(setUnread);
    }
    if (item.data.to) navigate(item.data.to);
  };
  const remove = async (item: InboxItem) => {
    setItems((current) => current?.filter((one) => one.id !== item.id) ?? null);
    try {
      setUnread(await deleteFromInbox([item.id]));
    } catch {
      toast({ tone: 'error', message: 'Couldn’t delete it.' });
      load();
    }
  };
  const readAll = async () => {
    setUnread(await readInbox());
    setItems((current) => (filter === 'unread' ? [] : (current?.map((one) => ({ ...one, read: true })) ?? null)));
  };
  const choose = async (key: keyof InboxPreferences, value: boolean) => {
    if (!choices) return;
    const before = choices;
    setChoices({ ...choices, [key]: value });
    try {
      setChoices(await api<InboxPreferences>('/inbox/preferences', 'PUT', { [key]: value }));
    } catch (problem) {
      setChoices(before);
      toast({ tone: 'error', message: problem instanceof Error ? problem.message : 'Couldn’t save that.' });
    }
  };

  const filtered = filter !== 'all' || Boolean(category) || Boolean(query);
  return (
    <>
      <PageHeader
        title="Notification Center"
        description={unread ? `${plural(unread, 'unread notification')}.` : 'Everything is read.'}
        actions={
          unread > 0 && (
            <Button variant="primary" onClick={() => void readAll()}>
              Mark All as Read
            </Button>
          )
        }
      />
      <div className="inbox-layout">
        <div className="stack">
          <div className="toolbar" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <Segmented<Filter>
              label="Show"
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all', label: 'All' },
                { value: 'unread', label: 'Unread' },
                { value: 'read', label: 'Read' },
              ]}
            />
            <SelectField label="Category" value={category} onChange={(event) => setCategory(event.target.value as InboxCategory | '')} options={[{ value: '', label: 'Every kind' }, ...(Object.keys(CATEGORY_LABEL) as InboxCategory[]).map((value) => ({ value, label: CATEGORY_LABEL[value] }))]} />
            <SearchInput label="Search notifications" placeholder="Order, customer, item…" value={search} onChange={setSearch} />
          </div>
          <Card>
            {error && !items ? (
              <EmptyState icon={BellIcon} title="Couldn’t load notifications">
                {error}
              </EmptyState>
            ) : !items ? (
              <EmptyState icon={BellIcon} title="Loading…" />
            ) : items.length === 0 ? (
              <EmptyState icon={filtered ? ChatCircleIcon : BellIcon} title={filtered ? 'Nothing matches' : 'No notifications yet'}>
                {filtered ? 'Try another filter.' : 'New orders, payments, stock alerts, approvals and announcements appear here.'}
              </EmptyState>
            ) : (
              <ul className="list inbox-list">
                {items.map((item) => {
                  const ItemIcon = ICON[item.category] ?? BellIcon;
                  return (
                    <li key={item.id} className={`list-row inbox-row${item.read ? '' : ' is-unread'}`}>
                      <span className={`inbox-icon inbox-icon--${item.category}`} aria-hidden>
                        <ItemIcon size={18} weight="bold" />
                      </span>
                      <button type="button" className="inbox-row__main" onClick={() => open(item)}>
                        <span className="list-row__title">
                          {!item.read && <span className="inbox-dot" aria-label="Unread" />}
                          {item.title}
                        </span>
                        <span className="list-row__meta inbox-row__body">{item.body}</span>
                        <span className="list-row__meta" title={formatDateTime(item.createdAt)}>
                          {CATEGORY_LABEL[item.category]} · {sinceLabel(item.createdAt)}
                        </span>
                      </button>
                      <IconButton icon={TrashIcon} label={`Delete “${item.title}”`} onClick={() => void remove(item)} />
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
          {next && (
            <div>
              <Button loading={more} onClick={() => void loadMore()}>
                Load More
              </Button>
            </div>
          )}
        </div>
        <Card aria-labelledby="choices-title" className="inbox-choices">
          <CardHeader id="choices-title" title="Tell me about" description="Turned off: it still arrives here, already read, so the bell stays quiet." />
          <div className="card__body stack">
            {choices ? CHOICES.map((choice) => <Switch key={choice.key} label={choice.label} description={choice.description} checked={choices[choice.key]} onChange={(on) => void choose(choice.key, on)} />) : <p className="muted">Loading…</p>}
          </div>
        </Card>
      </div>
    </>
  );
}
