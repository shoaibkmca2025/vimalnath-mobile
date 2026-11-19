import { CheckCircleIcon, ClockIcon, CurrencyInrIcon, DownloadSimpleIcon, HandCoinsIcon, ReceiptIcon, WalletIcon } from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';

import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { DataTable, type Column } from '@/components/DataTable';
import { EmptyState } from '@/components/EmptyState';
import { SearchInput, Segmented } from '@/components/Field';
import { PageHeader } from '@/components/PageHeader';
import { PaymentDrawer } from '@/components/PaymentDrawer';
import { Stat } from '@/components/Stat';
import { customerOf } from '@/data/orders';
import { PAYMENT_METHODS, accounts, creditDaysOf, dayLabel, isBilled, localDay, type Account } from '@/data/payments';
import type { Order, Payment } from '@/data/types';
import { useData } from '@/data/useData';
import { useDrawerItem } from '@/hooks/useDrawerItem';
import { downloadCsv } from '@/lib/csv';
import { formatINR, formatINRCompact, formatPercent, plural } from '@/lib/format';

type Show = 'overdue' | 'owing' | 'all' | 'received';
type Received = { payment: Payment; order: Order; customer: { key: string; name: string } };

export default function PaymentsPage() {
  const { db } = useData();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const drawer = useDrawerItem<Account>();
  const creditDays = creditDaysOf(db.settings);
  const today = localDay();

  const all = useMemo(() => accounts(db.orders, creditDays, today), [db.orders, creditDays, today]);
  const received = useMemo<Received[]>(
    () =>
      db.orders
        .flatMap((order) => (order.payments ?? []).map((payment) => ({ payment, order, customer: customerOf(order) })))
        .sort((a, b) => b.payment.paidOn.localeCompare(a.payment.paidOn) || b.payment.at.localeCompare(a.payment.at)),
    [db.orders],
  );

  const counts: Record<Show, number> = {
    overdue: all.filter((account) => account.overdueBills > 0).length,
    owing: all.filter((account) => account.remaining > 0).length,
    all: all.length,
    received: received.length,
  };
  const asked = params.get('show') as Show | null;
  const show: Show = asked && asked in counts ? asked : counts.overdue ? 'overdue' : 'owing';
  const setShow = (next: Show) => setParams(next === (counts.overdue ? 'overdue' : 'owing') ? {} : { show: next }, { replace: true });

  const needle = query.trim().toLowerCase();
  const digits = needle.replace(/\D/g, '');
  const matches = (texts: (string | undefined)[], phone?: string) =>
    !needle || texts.some((text) => text?.toLowerCase().includes(needle)) || (digits.length >= 4 && (phone ?? '').replace(/\D/g, '').includes(digits));

  const rows = all.filter(
    (account) =>
      (show === 'overdue' ? account.overdueBills > 0 : show === 'owing' ? account.remaining > 0 : true) &&
      matches([account.name, ...account.unpaid.map((order) => order.number)], account.phone),
  );
  const receivedRows = received.filter(({ payment, order, customer }) => matches([customer.name, order.number, payment.note, payment.by], order.phone));

  const totals = all.reduce(
    (sum, account) => ({ billed: sum.billed + account.billed, paid: sum.paid + account.paid, remaining: sum.remaining + account.remaining, overdue: sum.overdue + account.overdue, overdueBills: sum.overdueBills + account.overdueBills }),
    { billed: 0, paid: 0, remaining: 0, overdue: 0, overdueBills: 0 },
  );
  const bills = db.orders.filter(isBilled).length;

  const columns: Column<Account>[] = [
    {
      key: 'name',
      header: 'Customer',
      sortValue: (account) => account.name,
      cell: (account) => (
        <>
          <Link to={`/customers/${account.key}`} className="cell-title">
            {account.name}
          </Link>
          <div className="cell-sub">{account.phone ?? 'No phone given'}</div>
        </>
      ),
    },
    {
      key: 'remaining',
      header: 'Remaining',
      align: 'num',
      sortValue: (account) => account.remaining,
      cell: (account) => (
        <>
          <span style={{ fontWeight: 600 }}>{formatINR(account.remaining)}</span>
          <div className="cell-sub">{account.remaining ? `${plural(account.unpaid.length, 'bill')} unpaid` : 'All paid'}</div>
        </>
      ),
    },
    {
      key: 'overdue',
      header: 'Overdue',
      align: 'num',
      sortValue: (account) => account.overdue,
      cell: (account) =>
        account.overdue ? (
          <>
            <span className="money-late">{formatINR(account.overdue)}</span>
            <div className="cell-sub">{plural(account.mostLate, 'day')} late</div>
          </>
        ) : (
          <span className="muted">—</span>
        ),
    },
    { key: 'billed', header: 'Billed', align: 'num', sortValue: (account) => account.billed, cell: (account) => formatINR(account.billed) },
    { key: 'paid', header: 'Paid', align: 'num', sortValue: (account) => account.paid, cell: (account) => formatINR(account.paid) },
    {
      key: 'last',
      header: 'Last payment',
      sortValue: (account) => account.lastPaid ?? '',
      cell: (account) => (account.lastPaid ? <span className="num">{dayLabel(account.lastPaid)}</span> : <span className="muted">None yet</span>),
    },
    {
      key: 'actions',
      header: 'Actions',
      hideHeader: true,
      align: 'actions',
      cell: (account) => (
        <Button size="sm" icon={HandCoinsIcon} disabled={!account.remaining} onClick={() => drawer.show(account)}>
          Record Payment
        </Button>
      ),
    },
  ];

  const receivedColumns: Column<Received>[] = [
    { key: 'day', header: 'Paid on', sortValue: ({ payment }) => `${payment.paidOn} ${payment.at}`, cell: ({ payment }) => <span className="num">{dayLabel(payment.paidOn)}</span> },
    {
      key: 'customer',
      header: 'Customer',
      sortValue: ({ customer }) => customer.name,
      cell: ({ customer, order }) => (
        <>
          <Link to={`/customers/${customer.key}`} className="cell-title">
            {customer.name}
          </Link>
          <div className="cell-sub">
            <Link to={`/orders/${order.id}`} className="num">
              {order.number}
            </Link>
          </div>
        </>
      ),
    },
    {
      key: 'method',
      header: 'Paid by',
      sortValue: ({ payment }) => payment.method,
      cell: ({ payment }) => (
        <>
          {PAYMENT_METHODS[payment.method]}
          {payment.note && <div className="cell-sub" style={{ whiteSpace: 'normal' }}>{payment.note}</div>}
        </>
      ),
    },
    { key: 'by', header: 'Recorded by', sortValue: ({ payment }) => payment.by, cell: ({ payment }) => payment.by },
    { key: 'amount', header: 'Amount', align: 'num', sortValue: ({ payment }) => payment.amount, cell: ({ payment }) => <span style={{ fontWeight: 600 }}>{formatINR(payment.amount)}</span> },
  ];

  const exportRows = () =>
    show === 'received'
      ? downloadCsv(
          'vimalnath-payments-received',
          ['Paid on', 'Customer', 'Order', 'Paid by', 'Note', 'Recorded by', 'Amount'],
          receivedRows.map(({ payment, order, customer }) => [payment.paidOn, customer.name, order.number, PAYMENT_METHODS[payment.method], payment.note, payment.by, payment.amount]),
        )
      : downloadCsv(
          'vimalnath-payments-due',
          ['Customer', 'Phone', 'Unpaid bills', 'Billed', 'Paid', 'Remaining', 'Overdue', 'Days late', 'Last payment'],
          rows.map((account) => [account.name, account.phone, account.unpaid.map((order) => order.number).join(' '), account.billed, account.paid, account.remaining, account.overdue, account.mostLate || '', account.lastPaid]),
        );

  const empty = {
    overdue: { title: 'Nothing overdue', body: `Every delivered bill is paid or still inside its ${plural(creditDays, 'day')}.` },
    owing: { title: 'Nobody owes anything', body: 'Every bill is paid.' },
    all: { title: 'No bills yet', body: 'Orders appear here once they’re placed.' },
    received: { title: 'No payments yet', body: 'Record one from a customer or an order.' },
  }[show];

  return (
    <>
      <PageHeader
        title="Payments"
        description={`What each customer owes. Credit orders fall due ${plural(creditDays, 'day')} after delivery and cash orders on delivery; unpaid after that, they’re overdue. Cancelled orders are left out.`}
        actions={
          <Button icon={DownloadSimpleIcon} disabled={show === 'received' ? !receivedRows.length : !rows.length} onClick={exportRows}>
            Export CSV
          </Button>
        }
      />

      <div className="stack-lg">
        <div className="stats">
          <Stat label="Billed" icon={ReceiptIcon} value={formatINRCompact(totals.billed)} title={formatINR(totals.billed)} foot={`${plural(bills, 'order')}, cancelled left out`} />
          <Stat label="Received" icon={CheckCircleIcon} value={formatINRCompact(totals.paid)} title={formatINR(totals.paid)} foot={`${formatPercent(totals.paid, totals.billed)} of what’s billed`} />
          <Stat label="Remaining" icon={WalletIcon} value={formatINRCompact(totals.remaining)} title={formatINR(totals.remaining)} foot={`Owed by ${plural(counts.owing, 'customer')}`} />
          <Stat
            label="Overdue"
            icon={ClockIcon}
            value={formatINRCompact(totals.overdue)}
            title={formatINR(totals.overdue)}
            foot={totals.overdueBills ? <span className="money-late">{`${plural(totals.overdueBills, 'bill')} past due`}</span> : 'Nothing past due'}
          />
        </div>

        <div>
          <div className="toolbar">
            <Segmented<Show>
              label="Show"
              value={show}
              onChange={setShow}
              options={[
                { value: 'overdue', label: 'Overdue', count: counts.overdue },
                { value: 'owing', label: 'Owe money', count: counts.owing },
                { value: 'all', label: 'All customers', count: counts.all },
                { value: 'received', label: 'Received', count: counts.received },
              ]}
            />
            <SearchInput label="Search payments" placeholder="Customer, phone or order number" value={query} onChange={setQuery} />
          </div>

          <Card className="table-card">
            {show === 'received' ? (
              <DataTable
                caption="Payments received"
                rows={receivedRows}
                columns={receivedColumns}
                getRowId={({ payment }) => payment.id}
                onRowClick={({ order }) => navigate(`/orders/${order.id}`)}
                resetKey={query}
                initialSort={{ key: 'day', direction: 'desc' }}
                empty={<EmptyState icon={CurrencyInrIcon} title={needle ? 'No payments match' : empty.title}>{needle ? 'Try another name, phone or order number.' : empty.body}</EmptyState>}
              />
            ) : (
              <DataTable
                key={show}
                caption={show === 'overdue' ? 'Customers with overdue bills' : show === 'owing' ? 'Customers who owe money' : 'Customers with bills'}
                rows={rows}
                columns={columns}
                getRowId={(account) => account.key}
                onRowClick={(account) => navigate(`/customers/${account.key}`)}
                resetKey={query}
                initialSort={{ key: show === 'overdue' ? 'overdue' : 'remaining', direction: 'desc' }}
                empty={<EmptyState icon={WalletIcon} title={needle ? 'No customers match' : empty.title}>{needle ? 'Try another name, phone or order number.' : empty.body}</EmptyState>}
              />
            )}
          </Card>
        </div>
      </div>

      {drawer.item && <PaymentDrawer open={drawer.open} onClose={drawer.close} customer={drawer.item.name} orders={drawer.item.unpaid} logTo={`/customers/${drawer.item.key}`} />}
    </>
  );
}
