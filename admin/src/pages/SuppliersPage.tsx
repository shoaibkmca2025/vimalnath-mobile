import { ClockIcon, DownloadSimpleIcon, PlusIcon, TruckIcon, UsersThreeIcon, WalletIcon } from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';

import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { DataTable, type Column } from '@/components/DataTable';
import { EmptyState } from '@/components/EmptyState';
import { SearchInput, Segmented } from '@/components/Field';
import { PageHeader } from '@/components/PageHeader';
import { Stat } from '@/components/Stat';
import { SupplierDrawer } from '@/components/SupplierDrawer';
import { dayLabel, localDay } from '@/data/payments';
import { balanceOf, formatMoney, payState } from '@/data/purchases';
import type { Supplier } from '@/data/types';
import { usePurchasing } from '@/hooks/usePurchasing';
import { downloadCsv } from '@/lib/csv';
import { formatNumber, plural } from '@/lib/format';

type Show = 'active' | 'owed' | 'archived';

export default function SuppliersPage() {
  const navigate = useNavigate();
  const { suppliers, purchases, error, keepSupplier } = usePurchasing();
  const [show, setShow] = useState<Show>('active');
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const today = localDay();

  const byId = useMemo(() => new Map((suppliers ?? []).map((supplier) => [supplier.id, supplier])), [suppliers]);
  const overdue = (purchases ?? []).filter((bill) => bill.status === 'received' && payState(bill, byId.get(bill.supplier.id), today).label === 'Overdue');
  const active = (suppliers ?? []).filter((supplier) => !supplier.archived);
  const counts: Record<Show, number> = { active: active.length, owed: active.filter((supplier) => supplier.outstanding > 0).length, archived: (suppliers ?? []).length - active.length };
  const needle = query.trim().toLowerCase();
  const digits = needle.replace(/\D/g, '');
  const rows = (suppliers ?? []).filter(
    (supplier) =>
      (show === 'archived' ? supplier.archived : !supplier.archived && (show === 'active' || supplier.outstanding > 0)) &&
      (!needle ||
        [supplier.name, supplier.company, supplier.contactPerson, supplier.gstin, supplier.state].some((text) => text.toLowerCase().includes(needle)) ||
        (digits.length >= 4 && supplier.phone.replace(/\D/g, '').includes(digits))),
  );
  const owed = active.reduce((sum, supplier) => sum + Math.max(0, supplier.outstanding), 0);

  const columns: Column<Supplier>[] = [
    {
      key: 'name',
      header: 'Supplier',
      sortValue: (supplier) => supplier.name,
      cell: (supplier) => (
        <>
          <Link to={`/suppliers/${supplier.id}`} className="cell-title">
            {supplier.name}
          </Link>
          <div className="cell-sub">{[supplier.company, supplier.contactPerson, supplier.state].filter(Boolean).join(' · ') || 'No details yet'}</div>
        </>
      ),
    },
    { key: 'phone', header: 'Phone', cell: (supplier) => <span className="num">{supplier.phone || '—'}</span> },
    { key: 'gstin', header: 'GSTIN', cell: (supplier) => <span className="mono">{supplier.gstin || '—'}</span> },
    {
      key: 'outstanding',
      header: 'To pay',
      align: 'num',
      sortValue: (supplier) => supplier.outstanding,
      cell: (supplier) =>
        supplier.outstanding < 0 ? (
          <Badge tone="info">Advance {formatMoney(-supplier.outstanding)}</Badge>
        ) : (
          <>
            <span style={{ fontWeight: 600 }}>{formatMoney(supplier.outstanding)}</span>
            {overdue.some((bill) => bill.supplier.id === supplier.id) && <div className="cell-sub money-late">Bills overdue</div>}
          </>
        ),
    },
    {
      key: 'billed',
      header: 'Bought',
      align: 'num',
      sortValue: (supplier) => supplier.billed,
      cell: (supplier) => (
        <>
          {formatMoney(supplier.billed)}
          <div className="cell-sub">{plural(supplier.bills, 'bill')}</div>
        </>
      ),
    },
    { key: 'last', header: 'Last bill', sortValue: (supplier) => supplier.lastPurchase ?? '', cell: (supplier) => (supplier.lastPurchase ? <span className="num">{dayLabel(supplier.lastPurchase)}</span> : <span className="muted">None yet</span>) },
  ];

  return (
    <>
      <PageHeader
        title="Suppliers"
        description="Everyone the shop buys from: contact and GST details, what you’ve bought, and what you still owe them."
        actions={
          <>
            <Button variant="primary" icon={PlusIcon} onClick={() => setAdding(true)}>
              Add Supplier
            </Button>
            <Button
              icon={DownloadSimpleIcon}
              disabled={!rows.length}
              onClick={() =>
                downloadCsv(
                  'vimalnath-suppliers',
                  ['Supplier', 'Company', 'Contact', 'Phone', 'Email', 'GSTIN', 'State', 'Address', 'Payment days', 'Opening balance', 'Bought', 'Paid', 'To pay', 'Last bill'],
                  rows.map((supplier) => [supplier.name, supplier.company, supplier.contactPerson, supplier.phone, supplier.email, supplier.gstin, supplier.state, supplier.address, supplier.paymentDays, supplier.openingBalance, supplier.billed, supplier.paid, supplier.outstanding, supplier.lastPurchase]),
                )
              }
            >
              Export CSV
            </Button>
          </>
        }
      />

      {suppliers && purchases ? (
        <div className="stack-lg">
          <div className="stats">
            <Stat label="Suppliers" icon={UsersThreeIcon} value={formatNumber(active.length)} foot={counts.archived ? `${formatNumber(counts.archived)} archived` : 'None archived'} />
            <Stat label="To pay" icon={WalletIcon} value={formatMoney(owed)} foot={`Owed to ${plural(counts.owed, 'supplier')}`} />
            <Stat
              label="Overdue bills"
              icon={ClockIcon}
              value={formatNumber(overdue.length)}
              foot={overdue.length ? <span className="money-late">{formatMoney(overdue.reduce((sum, bill) => sum + balanceOf(bill), 0))} past their terms</span> : 'Nothing past its terms'}
            />
            <Stat label="Bills" icon={TruckIcon} value={formatNumber(purchases.filter((bill) => bill.status === 'received').length)} foot={`${formatNumber(purchases.filter((bill) => bill.status === 'draft').length)} drafts`} to="/purchases" />
          </div>

          <div>
            <div className="toolbar">
              <Segmented<Show>
                label="Show"
                value={show}
                onChange={setShow}
                options={[
                  { value: 'active', label: 'Active', count: counts.active },
                  { value: 'owed', label: 'To pay', count: counts.owed },
                  { value: 'archived', label: 'Archived', count: counts.archived },
                ]}
              />
              <SearchInput label="Search suppliers" placeholder="Name, company, GSTIN, state or phone" value={query} onChange={setQuery} />
            </div>
            <Card className="table-card">
              <DataTable
                caption="Suppliers"
                rows={rows}
                columns={columns}
                getRowId={(supplier) => String(supplier.id)}
                onRowClick={(supplier) => navigate(`/suppliers/${supplier.id}`)}
                resetKey={`${show}|${query}`}
                initialSort={{ key: show === 'owed' ? 'outstanding' : 'name', direction: show === 'owed' ? 'desc' : 'asc' }}
                empty={
                  <EmptyState icon={UsersThreeIcon} title={needle ? 'No suppliers match' : show === 'archived' ? 'No archived suppliers' : show === 'owed' ? 'Nothing to pay' : 'No suppliers yet'}>
                    {needle ? 'Try another name, GSTIN or phone number.' : show === 'active' ? 'Add the people you buy from, then enter their bills under Purchases.' : null}
                  </EmptyState>
                }
              />
            </Card>
          </div>
        </div>
      ) : (
        <Card>
          <EmptyState icon={UsersThreeIcon} title={error ? 'Couldn’t load suppliers' : 'Loading suppliers…'}>
            {error}
          </EmptyState>
        </Card>
      )}

      <SupplierDrawer
        open={adding}
        supplier={null}
        onClose={() => setAdding(false)}
        onSaved={(saved) => {
          keepSupplier(saved);
          setAdding(false);
          navigate(`/suppliers/${saved.id}`);
        }}
      />
    </>
  );
}
