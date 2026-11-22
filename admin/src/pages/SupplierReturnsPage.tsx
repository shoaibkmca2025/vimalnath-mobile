import { DownloadSimpleIcon, PlusIcon, StorefrontIcon } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';

import { Button, ButtonLink } from '@/components/Button';
import { Card } from '@/components/Card';
import { DataTable, type Column } from '@/components/DataTable';
import { EmptyState } from '@/components/EmptyState';
import { SearchInput, Segmented } from '@/components/Field';
import { PageHeader } from '@/components/PageHeader';
import { SupplierReturnStatusBadge } from '@/components/ReturnParts';
import { dayLabel } from '@/data/payments';
import { formatMoney } from '@/data/purchases';
import { SUPPLIER_REASONS, SUPPLIER_RETURN_STATUS } from '@/data/returns';
import type { SupplierReturn } from '@/data/types';
import { api } from '@/lib/api';
import { downloadCsv } from '@/lib/csv';
import { plural } from '@/lib/format';

type Show = 'open' | 'done' | 'all';

/** Goods sent back to suppliers against their bills. */
export default function SupplierReturnsPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<SupplierReturn[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [show, setShow] = useState<Show>('open');
  const [query, setQuery] = useState('');
  useEffect(() => {
    let active = true;
    api<SupplierReturn[]>('/supplier-returns').then(
      (loaded) => active && setRows(loaded),
      (problem: unknown) => active && setError(problem instanceof Error ? problem.message : 'Couldn’t load supplier returns.'),
    );
    return () => {
      active = false;
    };
  }, []);
  const all = rows ?? [];
  const groups: Record<Show, (one: SupplierReturn) => boolean> = {
    open: (one) => !['closed', 'cancelled'].includes(one.status),
    done: (one) => ['closed', 'cancelled'].includes(one.status),
    all: () => true,
  };
  const needle = query.trim().toLowerCase();
  const shown = all.filter((one) => groups[show](one) && (!needle || [one.number, one.supplier.name, one.purchaseNumber, one.supplierInvoice ?? '', one.challan ?? '', one.creditNoteNumber ?? ''].some((text) => text.toLowerCase().includes(needle))));
  const columns: Column<SupplierReturn>[] = [
    {
      key: 'number',
      header: 'Return',
      sortValue: (one) => one.returnDate + one.number,
      cell: (one) => (
        <>
          <Link to={`/supplier-returns/${one.id}`} className="cell-title num">
            {one.number}
          </Link>
          <div className="cell-sub">{dayLabel(one.returnDate)}</div>
        </>
      ),
    },
    {
      key: 'supplier',
      header: 'Supplier',
      sortValue: (one) => one.supplier.name,
      cell: (one) => (
        <>
          {one.supplier.name}
          <div className="cell-sub num">
            {one.purchaseNumber}
            {one.supplierInvoice ? ` · their bill ${one.supplierInvoice}` : ''}
          </div>
        </>
      ),
    },
    {
      key: 'goods',
      header: 'Goods',
      cell: (one) => (
        <>
          {plural(one.items.length, 'item')}
          <div className="cell-sub">{SUPPLIER_REASONS[one.reason]}</div>
        </>
      ),
    },
    {
      key: 'total',
      header: 'Value',
      align: 'num',
      sortValue: (one) => one.total,
      cell: (one) => (
        <>
          <strong>{formatMoney(one.total)}</strong>
          <div className="cell-sub">{one.creditNoteAmount ? `Credited ${formatMoney(one.creditNoteAmount)}` : 'Not credited yet'}</div>
        </>
      ),
    },
    { key: 'status', header: 'Status', sortValue: (one) => one.status, cell: (one) => <SupplierReturnStatusBadge status={one.status} /> },
  ];
  return (
    <>
      <PageHeader
        title="Supplier Returns"
        description="Goods sent back against a supplier’s bill. They leave stock when dispatched; the supplier’s credit note lowers what you owe them and your input tax credit."
        crumbs={[{ label: 'Returns', to: '/returns' }]}
        actions={
          <>
            <ButtonLink to="/supplier-returns/new" variant="primary" icon={PlusIcon}>
              New Supplier Return
            </ButtonLink>
            <Button
              icon={DownloadSimpleIcon}
              disabled={!shown.length}
              onClick={() =>
                downloadCsv(
                  'vimalnath-supplier-returns',
                  ['Return', 'Date', 'Supplier', 'Bill', 'Their bill', 'Reason', 'Taxable', 'GST', 'Total', 'Challan', 'Credit note', 'Credited', 'Status'],
                  shown.map((one) => [one.number, one.returnDate, one.supplier.name, one.purchaseNumber, one.supplierInvoice, SUPPLIER_REASONS[one.reason], one.taxable, one.tax, one.total, one.challan, one.creditNoteNumber, one.creditNoteAmount, SUPPLIER_RETURN_STATUS[one.status].label]),
                )
              }
            >
              Export CSV
            </Button>
          </>
        }
      />
      <div className="toolbar">
        <Segmented<Show>
          label="Show"
          value={show}
          onChange={setShow}
          options={[
            { value: 'open', label: 'Open', count: all.filter(groups.open).length },
            { value: 'done', label: 'Closed & cancelled', count: all.filter(groups.done).length },
            { value: 'all', label: 'All', count: all.length },
          ]}
        />
        <SearchInput label="Search supplier returns" placeholder="Return, supplier, bill, challan or credit note" value={query} onChange={setQuery} />
      </div>
      <Card className="table-card">
        <DataTable
          caption="Supplier returns"
          rows={shown}
          columns={columns}
          getRowId={(one) => one.id}
          onRowClick={(one) => navigate(`/supplier-returns/${one.id}`)}
          initialSort={{ key: 'number', direction: 'desc' }}
          resetKey={`${show}|${needle}`}
          empty={
            <EmptyState icon={StorefrontIcon} title={error ? 'Couldn’t load supplier returns' : !rows ? 'Loading…' : needle ? `Nothing matches “${query.trim()}”` : 'No supplier returns'}>
              {error ?? (rows && !needle ? 'Start one from a received purchase bill: damaged, defective or wrong goods go back from the stock they’re in.' : undefined)}
            </EmptyState>
          }
        />
      </Card>
    </>
  );
}
