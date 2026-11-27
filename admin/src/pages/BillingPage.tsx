import { CalendarBlankIcon, ChartLineUpIcon, CheckCircleIcon, DownloadSimpleIcon, FileTextIcon, HourglassIcon, PlusIcon, ReceiptIcon, WalletIcon, XCircleIcon } from '@phosphor-icons/react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';

import { Badge } from '@/components/Badge';
import { Button, ButtonLink } from '@/components/Button';
import { Card } from '@/components/Card';
import { DataTable, type Column } from '@/components/DataTable';
import { EmptyState } from '@/components/EmptyState';
import { SearchInput, SelectField, TextField } from '@/components/Field';
import { PageHeader } from '@/components/PageHeader';
import { Stat } from '@/components/Stat';
import { PAY_STATUS, balanceOf, billingSummary, type PayStatus } from '@/data/billing';
import { INVOICE_STATUS } from '@/data/gst';
import { dayLabel, localDay } from '@/data/payments';
import { formatMoney } from '@/data/purchases';
import { readSession } from '@/data/session';
import type { SalesInvoice } from '@/data/types';
import { useBilling } from '@/hooks/useBilling';
import { downloadCsv } from '@/lib/csv';
import { formatNumber, plural } from '@/lib/format';

const SOURCE: Record<NonNullable<SalesInvoice['source']>, string> = { counter: 'Counter bill', order: 'App order', replacement: 'Replacement' };

/** The billing dashboard: today's and this month's sales, what's owed, and every bill to search and filter. */
export default function BillingPage() {
  const navigate = useNavigate();
  const { invoices, error } = useBilling();
  const role = readSession()?.role;
  const today = localDay();
  const [query, setQuery] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [pay, setPay] = useState<PayStatus | ''>('');
  const [status, setStatus] = useState<SalesInvoice['status'] | ''>('');
  const [source, setSource] = useState<NonNullable<SalesInvoice['source']> | ''>('');
  const all = invoices ?? [];
  const summary = billingSummary(all, today);
  const needle = query.trim().toLowerCase();
  const rows = all.filter((invoice) => {
    const state = balanceOf(invoice, today);
    return (
      (!needle || [invoice.number ?? '', invoice.customerName, invoice.customerPhone ?? '', invoice.customerGstin ?? '', invoice.orderNumber ?? ''].some((text) => text.toLowerCase().includes(needle))) &&
      (!from || invoice.invoiceDate >= from) &&
      (!to || invoice.invoiceDate <= to) &&
      (!status || invoice.status === status) &&
      (!source || invoice.source === source) &&
      (!pay || (invoice.status === 'posted' && (pay === 'unpaid' ? state.status === 'unpaid' || state.status === 'overdue' : state.status === pay)))
    );
  });
  const filtered = Boolean(needle || from || to || status || source || pay);

  const columns: Column<SalesInvoice>[] = [
    {
      key: 'number',
      header: 'Invoice',
      sortValue: (invoice) => `${invoice.invoiceDate} ${invoice.number ?? ''}`,
      cell: (invoice) => (
        <>
          <Link to={`/billing/${invoice.id}`} className="cell-title num">
            {invoice.number ?? 'Draft'}
          </Link>
          <div className="cell-sub">
            {dayLabel(invoice.invoiceDate)} · {SOURCE[invoice.source ?? 'order']}
          </div>
        </>
      ),
    },
    {
      key: 'customer',
      header: 'Customer',
      sortValue: (invoice) => invoice.customerName,
      cell: (invoice) => (
        <>
          {invoice.customerName}
          <div className="cell-sub">{invoice.customerPhone ?? invoice.customerGstin ?? (invoice.orderNumber ? `Order ${invoice.orderNumber}` : '')}</div>
        </>
      ),
    },
    { key: 'total', header: 'Total', align: 'num', sortValue: (invoice) => invoice.total, cell: (invoice) => <strong>{formatMoney(invoice.total)}</strong> },
    {
      key: 'balance',
      header: 'Balance',
      align: 'num',
      sortValue: (invoice) => balanceOf(invoice, today).balance,
      cell: (invoice) => {
        if (invoice.status !== 'posted' || invoice.paid === undefined) return <span className="muted">—</span>;
        const state = balanceOf(invoice, today);
        return (
          <>
            <span className={state.status === 'overdue' ? 'money-late' : undefined}>{formatMoney(state.balance)}</span>
            <div className="cell-sub">{invoice.dueDate && state.balance > 0 ? `Due ${dayLabel(invoice.dueDate)}` : `Paid ${formatMoney(state.paid)}`}</div>
          </>
        );
      },
    },
    {
      key: 'status',
      header: 'Status',
      sortValue: (invoice) => invoice.status,
      cell: (invoice) => (
        <span className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <Badge tone={INVOICE_STATUS[invoice.status].tone}>{invoice.status === 'draft' && invoice.number ? 'Reopened' : INVOICE_STATUS[invoice.status].label}</Badge>
          {invoice.status === 'posted' && invoice.paid !== undefined && <Badge tone={PAY_STATUS[balanceOf(invoice, today).status].tone}>{PAY_STATUS[balanceOf(invoice, today).status].label}</Badge>}
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Billing"
        description="Counter bills and every tax invoice, in one series. Bills from the app’s orders are here too; their payments are recorded on the order."
        actions={
          <>
            {(role === 'owner' || role === 'sales') && (
              <ButtonLink to="/billing/new" variant="primary" icon={PlusIcon} aria-keyshortcuts="Alt+N">
                New Bill
              </ButtonLink>
            )}
            <Button
              icon={DownloadSimpleIcon}
              disabled={!rows.length}
              onClick={() =>
                downloadCsv(
                  'vimalnath-bills',
                  ['Invoice', 'Date', 'Type', 'Customer', 'Phone', 'GSTIN', 'Taxable', 'CGST', 'SGST', 'IGST', 'Round off', 'Total', 'Paid', 'Balance', 'Due', 'Status'],
                  rows.map((invoice) => {
                    const state = balanceOf(invoice, today);
                    return [
                      invoice.number ?? 'Draft',
                      invoice.invoiceDate,
                      SOURCE[invoice.source ?? 'order'],
                      invoice.customerName,
                      invoice.customerPhone,
                      invoice.customerGstin,
                      invoice.taxable,
                      invoice.cgst,
                      invoice.sgst,
                      invoice.igst,
                      invoice.roundOff,
                      invoice.total,
                      state.paid,
                      state.balance,
                      invoice.dueDate,
                      INVOICE_STATUS[invoice.status].label,
                    ];
                  }),
                )
              }
            >
              Export CSV
            </Button>
          </>
        }
      />
      {!invoices ? (
        <Card>
          <EmptyState icon={ReceiptIcon} title={error ? 'Couldn’t load bills' : 'Loading…'}>
            {error}
          </EmptyState>
        </Card>
      ) : (
        <div className="stack-lg">
          <div className="stats">
            <Stat label="Today’s sales" icon={CalendarBlankIcon} value={formatMoney(summary.today)} foot={plural(summary.todayCount, 'invoice')} />
            <Stat label="This month" icon={ChartLineUpIcon} value={formatMoney(summary.month)} foot={plural(summary.monthCount, 'invoice')} />
            <Stat label="Outstanding" icon={WalletIcon} value={formatMoney(summary.outstanding)} foot={summary.overdue ? <span className="money-late">{plural(summary.overdue, 'bill')} overdue</span> : 'Nothing overdue'} />
            <Stat label="Total invoices" icon={FileTextIcon} value={formatNumber(summary.total)} foot={`${plural(summary.drafts, 'draft')} besides`} />
          </div>
          <div className="stats">
            <Stat label="Paid" icon={CheckCircleIcon} value={formatNumber(summary.paid)} foot="In full" />
            <Stat label="Part paid" icon={HourglassIcon} value={formatNumber(summary.partial)} foot="Something still owed" />
            <Stat label="Unpaid" icon={WalletIcon} value={formatNumber(summary.unpaid)} foot="Nothing received yet" />
            <Stat label="Cancelled" icon={XCircleIcon} value={formatNumber(summary.cancelled)} foot="Kept in the series" />
          </div>
          <div>
            <div className="toolbar" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <SearchInput label="Search bills" placeholder="Invoice number, customer, phone or GSTIN" value={query} onChange={setQuery} />
              <TextField label="From" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
              <TextField label="To" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
              <SelectField
                label="Payment"
                value={pay}
                onChange={(event) => setPay(event.target.value as PayStatus | '')}
                options={[{ value: '', label: 'Any' }, ...(Object.keys(PAY_STATUS) as PayStatus[]).map((value) => ({ value, label: PAY_STATUS[value].label }))]}
              />
              <SelectField
                label="Status"
                value={status}
                onChange={(event) => setStatus(event.target.value as SalesInvoice['status'] | '')}
                options={[{ value: '', label: 'Any' }, { value: 'draft', label: 'Draft' }, { value: 'posted', label: 'Posted' }, { value: 'cancelled', label: 'Cancelled' }]}
              />
              <SelectField
                label="Type"
                value={source}
                onChange={(event) => setSource(event.target.value as NonNullable<SalesInvoice['source']> | '')}
                options={[{ value: '', label: 'All' }, ...(Object.keys(SOURCE) as NonNullable<SalesInvoice['source']>[]).map((value) => ({ value, label: SOURCE[value] }))]}
              />
              {filtered && (
                <Button
                  variant="plain"
                  onClick={() => {
                    setQuery('');
                    setFrom('');
                    setTo('');
                    setPay('');
                    setStatus('');
                    setSource('');
                  }}
                >
                  Clear filters
                </Button>
              )}
            </div>
            <Card className="table-card">
              <DataTable
                caption="Bills"
                rows={rows}
                columns={columns}
                getRowId={(invoice) => invoice.id}
                onRowClick={(invoice) => navigate(`/billing/${invoice.id}`)}
                initialSort={{ key: 'number', direction: 'desc' }}
                resetKey={`${needle}|${from}|${to}|${pay}|${status}|${source}`}
                empty={
                  <EmptyState icon={ReceiptIcon} title={filtered ? 'No bills match these filters' : 'No bills yet'}>
                    {filtered ? 'Clear a filter to see more.' : 'Make the first one with New Bill: search a product or type an item by hand.'}
                  </EmptyState>
                }
              />
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
