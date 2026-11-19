import { DeviceMobileIcon } from '@phosphor-icons/react';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';

import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { DataTable, type Column } from '@/components/DataTable';
import { Drawer } from '@/components/Drawer';
import { EmptyState } from '@/components/EmptyState';
import { SearchInput, Segmented, Switch, TextField } from '@/components/Field';
import { PageHeader } from '@/components/PageHeader';
import { useToast } from '@/components/useToast';
import type { Tone } from '@/data/orders';
import { useDrawerItem } from '@/hooks/useDrawerItem';
import { api, type ApiError } from '@/lib/api';
import { formatDateTime, formatNumber, formatRelativeTime, plural } from '@/lib/format';

type AppUser = {
  id: number;
  label: string;
  name: string;
  business: string;
  phone: string;
  email: string;
  city: string;
  blocked: boolean;
  lastSeenAt: string | null;
  profileUpdatedAt: string | null;
  createdAt: string;
  orders: number;
  views: number;
};
type Status = 'connected' | 'waiting' | 'blocked';
type Draft = { label: string; blocked: boolean; password: string };

const STATUS: Record<Status, { tone: Tone; label: string }> = {
  connected: { tone: 'success', label: 'Connected' },
  waiting: { tone: 'warning', label: 'Not connected yet' },
  blocked: { tone: 'danger', label: 'Blocked' },
};
const statusOf = (user: AppUser): Status => (user.blocked ? 'blocked' : user.lastSeenAt ? 'connected' : 'waiting');
const draftOf = (item: AppUser | null): Draft => ({ label: item?.label ?? '', blocked: item?.blocked ?? false, password: '' });

function matches(user: AppUser, needle: string) {
  const digits = needle.replace(/\D/g, '');
  return [user.label, user.name, user.business, user.city, user.email].some((text) => text.toLowerCase().includes(needle)) || (digits.length >= 4 && user.phone.replace(/\D/g, '').includes(digits));
}

export default function AppUsersPage() {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const query = params.get('q') ?? '';
  const filter = (params.get('status') as Status | null) ?? 'all';
  const [users, setUsers] = useState<AppUser[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const drawer = useDrawerItem<AppUser>();
  const [draft, setDraft] = useState<Draft>(draftOf(null));
  const [failure, setFailure] = useState<ApiError | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api<AppUser[]>('/app-users').then(setUsers, (error: Error) => setLoadError(error.message));
  }, []);

  const editing = drawer.item;

  const counts = useMemo(() => {
    const all = users ?? [];
    return { all: all.length, connected: all.filter((user) => statusOf(user) === 'connected').length, waiting: all.filter((user) => statusOf(user) === 'waiting').length, blocked: all.filter((user) => user.blocked).length };
  }, [users]);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (users ?? []).filter((user) => (filter === 'all' || statusOf(user) === filter) && (!needle || matches(user, needle)));
  }, [users, query, filter]);

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value && !(key === 'status' && value === 'all')) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const open = (item: AppUser) => {
    setDraft(draftOf(item));
    setFailure(null);
    drawer.show(item);
  };

  const run = async (action: () => Promise<void>) => {
    setSaving(true);
    setFailure(null);
    try {
      await action();
    } catch (error) {
      setFailure(error as ApiError);
    } finally {
      setSaving(false);
    }
  };

  const save = () =>
    run(async () => {
      if (!editing) return;
      const { password, ...change } = draft;
      const updated = await api<AppUser>(`/app-users/${editing.id}`, 'PATCH', password ? { ...change, password } : change);
      setUsers((current) => current!.map((user) => (user.id === updated.id ? updated : user)));
      drawer.close();
      toast({
        message: password
          ? `New password set for ${updated.label}. Their app is logged out until they log in with it.`
          : updated.blocked && !editing.blocked
            ? `${updated.label} is blocked.`
            : `${updated.label} saved.`,
      });
    });

  const columns: Column<AppUser>[] = [
    {
      key: 'label',
      header: 'Customer',
      sortValue: (user) => user.label,
      cell: (user) => (
        <>
          <button type="button" className="cell-title link-reset" onClick={() => open(user)}>
            {user.label}
          </button>
          <div className="cell-sub">{[user.name, user.business].filter(Boolean).join(' · ') || 'No details sent yet'}</div>
        </>
      ),
    },
    {
      key: 'contact',
      header: 'Phone and city',
      sortValue: (user) => user.city,
      cell: (user) => (
        <>
          <span className="num">{user.phone || '—'}</span>
          {user.city && <div className="cell-sub">{user.city}</div>}
        </>
      ),
    },
    { key: 'orders', header: 'Orders sent', align: 'num', sortValue: (user) => user.orders, cell: (user) => formatNumber(user.orders) },
    { key: 'views', header: 'Product views', align: 'num', sortValue: (user) => user.views, cell: (user) => formatNumber(user.views) },
    { key: 'seen', header: 'Last seen', sortValue: (user) => user.lastSeenAt ?? '', cell: (user) => (user.lastSeenAt ? formatRelativeTime(user.lastSeenAt) : 'Never') },
    { key: 'status', header: 'Status', sortValue: statusOf, cell: (user) => <Badge tone={STATUS[statusOf(user)].tone}>{STATUS[statusOf(user)].label}</Badge> },
  ];

  const details: [string, string][] = editing
    ? [
        ['Name', editing.name],
        ['Business', editing.business],
        ['Phone', editing.phone],
        ['Email', editing.email],
        ['City', editing.city],
        ['Details updated', editing.profileUpdatedAt ? formatDateTime(editing.profileUpdatedAt) : 'Not yet'],
        ['Last seen', editing.lastSeenAt ? formatDateTime(editing.lastSeenAt) : 'Never'],
        ['Added', formatDateTime(editing.createdAt)],
      ]
    : [];

  return (
    <>
      <PageHeader
        title="App Users"
        description="Customers who created an account in the app. Their details, orders and product views arrive here. Open one to block it, or to set a new password when they forget theirs."
      />

      {users && (
        <div className="toolbar">
          <SearchInput label="Search app users" placeholder="Name, business, city or phone" value={query} onChange={(value) => setParam('q', value)} />
          <Segmented
            label="Status"
            value={filter}
            onChange={(value) => setParam('status', value)}
            options={[
              { value: 'all', label: 'All', count: counts.all },
              { value: 'connected', label: 'Connected', count: counts.connected },
              { value: 'waiting', label: 'Not connected', count: counts.waiting },
              { value: 'blocked', label: 'Blocked', count: counts.blocked },
            ]}
          />
          <span className="muted" aria-live="polite">
            {plural(rows.length, 'app user')}
          </span>
        </div>
      )}

      <Card className="table-card">
        {users ? (
          <DataTable
            caption="App users"
            rows={rows}
            columns={columns}
            getRowId={(user) => String(user.id)}
            onRowClick={open}
            resetKey={`${query}|${filter}`}
            initialSort={{ key: 'seen', direction: 'desc' }}
            empty={
              <EmptyState
                icon={DeviceMobileIcon}
                title={users.length ? 'No app users match' : 'No app users yet'}
                action={users.length ? <Button onClick={() => setParams({})}>Clear Filters</Button> : null}
              >
                {users.length ? 'Try another name, city or phone number.' : 'Customers show here once they create an account in the app.'}
              </EmptyState>
            }
          />
        ) : (
          <EmptyState icon={DeviceMobileIcon} title={loadError ? 'Couldn’t load app users' : 'Loading app users…'}>
            {loadError}
          </EmptyState>
        )}
      </Card>

      <Drawer
        open={drawer.open}
        title={editing?.label ?? ''}
        description={editing ? STATUS[statusOf(editing)].label : undefined}
        dirty={JSON.stringify(draft) !== JSON.stringify(draftOf(drawer.item))}
        onClose={drawer.close}
        onSubmit={save}
        footer={
          <>
            <Button onClick={drawer.close}>Cancel</Button>
            <Button type="submit" variant="primary" loading={saving}>
              Save
            </Button>
          </>
        }
      >
        <div className="stack">
          <TextField
            label="Who it’s for"
            hint="Only staff see this. It starts as the name they registered with."
            placeholder="Customer or firm name"
            value={draft.label}
            onChange={(event) => setDraft({ ...draft, label: event.target.value })}
            error={failure?.field === 'label' ? failure.message : null}
            required
            autoComplete="off"
          />
          {editing && (
            <>
              <Switch label="Blocked" description="Their app stops syncing straight away and they can’t log in. Orders already received stay here." checked={draft.blocked} onChange={(blocked) => setDraft({ ...draft, blocked })} />
              <TextField
                label="Set new password"
                hint="For a customer who forgot theirs. Leave empty to keep it. Their app logs out; tell them the new one to log in with."
                placeholder="At least 8 characters"
                value={draft.password}
                onChange={(event) => setDraft({ ...draft, password: event.target.value })}
                error={failure?.field === 'password' ? failure.message : null}
                autoComplete="new-password"
                spellCheck={false}
              />
              <dl className="kv kv--compact">
                {details.map(([term, value]) => (
                  <Fragment key={term}>
                    <dt>{term}</dt>
                    <dd>{value || '—'}</dd>
                  </Fragment>
                ))}
                <dt>Received</dt>
                <dd>
                  {plural(editing.orders, 'order')} · {plural(editing.views, 'product view')}
                </dd>
              </dl>
            </>
          )}
          {failure && failure.field !== 'label' && failure.field !== 'password' && (
            <p className="notice notice--warning" role="alert">
              {failure.message}
            </p>
          )}
        </div>
      </Drawer>
    </>
  );
}
