import { DownloadSimpleIcon, GitMergeIcon, UsersThreeIcon } from '@phosphor-icons/react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';

import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Card, CardHeader } from '@/components/Card';
import { DataTable, type Column } from '@/components/DataTable';
import { ConfirmDialog } from '@/components/Dialog';
import { EmptyState } from '@/components/EmptyState';
import { SearchInput } from '@/components/Field';
import { PageHeader } from '@/components/PageHeader';
import { useToast } from '@/components/useToast';
import { duplicatePairs, type CustomerRecord, type DuplicatePair } from '@/data/customers';
import { accounts, creditDaysOf } from '@/data/payments';
import { useData } from '@/data/useData';
import { api } from '@/lib/api';
import { downloadCsv } from '@/lib/csv';
import { formatDate, formatINR, formatNumber, formatRelativeDay, initials, plural } from '@/lib/format';

export default function CustomersPage() {
  const { db } = useData();
  const navigate = useNavigate();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const query = params.get('q') ?? '';
  const tag = params.get('tag') ?? '';
  const [customers, setCustomers] = useState<CustomerRecord[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [merging, setMerging] = useState<DuplicatePair | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<CustomerRecord[]>('/customers').then(setCustomers, (error: Error) => setLoadError(error.message));
  }, []);

  // What each customer owes, from the orders this admin has loaded; keyed like customerOf (the customer's id).
  const creditDays = creditDaysOf(db.settings);
  const owed = useMemo(() => new Map(accounts(db.orders, creditDays).map((account) => [account.key, account])), [db.orders, creditDays]);

  const tags = useMemo(() => [...new Set((customers ?? []).flatMap((customer) => customer.tags.map((item) => item.toLowerCase())))].sort(), [customers]);
  const duplicates = useMemo(() => duplicatePairs(customers ?? []), [customers]);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const digits = needle.replace(/\D/g, '');
    return (customers ?? []).filter(
      (customer) =>
        (!tag || customer.tags.some((item) => item.toLowerCase() === tag)) &&
        (!needle ||
          [customer.name, customer.business, customer.city, ...customer.tags].some((text) => text.toLowerCase().includes(needle)) ||
          (digits.length >= 4 && [customer.phone, ...customer.appUsers.map((user) => user.phone)].some((phone) => phone.replace(/\D/g, '').includes(digits)))),
    );
  }, [customers, query, tag]);

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const merge = async () => {
    if (!merging) return;
    setBusy(true);
    try {
      const kept = await api<CustomerRecord>(`/customers/${merging.keep.id}/merge`, 'POST', { from: merging.merge.id });
      setCustomers((current) => current!.filter((customer) => customer.id !== merging.merge.id).map((customer) => (customer.id === kept.id ? kept : customer)));
      toast({ message: `${merging.merge.name} merged into ${kept.name}.` });
      setMerging(null);
    } catch (error) {
      toast({ tone: 'error', message: error instanceof Error ? error.message : 'The merge didn’t work.' });
    } finally {
      setBusy(false);
    }
  };

  const columns: Column<CustomerRecord>[] = [
    {
      key: 'name',
      header: 'Customer',
      sortValue: (customer) => customer.name,
      cell: (customer) => (
        <div className="row" style={{ gap: 'var(--space-3)' }}>
          <span className="avatar" aria-hidden>
            {initials(customer.name)}
          </span>
          <span style={{ minWidth: 0 }}>
            <Link to={`/customers/${customer.id}`} className="cell-title">
              {customer.name}
            </Link>
            <span className="cell-sub" style={{ display: 'block' }}>
              {[customer.business, customer.city].filter(Boolean).join(' · ') || 'No details from their app yet'}
            </span>
            {customer.tags.length > 0 && (
              <span className="row-wrap" style={{ gap: 4, marginTop: 4 }}>
                {customer.tags.map((item) => (
                  <Badge key={item} tone="neutral">
                    {item}
                  </Badge>
                ))}
              </span>
            )}
          </span>
        </div>
      ),
    },
    { key: 'phone', header: 'Phone', cell: (customer) => <span className="num">{customer.phone || '—'}</span> },
    { key: 'orders', header: 'Orders', align: 'num', sortValue: (customer) => customer.orders, cell: (customer) => formatNumber(customer.orders) },
    { key: 'open', header: 'Open', align: 'num', sortValue: (customer) => customer.open, cell: (customer) => formatNumber(customer.open) },
    { key: 'spent', header: 'Ordered (MRP)', align: 'num', sortValue: (customer) => customer.spent, cell: (customer) => formatINR(customer.spent) },
    {
      key: 'remaining',
      header: 'Remaining',
      align: 'num',
      sortValue: (customer) => owed.get(String(customer.id))?.remaining ?? 0,
      cell: (customer) => {
        const account = owed.get(String(customer.id));
        if (!account?.remaining) return <span className="muted">—</span>;
        return (
          <>
            {formatINR(account.remaining)}
            {account.overdue > 0 && <div className="cell-sub money-late">{formatINR(account.overdue)} overdue</div>}
          </>
        );
      },
    },
    { key: 'last', header: 'Last order', sortValue: (customer) => customer.lastOrder ?? '', cell: (customer) => (customer.lastOrder ? formatRelativeDay(customer.lastOrder) : <span className="muted">None yet</span>) },
  ];

  const total = rows.reduce((sum, customer) => sum + customer.spent, 0);

  return (
    <>
      <PageHeader
        title="Customers"
        description="Everyone with the app connected to the shop. Each app user you add starts as a customer; merge them when one customer uses several phones. Totals leave out cancelled orders."
        actions={
          <Button
            icon={DownloadSimpleIcon}
            disabled={!rows.length}
            onClick={() =>
              downloadCsv(
                'vimalnath-customers',
                ['Customer', 'Business', 'Phone', 'Email', 'City', 'Tags', 'Orders', 'Open orders', 'Ordered (MRP)', 'Remaining', 'Overdue', 'Customer since', 'Last order'],
                rows.map((customer) => [
                  customer.name,
                  customer.business,
                  customer.phone,
                  customer.email,
                  customer.city,
                  customer.tags.join(', '),
                  customer.orders,
                  customer.open,
                  customer.spent,
                  owed.get(String(customer.id))?.remaining ?? 0,
                  owed.get(String(customer.id))?.overdue ?? 0,
                  customer.createdAt.slice(0, 10),
                  customer.lastOrder?.slice(0, 10),
                ]),
              )
            }
          >
            Export CSV
          </Button>
        }
      />

      {duplicates.length > 0 && (
        <Card aria-labelledby="duplicates-title" style={{ marginBottom: 'var(--space-4)' }}>
          <CardHeader id="duplicates-title" title="Possible duplicates" description="These look like the same customer. Merging moves the phones and orders across; nothing is deleted." />
          <ul className="list">
            {duplicates.slice(0, 5).map((pair) => (
              <li key={`${pair.keep.id}-${pair.merge.id}`} className="list-row">
                <span className="list-row__main">
                  <span className="list-row__title" style={{ display: 'block' }}>
                    {pair.merge.name} → {pair.keep.name}
                  </span>
                  <span className="list-row__meta">
                    {pair.reason} · {plural(pair.merge.orders, 'order')} {pair.merge.orders === 1 ? 'moves' : 'move'} across
                  </span>
                </span>
                <Button size="sm" icon={GitMergeIcon} onClick={() => setMerging(pair)}>
                  Merge
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {customers && (
        <div className="toolbar">
          <SearchInput label="Search customers" placeholder="Name, business, city, tag or phone" value={query} onChange={(value) => setParam('q', value)} />
          {tags.length > 0 && (
            <>
              <label className="visually-hidden" htmlFor="customer-tag">
                Tag
              </label>
              <select id="customer-tag" className="select" style={{ width: 'auto', minWidth: 160 }} value={tag} onChange={(event) => setParam('tag', event.target.value)}>
                <option value="">All tags</option>
                {tags.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </>
          )}
          <span className="muted" aria-live="polite">
            {plural(rows.length, 'customer')} · {formatINR(total)} ordered
          </span>
        </div>
      )}

      <Card className="table-card">
        {customers ? (
          <DataTable
            caption="Customers"
            rows={rows}
            columns={columns}
            getRowId={(customer) => String(customer.id)}
            onRowClick={(customer) => navigate(`/customers/${customer.id}`)}
            resetKey={`${query}|${tag}`}
            initialSort={{ key: 'spent', direction: 'desc' }}
            empty={
              <EmptyState icon={UsersThreeIcon} title={customers.length ? 'No customers match' : 'No customers yet'} action={(query || tag) && <Button onClick={() => setParams({})}>Clear Filters</Button>}>
                {customers.length ? 'Try another name, city, tag or phone number.' : 'Add an app user under App Users; they appear here as a customer.'}
              </EmptyState>
            }
          />
        ) : (
          <EmptyState icon={UsersThreeIcon} title={loadError ? 'Couldn’t load customers' : 'Loading customers…'}>
            {loadError}
          </EmptyState>
        )}
      </Card>

      <ConfirmDialog
        open={Boolean(merging)}
        title={merging ? `Merge ${merging.merge.name} into ${merging.keep.name}?` : 'Merge customers?'}
        body={
          merging
            ? `${merging.keep.name} keeps its name and gets ${merging.merge.name}’s ${plural(merging.merge.appUsers.length, 'phone')}, ${plural(merging.merge.orders, 'order')}, tags and notes. Customer since ${formatDate(merging.keep.createdAt)}.`
            : ''
        }
        confirmLabel={busy ? 'Merging…' : 'Merge'}
        onCancel={() => setMerging(null)}
        onConfirm={merge}
      />
    </>
  );
}
