import { ArrowUUpLeftIcon, DownloadSimpleIcon, HandCoinsIcon, HourglassIcon, WarningCircleIcon, WalletIcon } from '@phosphor-icons/react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';

import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Card, CardHeader } from '@/components/Card';
import { DataTable, type Column } from '@/components/DataTable';
import { EmptyState } from '@/components/EmptyState';
import { SearchInput, Segmented } from '@/components/Field';
import { PageHeader } from '@/components/PageHeader';
import { Stat } from '@/components/Stat';
import { dayLabel, localDay } from '@/data/payments';
import { REFUND_METHODS, REFUND_STATUS, RETURN_KIND, goodsBack, isActive, moneyOf } from '@/data/returns';
import type { RefundTransaction, SalesReturn } from '@/data/types';
import { useReturns } from '@/hooks/useReturns';
import { downloadCsv } from '@/lib/csv';
import { formatDate, formatINR, formatNumber, plural } from '@/lib/format';

type Row = RefundTransaction & { ret: SalesReturn };
type Show = 'open' | 'completed' | 'failed' | 'all';

/** Refund Management: what's owed to customers, and every refund and collection with where it stands. */
export default function RefundsPage() {
  const navigate = useNavigate();
  const { returns, error } = useReturns();
  const [show, setShow] = useState<Show>('open');
  const [query, setQuery] = useState('');
  const all = returns ?? [];
  const rows: Row[] = all.flatMap((ret) => (ret.refunds ?? []).map((refund) => ({ ...refund, ret })));
  // Returns with goods back and money still to enter, either way.
  const owed = all.filter((ret) => isActive(ret.status) && goodsBack(ret.status) && (moneyOf(ret).leftOut > 0 || moneyOf(ret).leftIn > 0));
  const groups: Record<Show, (row: Row) => boolean> = {
    open: (row) => ['pending', 'approved', 'processing'].includes(row.status),
    completed: (row) => row.status === 'completed',
    failed: (row) => row.status === 'failed' || row.status === 'cancelled',
    all: () => true,
  };
  const needle = query.trim().toLowerCase();
  const shown = rows.filter((row) => groups[show](row) && (!needle || [row.ret.number, row.ret.customerName, row.reference ?? '', row.orderNumber ?? ''].some((text) => text.toLowerCase().includes(needle))));
  const month = localDay().slice(0, 7);
  const refundedThisMonth = rows.filter((row) => row.direction === 'out' && row.status === 'completed' && (row.paidOn ?? '').startsWith(month)).reduce((sum, row) => sum + row.amount, 0);
  const openOut = rows.filter((row) => row.direction === 'out' && groups.open(row)).reduce((sum, row) => sum + row.amount, 0);
  const notEntered = owed.reduce((sum, ret) => sum + moneyOf(ret).leftOut, 0);

  const columns: Column<Row>[] = [
    {
      key: 'return',
      header: 'Return',
      sortValue: (row) => row.ret.number,
      cell: (row) => (
        <>
          <Link to={`/returns/${row.ret.id}`} className="cell-title num">
            {row.ret.number}
          </Link>
          <div className="cell-sub">
            {row.ret.customerName} · {RETURN_KIND[row.ret.kind]}
          </div>
        </>
      ),
    },
    {
      key: 'amount',
      header: 'Amount',
      align: 'num',
      sortValue: (row) => row.amount,
      cell: (row) => (
        <>
          <strong>{formatINR(row.amount)}</strong>
          <div className="cell-sub">{row.direction === 'out' ? 'To the customer' : 'From the customer'}</div>
        </>
      ),
    },
    {
      key: 'method',
      header: 'Method',
      sortValue: (row) => row.method,
      cell: (row) => (
        <>
          {REFUND_METHODS[row.method]}
          {row.orderNumber ? ` (${row.orderNumber})` : ''}
          <div className="cell-sub">{row.reference ?? 'No reference'}</div>
        </>
      ),
    },
    {
      key: 'date',
      header: 'Date',
      sortValue: (row) => row.paidOn ?? row.createdAt,
      cell: (row) => (
        <>
          <span className="num">{row.paidOn ? dayLabel(row.paidOn) : formatDate(row.createdAt)}</span>
          <div className="cell-sub">{row.completedBy ? `Paid by ${row.completedBy}` : `Entered by ${row.createdBy}`}</div>
        </>
      ),
    },
    { key: 'status', header: 'Status', sortValue: (row) => row.status, cell: (row) => <Badge tone={REFUND_STATUS[row.status].tone}>{REFUND_STATUS[row.status].label}</Badge> },
  ];
  const counts = Object.fromEntries((Object.keys(groups) as Show[]).map((key) => [key, rows.filter(groups[key]).length])) as Record<Show, number>;

  return (
    <>
      <PageHeader
        title="Refund Management"
        description="Money owed to customers for returns, and the difference customers pay for dearer replacements. A refund can be split into several, but never past what’s owed."
        crumbs={[{ label: 'Returns', to: '/returns' }]}
        actions={
          <Button
            icon={DownloadSimpleIcon}
            disabled={!shown.length}
            onClick={() =>
              downloadCsv(
                'vimalnath-refunds',
                ['Return', 'Customer', 'Direction', 'Amount', 'Method', 'Order', 'Reference', 'Paid on', 'Status', 'Entered by', 'Completed by'],
                shown.map((row) => [row.ret.number, row.ret.customerName, row.direction === 'out' ? 'Refund' : 'Collected', row.amount, REFUND_METHODS[row.method], row.orderNumber, row.reference, row.paidOn, REFUND_STATUS[row.status].label, row.createdBy, row.completedBy]),
              )
            }
          >
            Export CSV
          </Button>
        }
      />
      {!returns ? (
        <Card>
          <EmptyState icon={HandCoinsIcon} title={error ? 'Couldn’t load refunds' : 'Loading…'}>
            {error}
          </EmptyState>
        </Card>
      ) : (
        <div className="stack-lg">
          <div className="stats">
            <Stat label="Refunded this month" icon={WalletIcon} value={formatINR(refundedThisMonth)} foot="Completed refunds" />
            <Stat label="In progress" icon={HourglassIcon} value={formatINR(openOut)} foot={plural(rows.filter((row) => row.direction === 'out' && groups.open(row)).length, 'refund')} />
            <Stat label="Not entered yet" icon={WarningCircleIcon} value={formatINR(notEntered)} foot={plural(owed.length, 'return')} />
            <Stat label="Failed" icon={ArrowUUpLeftIcon} value={formatNumber(rows.filter((row) => row.status === 'failed').length)} foot="To try again or cancel" />
          </div>

          {owed.length > 0 && (
            <Card aria-labelledby="owed-title" className="table-card">
              <CardHeader id="owed-title" title="Waiting to be settled" description="Goods are back; the money hasn’t been entered yet." />
              <ul className="refund-list card__body">
                {owed.map((ret) => {
                  const money = moneyOf(ret);
                  return (
                    <li key={ret.id} className="refund-list__item">
                      <span>
                        <Link to={`/returns/${ret.id}`} className="cell-title num">
                          {ret.number}
                        </Link>{' '}
                        · {ret.customerName}
                        <div className="cell-sub">{money.leftOut ? `${formatINR(money.leftOut)} to refund` : `${formatINR(money.leftIn)} to collect`}</div>
                      </span>
                      <Button size="sm" onClick={() => navigate(`/returns/${ret.id}`)}>
                        Open
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}

          <div>
            <div className="toolbar">
              <Segmented<Show>
                label="Show"
                value={show}
                onChange={setShow}
                options={[
                  { value: 'open', label: 'In progress', count: counts.open },
                  { value: 'completed', label: 'Completed', count: counts.completed },
                  { value: 'failed', label: 'Failed & cancelled', count: counts.failed },
                  { value: 'all', label: 'All', count: counts.all },
                ]}
              />
              <SearchInput label="Search refunds" placeholder="Return, customer, order or reference" value={query} onChange={setQuery} />
            </div>
            <Card className="table-card">
              <DataTable
                caption="Refunds and collections"
                rows={shown}
                columns={columns}
                getRowId={(row) => row.id}
                onRowClick={(row) => navigate(`/returns/${row.ret.id}`)}
                initialSort={{ key: 'date', direction: 'desc' }}
                resetKey={`${show}|${needle}`}
                empty={<EmptyState icon={HandCoinsIcon} title={needle ? `Nothing matches “${query.trim()}”` : show === 'open' ? 'No refunds in progress' : 'No refunds here'} />}
              />
            </Card>
          </div>
        </div>
      )}
    </>
  );
}

