import { DownloadSimpleIcon, UsersThreeIcon } from '@phosphor-icons/react';
import { useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';

import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { DataTable, type Column } from '@/components/DataTable';
import { EmptyState } from '@/components/EmptyState';
import { SearchInput } from '@/components/Field';
import { PageHeader } from '@/components/PageHeader';
import { customersFromOrders, type Customer } from '@/data/orders';
import { useData } from '@/data/useData';
import { downloadCsv } from '@/lib/csv';
import { formatDate, formatINR, formatNumber, formatRelativeDay, initials, plural } from '@/lib/format';

export default function CustomersPage() {
  const { db } = useData();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const query = params.get('q') ?? '';

  const customers = useMemo(() => customersFromOrders(db.orders), [db.orders]);
  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const digits = needle.replace(/\D/g, '');
    return needle
      ? customers.filter((customer) => customer.name.toLowerCase().includes(needle) || (digits.length >= 4 && (customer.phone ?? '').replace(/\D/g, '').includes(digits)))
      : customers;
  }, [customers, query]);

  const columns: Column<Customer>[] = [
    {
      key: 'name',
      header: 'Customer',
      sortValue: (customer) => customer.name,
      cell: (customer) => (
        <div className="row" style={{ gap: 'var(--space-3)' }}>
          <span className="avatar" aria-hidden>
            {initials(customer.name)}
          </span>
          <span>
            <Link to={`/customers/${customer.key}`} className="cell-title">
              {customer.name}
            </Link>
            <span className="cell-sub" style={{ display: 'block' }}>
              {customer.phone ?? 'No phone given'}
            </span>
          </span>
        </div>
      ),
    },
    { key: 'orders', header: 'Orders', align: 'num', sortValue: (customer) => customer.orders, cell: (customer) => formatNumber(customer.orders) },
    { key: 'open', header: 'Open', align: 'num', sortValue: (customer) => customer.open, cell: (customer) => formatNumber(customer.open) },
    { key: 'spent', header: 'Ordered (MRP)', align: 'num', sortValue: (customer) => customer.spent, cell: (customer) => formatINR(customer.spent) },
    {
      key: 'average',
      header: 'Average order',
      align: 'num',
      sortValue: (customer) => customer.spent / customer.orders,
      cell: (customer) => formatINR(customer.spent / customer.orders),
    },
    { key: 'since', header: 'Customer since', sortValue: (customer) => customer.firstOrder, cell: (customer) => <span className="num">{formatDate(customer.firstOrder)}</span> },
    { key: 'last', header: 'Last order', sortValue: (customer) => customer.lastOrder, cell: (customer) => formatRelativeDay(customer.lastOrder) },
  ];

  const total = rows.reduce((sum, customer) => sum + customer.spent, 0);

  return (
    <>
      <PageHeader
        title="Customers"
        description="Everyone who has ordered through the app. The app asks for a customer or site name and an optional phone, so orders are grouped by that name."
        actions={
          <Button
            icon={DownloadSimpleIcon}
            disabled={!rows.length}
            onClick={() =>
              downloadCsv(
                'vimalnath-customers',
                ['Customer', 'Phone', 'Orders', 'Open orders', 'Ordered (MRP)', 'Customer since', 'Last order'],
                rows.map((customer) => [customer.name, customer.phone, customer.orders, customer.open, customer.spent, customer.firstOrder.slice(0, 10), customer.lastOrder.slice(0, 10)]),
              )
            }
          >
            Export CSV
          </Button>
        }
      />

      <div className="toolbar">
        <SearchInput label="Search customers" placeholder="Name or phone" value={query} onChange={(value) => setParams(value ? { q: value } : {}, { replace: true })} />
        <span className="muted" aria-live="polite">
          {plural(rows.length, 'customer')} · {formatINR(total)} ordered
        </span>
      </div>

      <Card className="table-card">
        <DataTable
          caption="Customers"
          rows={rows}
          columns={columns}
          getRowId={(customer) => customer.key}
          onRowClick={(customer) => navigate(`/customers/${customer.key}`)}
          resetKey={query}
          initialSort={{ key: 'spent', direction: 'desc' }}
          empty={
            <EmptyState icon={UsersThreeIcon} title={customers.length ? 'No customers match' : 'No customers yet'} action={query && <Button onClick={() => setParams({})}>Clear Search</Button>}>
              {customers.length ? 'Try another name or phone number.' : 'Customers appear here once they place an order.'}
            </EmptyState>
          }
        />
      </Card>
    </>
  );
}
