import { DownloadSimpleIcon, FilePlusIcon, ReceiptIcon } from '@phosphor-icons/react';
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';

import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { DataTable, type Column } from '@/components/DataTable';
import { EmptyState } from '@/components/EmptyState';
import { SearchInput, Segmented } from '@/components/Field';
import { GstRange } from '@/components/GstRange';
import { PageHeader } from '@/components/PageHeader';
import { useToast } from '@/components/useToast';
import { initialRange, inRange, INVOICE_STATUS, resolveRange } from '@/data/gst';
import { customerOf } from '@/data/orders';
import { billOf, dayLabel } from '@/data/payments';
import { formatMoney, r2 } from '@/data/purchases';
import type { CreditNote, Order, SalesInvoice } from '@/data/types';
import { useData } from '@/data/useData';
import { useGst } from '@/hooks/useGst';
import { api } from '@/lib/api';
import { downloadCsv } from '@/lib/csv';
import { formatDate, plural } from '@/lib/format';

type Show = 'posted' | 'draft' | 'cancelled' | 'credit' | 'toInvoice';

/** GST sales register: every tax invoice, and the confirmed orders not invoiced yet. */
const needleOf = (query: string) => query.trim().toLowerCase();

export default function SalesRegisterPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { db } = useData();
  const { data, error } = useGst();
  const [params, setParams] = useSearchParams();
  const [range, setRange] = useState(initialRange('fy'));
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState<string | null>(null);
  const period = resolveRange(range);
  const asked = params.get('status') as Show | null;
  const show: Show = asked && ['posted', 'draft', 'cancelled', 'credit', 'toInvoice'].includes(asked) ? asked : 'posted';

  const invoices = data?.invoices ?? [];
  const invoiced = new Set(invoices.filter((invoice) => invoice.status !== 'cancelled').map((invoice) => invoice.orderId));
  // Credit notes for goods returned, dated in the period (cancelled ones too, marked).
  const notes = (data?.creditNotes ?? []).filter((note) => inRange(note.noteDate, period) && (!needleOf(query) || [note.number, note.customerName, note.customerGstin ?? '', note.invoiceNumber, note.returnNumber].some((text) => text.toLowerCase().includes(needleOf(query)))));
  const toInvoice = db.orders.filter((order) => ['confirmed', 'packed', 'dispatched', 'delivered'].includes(order.status) && !invoiced.has(order.id));
  const needle = query.trim().toLowerCase();
  const matches = (invoice: SalesInvoice) => !needle || [invoice.number ?? '', invoice.customerName, invoice.customerGstin ?? '', invoice.orderNumber ?? '', invoice.placeOfSupply ?? ''].some((text) => text.toLowerCase().includes(needle));
  const rows = invoices.filter((invoice) => invoice.status === show && (show === 'draft' || inRange(invoice.invoiceDate, period)) && matches(invoice));
  const counts = {
    posted: invoices.filter((invoice) => invoice.status === 'posted' && inRange(invoice.invoiceDate, period)).length,
    draft: invoices.filter((invoice) => invoice.status === 'draft').length,
    cancelled: invoices.filter((invoice) => invoice.status === 'cancelled' && inRange(invoice.invoiceDate, period)).length,
    credit: (data?.creditNotes ?? []).filter((note) => note.status === 'posted' && inRange(note.noteDate, period)).length,
    toInvoice: toInvoice.length,
  };

  const noteColumns: Column<CreditNote>[] = [
    {
      key: 'number',
      header: 'Credit note',
      sortValue: (note) => note.number,
      cell: (note) => (
        <>
          <Link to={`/returns/${note.returnId}`} className="cell-title num">
            {note.number}
          </Link>
          <div className="cell-sub">Return {note.returnNumber}</div>
        </>
      ),
    },
    { key: 'date', header: 'Date', sortValue: (note) => note.noteDate, cell: (note) => <span className="num">{dayLabel(note.noteDate)}</span> },
    {
      key: 'invoice',
      header: 'Against invoice',
      sortValue: (note) => note.invoiceNumber,
      cell: (note) => (
        <>
          <Link to={`/gst/invoices/${note.invoiceId}`} className="num">
            {note.invoiceNumber}
          </Link>
          <div className="cell-sub">{dayLabel(note.invoiceDate)}</div>
        </>
      ),
    },
    {
      key: 'buyer',
      header: 'Buyer',
      sortValue: (note) => note.customerName,
      cell: (note) => (
        <>
          {note.customerName}
          <div className="cell-sub mono">{note.customerGstin || 'Unregistered (B2C)'}</div>
        </>
      ),
    },
    { key: 'taxable', header: 'Taxable', align: 'num', sortValue: (note) => note.taxable, cell: (note) => formatMoney(note.taxable) },
    { key: 'tax', header: 'GST', align: 'num', sortValue: (note) => note.cgst + note.sgst + note.igst, cell: (note) => formatMoney(note.cgst + note.sgst + note.igst) },
    { key: 'total', header: 'Total', align: 'num', sortValue: (note) => note.total, cell: (note) => <span style={{ fontWeight: 600 }}>{formatMoney(note.total)}</span> },
    { key: 'status', header: 'Status', cell: (note) => <Badge tone={note.status === 'posted' ? 'success' : 'neutral'}>{note.status === 'posted' ? 'Posted' : 'Cancelled'}</Badge> },
  ];

  const create = async (order: Order) => {
    setCreating(order.id);
    try {
      const { invoices: [draft] } = await api<{ invoices: SalesInvoice[] }>('/gst/invoices', 'POST', { orderId: Number(order.id) });
      navigate(`/gst/invoices/${draft!.id}`);
    } catch (problem) {
      toast({ tone: 'error', message: problem instanceof Error ? problem.message : 'Couldn’t make the invoice.' });
    } finally {
      setCreating(null);
    }
  };

  const columns: Column<SalesInvoice>[] = [
    {
      key: 'number',
      header: 'Invoice',
      sortValue: (invoice) => invoice.number ?? '',
      cell: (invoice) => (
        <>
          <Link to={`/gst/invoices/${invoice.id}`} className="cell-title num">
            {invoice.number ?? 'Draft'}
          </Link>
          <div className="cell-sub">{invoice.returnNumber ? `Replacement · ${invoice.returnNumber}` : `Order ${invoice.orderNumber}`}</div>
        </>
      ),
    },
    { key: 'date', header: 'Date', sortValue: (invoice) => invoice.invoiceDate, cell: (invoice) => <span className="num">{dayLabel(invoice.invoiceDate)}</span> },
    {
      key: 'customer',
      header: 'Buyer',
      sortValue: (invoice) => invoice.customerName,
      cell: (invoice) => (
        <>
          {invoice.customerName}
          <div className="cell-sub mono">{invoice.customerGstin || 'Unregistered (B2C)'}</div>
        </>
      ),
    },
    { key: 'pos', header: 'Place of supply', cell: (invoice) => <>{invoice.placeOfSupply || <span className="muted">Not set</span>}{invoice.interstate && <div className="cell-sub">Inter-state</div>}</> },
    { key: 'taxable', header: 'Taxable', align: 'num', sortValue: (invoice) => invoice.taxable, cell: (invoice) => formatMoney(invoice.taxable) },
    {
      key: 'tax',
      header: 'GST',
      align: 'num',
      sortValue: (invoice) => invoice.cgst + invoice.sgst + invoice.igst,
      cell: (invoice) => (
        <>
          {formatMoney(invoice.cgst + invoice.sgst + invoice.igst)}
          <div className="cell-sub">{invoice.interstate ? `IGST ${formatMoney(invoice.igst)}` : `CGST + SGST ${formatMoney(invoice.cgst)} each`}</div>
        </>
      ),
    },
    { key: 'total', header: 'Total', align: 'num', sortValue: (invoice) => invoice.total, cell: (invoice) => <span style={{ fontWeight: 600 }}>{formatMoney(invoice.total)}</span> },
    { key: 'status', header: 'Status', cell: (invoice) => <Badge tone={INVOICE_STATUS[invoice.status].tone}>{INVOICE_STATUS[invoice.status].label}</Badge> },
  ];

  const orderColumns: Column<Order>[] = [
    { key: 'number', header: 'Order', sortValue: (order) => order.number, cell: (order) => <Link to={`/orders/${order.id}`} className="cell-title num">{order.number}</Link> },
    { key: 'customer', header: 'Customer', sortValue: (order) => customerOf(order).name, cell: (order) => customerOf(order).name },
    { key: 'date', header: 'Placed', sortValue: (order) => order.createdAt, cell: (order) => <span className="num">{formatDate(order.createdAt)}</span> },
    { key: 'bill', header: 'Bill', align: 'num', sortValue: (order) => billOf(order), cell: (order) => formatMoney(billOf(order)) },
    {
      key: 'actions',
      header: 'Actions',
      hideHeader: true,
      align: 'actions',
      cell: (order) => (
        <Button size="sm" icon={FilePlusIcon} loading={creating === order.id} onClick={() => create(order)}>
          Make Invoice
        </Button>
      ),
    },
  ];

  const exportInvoices = () =>
    downloadCsv(
      'vimalnath-sales-register',
      ['Invoice', 'Date', 'Order', 'Buyer', 'Buyer GSTIN', 'Type', 'Place of supply', 'State code', 'Taxable', 'CGST', 'SGST', 'IGST', 'Round off', 'Total', 'Status'],
      rows.map((invoice) => [invoice.number, invoice.invoiceDate, invoice.orderNumber, invoice.customerName, invoice.customerGstin, invoice.customerGstin ? 'B2B' : 'B2C', invoice.placeOfSupply, invoice.posCode, invoice.taxable, invoice.cgst, invoice.sgst, invoice.igst, invoice.roundOff, invoice.total, INVOICE_STATUS[invoice.status].label]),
    );
  const exportLines = () =>
    downloadCsv(
      'vimalnath-sales-register-lines',
      ['Invoice', 'Date', 'Buyer', 'Buyer GSTIN', 'Place of supply', 'Description', 'Detail', 'HSN', 'Qty', 'Unit', 'Rate', 'Disc. %', 'GST %', 'Taxable', 'CGST', 'SGST', 'IGST', 'Line total', 'Status'],
      rows.flatMap((invoice) => invoice.items.map((item) => [invoice.number, invoice.invoiceDate, invoice.customerName, invoice.customerGstin, invoice.placeOfSupply, item.description, item.detail, item.hsn, item.qty, item.unit, item.rate, item.discountPct, item.gstRate, item.taxable, item.cgst, item.sgst, item.igst, r2(item.taxable + item.cgst + item.sgst + item.igst), INVOICE_STATUS[invoice.status].label])),
    );

  return (
    <>
      <PageHeader
        title="Sales Register"
        description="GST tax invoices made from orders. Posting numbers an invoice in the financial year’s series; a posted one is cancelled, never deleted."
        actions={
          show !== 'toInvoice' && (
            <>
              <Button icon={DownloadSimpleIcon} disabled={!rows.length} onClick={exportInvoices}>
                Export Invoices
              </Button>
              <Button icon={DownloadSimpleIcon} disabled={!rows.length} onClick={exportLines}>
                Export Lines
              </Button>
            </>
          )
        }
      />
      {data ? (
        <div className="stack-lg">
          <GstRange value={range} onChange={setRange} />
          <div className="toolbar">
            <Segmented<Show>
              label="Show"
              value={show}
              onChange={(next) => setParams(next === 'posted' ? {} : { status: next }, { replace: true })}
              options={[
                { value: 'posted', label: 'Posted', count: counts.posted },
                { value: 'draft', label: 'Drafts', count: counts.draft },
                { value: 'cancelled', label: 'Cancelled', count: counts.cancelled },
                { value: 'credit', label: 'Credit notes', count: counts.credit },
                { value: 'toInvoice', label: 'To invoice', count: counts.toInvoice },
              ]}
            />
            {show !== 'toInvoice' && <SearchInput label="Search invoices" placeholder="Number, buyer, GSTIN or order" value={query} onChange={setQuery} />}
          </div>
          {show === 'posted' && rows.length > 0 && (
            <p className="muted" style={{ margin: 0 }}>
              {plural(rows.length, 'invoice')} · taxable {formatMoney(rows.reduce((total, invoice) => total + invoice.taxable, 0))} · GST {formatMoney(rows.reduce((total, invoice) => total + invoice.cgst + invoice.sgst + invoice.igst, 0))} ·
              total {formatMoney(rows.reduce((total, invoice) => total + invoice.total, 0))}
            </p>
          )}
          <Card className="table-card">
            {show === 'credit' ? (
              <DataTable
                caption="Credit notes"
                rows={notes}
                columns={noteColumns}
                getRowId={(note) => note.id}
                onRowClick={(note) => navigate(`/returns/${note.returnId}`)}
                initialSort={{ key: 'date', direction: 'desc' }}
                empty={<EmptyState icon={ReceiptIcon} title={`No credit notes in ${period.label}`}>They’re issued from returns against posted invoices.</EmptyState>}
              />
            ) : show === 'toInvoice' ? (
              <DataTable
                caption="Orders to invoice"
                rows={toInvoice}
                columns={orderColumns}
                getRowId={(order) => order.id}
                initialSort={{ key: 'date', direction: 'asc' }}
                empty={<EmptyState icon={ReceiptIcon} title="Every confirmed order is invoiced">New ones appear here once confirmed.</EmptyState>}
              />
            ) : (
              <DataTable
                key={show}
                caption="Tax invoices"
                rows={rows}
                columns={columns}
                getRowId={(invoice) => invoice.id}
                onRowClick={(invoice) => navigate(`/gst/invoices/${invoice.id}`)}
                resetKey={`${query}|${period.from}|${period.to}`}
                initialSort={{ key: 'date', direction: 'desc' }}
                empty={
                  <EmptyState icon={ReceiptIcon} title={needle ? 'No invoices match' : show === 'draft' ? 'No drafts' : `No ${show} invoices in ${period.label}`}>
                    {show === 'posted' && !needle ? 'Make one from a confirmed order under To invoice, or from the order’s page.' : null}
                  </EmptyState>
                }
              />
            )}
          </Card>
        </div>
      ) : (
        <Card>
          <EmptyState icon={ReceiptIcon} title={error ? 'Couldn’t load invoices' : 'Loading…'}>
            {error}
          </EmptyState>
        </Card>
      )}
    </>
  );
}
