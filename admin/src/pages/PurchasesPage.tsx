import { CalendarBlankIcon, ClockIcon, DownloadSimpleIcon, FileTextIcon, PlusIcon, TruckIcon, WalletIcon } from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';

import { Badge } from '@/components/Badge';
import { ButtonLink, Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { DataTable, type Column } from '@/components/DataTable';
import { EmptyState } from '@/components/EmptyState';
import { SearchInput, Segmented } from '@/components/Field';
import { PageHeader } from '@/components/PageHeader';
import { Stat } from '@/components/Stat';
import { dayLabel, localDay } from '@/data/payments';
import { PURCHASE_STATUS, balanceOf, formatMoney, paidOf, payState } from '@/data/purchases';
import type { Purchase } from '@/data/types';
import { usePurchasing } from '@/hooks/usePurchasing';
import { downloadCsv } from '@/lib/csv';
import { formatNumber, plural } from '@/lib/format';

type Show = 'draft' | 'unpaid' | 'received' | 'cancelled' | 'all';

export default function PurchasesPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { suppliers, purchases, error } = usePurchasing();
  const [query, setQuery] = useState('');
  const today = localDay();
  const month = today.slice(0, 7);

  const byId = useMemo(() => new Map((suppliers ?? []).map((supplier) => [supplier.id, supplier])), [suppliers]);
  const all = purchases ?? [];
  const received = all.filter((bill) => bill.status === 'received');
  const unpaid = all.filter((bill) => bill.status !== 'cancelled' && balanceOf(bill) > 0);
  const counts: Record<Show, number> = {
    draft: all.filter((bill) => bill.status === 'draft').length,
    unpaid: unpaid.length,
    received: received.length,
    cancelled: all.filter((bill) => bill.status === 'cancelled').length,
    all: all.length,
  };
  const asked = params.get('show') as Show | null;
  const fallback: Show = counts.draft ? 'draft' : 'all';
  const show: Show = asked && asked in counts ? asked : fallback;
  const setShow = (next: Show) => setParams(next === fallback ? {} : { show: next }, { replace: true });

  const needle = query.trim().toLowerCase();
  const rows = all.filter(
    (bill) =>
      (show === 'all' ? true : show === 'unpaid' ? unpaid.includes(bill) : bill.status === show) &&
      (!needle || [bill.number, bill.supplier.name, bill.supplierInvoice ?? '', ...bill.items.map((item) => `${item.name} ${item.code}`)].some((text) => text.toLowerCase().includes(needle))),
  );
  const sum = (bills: Purchase[]) => bills.reduce((total, bill) => total + bill.total, 0);
  const overdue = unpaid.filter((bill) => payState(bill, byId.get(bill.supplier.id), today).label === 'Overdue');

  const columns: Column<Purchase>[] = [
    {
      key: 'number',
      header: 'Bill',
      sortValue: (bill) => bill.number,
      cell: (bill) => (
        <>
          <Link to={`/purchases/${bill.id}`} className="cell-title num">
            {bill.number}
          </Link>
          <div className="cell-sub">{bill.supplierInvoice ? `Their bill ${bill.supplierInvoice}` : 'No bill number'}</div>
        </>
      ),
    },
    {
      key: 'supplier',
      header: 'Supplier',
      sortValue: (bill) => bill.supplier.name,
      cell: (bill) => (
        <>
          {bill.supplier.name}
          <div className="cell-sub">{plural(bill.items.length, 'item')}</div>
        </>
      ),
    },
    { key: 'date', header: 'Bill date', sortValue: (bill) => bill.billDate, cell: (bill) => <span className="num">{dayLabel(bill.billDate)}</span> },
    { key: 'status', header: 'Status', sortValue: (bill) => bill.status, cell: (bill) => <Badge tone={PURCHASE_STATUS[bill.status].tone}>{PURCHASE_STATUS[bill.status].label}</Badge> },
    { key: 'total', header: 'Total', align: 'num', sortValue: (bill) => bill.total, cell: (bill) => <span style={{ fontWeight: 600 }}>{formatMoney(bill.total)}</span> },
    {
      key: 'balance',
      header: 'To pay',
      align: 'num',
      sortValue: (bill) => balanceOf(bill),
      cell: (bill) => {
        const state = payState(bill, byId.get(bill.supplier.id), today);
        return (
          <>
            {bill.status === 'cancelled' ? <span className="muted">—</span> : <span className={state.tone === 'danger' ? 'money-late' : undefined}>{formatMoney(balanceOf(bill))}</span>}
            <div className="cell-sub">{state.label}</div>
          </>
        );
      },
    },
  ];

  return (
    <>
      <PageHeader
        title="Purchases"
        description="Bills from your suppliers. A draft can still change; receiving its goods adds them to stock once and locks the bill."
        actions={
          <>
            <ButtonLink to="/purchases/new" variant="primary" icon={PlusIcon}>
              New Purchase
            </ButtonLink>
            <Button
              icon={DownloadSimpleIcon}
              disabled={!rows.length}
              onClick={() =>
                downloadCsv(
                  'vimalnath-purchases',
                  ['Bill', 'Supplier', 'Their bill', 'Bill date', 'Status', 'Items', 'Taxable', 'GST', 'Freight', 'Other charges', 'Discount', 'Round off', 'Total', 'Paid', 'To pay'],
                  rows.map((bill) => [bill.number, bill.supplier.name, bill.supplierInvoice, bill.billDate, PURCHASE_STATUS[bill.status].label, bill.items.length, bill.subtotal, bill.tax, bill.freight, bill.otherCharges, bill.discount, bill.roundOff, bill.total, paidOf(bill), balanceOf(bill)]),
                )
              }
            >
              Export CSV
            </Button>
          </>
        }
      />

      {purchases ? (
        <div className="stack-lg">
          <div className="stats">
            <Stat label="Today’s purchases" icon={CalendarBlankIcon} value={formatMoney(sum(received.filter((bill) => bill.billDate === today)))} foot={plural(received.filter((bill) => bill.billDate === today).length, 'bill received')} />
            <Stat label="This month" icon={TruckIcon} value={formatMoney(sum(received.filter((bill) => bill.billDate.startsWith(month))))} foot={`${plural(received.filter((bill) => bill.billDate.startsWith(month)).length, 'bill')}, received`} />
            <Stat
              label="To pay suppliers"
              icon={WalletIcon}
              value={formatMoney(unpaid.reduce((total, bill) => total + balanceOf(bill), 0))}
              foot={overdue.length ? <span className="money-late">{plural(overdue.length, 'bill')} overdue</span> : `On ${plural(unpaid.length, 'bill')}`}
              to="/suppliers"
            />
            <Stat label="Drafts" icon={FileTextIcon} value={formatNumber(counts.draft)} foot={counts.draft ? 'Goods not received yet' : 'Nothing waiting'} />
          </div>

          <div>
            <div className="toolbar">
              <Segmented<Show>
                label="Show"
                value={show}
                onChange={setShow}
                options={[
                  { value: 'draft', label: 'Drafts', count: counts.draft },
                  { value: 'unpaid', label: 'To pay', count: counts.unpaid },
                  { value: 'received', label: 'Received', count: counts.received },
                  { value: 'cancelled', label: 'Cancelled', count: counts.cancelled },
                  { value: 'all', label: 'All', count: counts.all },
                ]}
              />
              <SearchInput label="Search purchases" placeholder="Bill, supplier, their bill number or item" value={query} onChange={setQuery} />
            </div>
            <Card className="table-card">
              <DataTable
                key={show}
                caption="Purchases"
                rows={rows}
                columns={columns}
                getRowId={(bill) => bill.id}
                onRowClick={(bill) => navigate(`/purchases/${bill.id}`)}
                resetKey={query}
                initialSort={{ key: 'date', direction: 'desc' }}
                empty={
                  <EmptyState icon={TruckIcon} title={needle ? 'No bills match' : all.length ? 'Nothing here' : 'No purchases yet'} action={!all.length && <ButtonLink to="/purchases/new" variant="primary" icon={PlusIcon}>New Purchase</ButtonLink>}>
                    {needle ? 'Try another bill number, supplier or item.' : all.length ? 'Pick another view above.' : 'Enter a supplier’s bill; receiving its goods adds them to stock.'}
                  </EmptyState>
                }
              />
            </Card>
          </div>
        </div>
      ) : (
        <Card>
          <EmptyState icon={ClockIcon} title={error ? 'Couldn’t load purchases' : 'Loading purchases…'}>
            {error}
          </EmptyState>
        </Card>
      )}
    </>
  );
}
