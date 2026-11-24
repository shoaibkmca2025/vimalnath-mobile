import { ArrowUUpLeftIcon, DownloadSimpleIcon } from '@phosphor-icons/react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';

import { Button } from '@/components/Button';
import { Card, CardHeader } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { Segmented, TextField } from '@/components/Field';
import { PageHeader } from '@/components/PageHeader';
import { localDay } from '@/data/payments';
import { CONDITIONS, OUTCOMES, PERIOD_LABEL, REFUND_METHODS, REFUND_STATUS, RETURN_KIND, RETURN_REASONS, RETURN_STATUS, SUPPLIER_REASONS, SUPPLIER_RETURN_STATUS, isActive, moneyOf, periodOf, type PeriodChoice } from '@/data/returns';
import { handlesMoney, readSession } from '@/data/session';
import { UNITS, stockRows } from '@/data/stock';
import type { CreditNote, SupplierReturn } from '@/data/types';
import { useData } from '@/data/useData';
import { useReturns } from '@/hooks/useReturns';
import { api } from '@/lib/api';
import { downloadCsv } from '@/lib/csv';
import { formatINR, formatNumber, plural } from '@/lib/format';

/** Registers of returns, items, refunds, credit notes and supplier returns for a period, each to download as CSV. */
export default function ReturnReportsPage() {
  const { returns, error } = useReturns();
  const { db } = useData();
  // Credit notes and supplier returns: the Owner and the Accountant.
  const owner = handlesMoney(readSession()?.role);
  const [period, setPeriod] = useState<PeriodChoice>('month');
  const [custom, setCustom] = useState({ from: '', to: '' });
  const [notes, setNotes] = useState<CreditNote[] | null>(null);
  const [supplierReturns, setSupplierReturns] = useState<SupplierReturn[] | null>(null);

  useEffect(() => {
    if (!owner) return;
    let active = true;
    Promise.all([api<CreditNote[]>('/returns/credit-notes'), api<SupplierReturn[]>('/supplier-returns')]).then(
      ([loadedNotes, loadedReturns]) => {
        if (!active) return;
        setNotes(loadedNotes);
        setSupplierReturns(loadedReturns);
      },
      () => {},
    );
    return () => {
      active = false;
    };
  }, [owner]);

  const range = periodOf(period, localDay(), custom);
  const within = (day: string) => day >= range.from && day <= range.to;
  const inPeriod = (returns ?? []).filter((ret) => within(ret.returnDate));
  const items = inPeriod.flatMap((ret) => ret.items.map((item) => ({ ret, item })));
  const refunds = (returns ?? []).flatMap((ret) => (ret.refunds ?? []).map((refund) => ({ ret, refund }))).filter(({ refund }) => within(refund.paidOn ?? refund.createdAt.slice(0, 10)));
  const notesIn = (notes ?? []).filter((note) => within(note.noteDate));
  const supplierIn = (supplierReturns ?? []).filter((one) => within(one.returnDate));
  const apart = useMemo(() => stockRows(db.products, db.stock).filter((row) => row.stock && ((row.stock.held ?? 0) > 0 || (row.stock.damaged ?? 0) > 0 || (row.stock.defective ?? 0) > 0)), [db.products, db.stock]);
  const file = (name: string) => `vimalnath-${name}-${range.from}-to-${range.to}`;

  return (
    <>
      <PageHeader title="Return Reports" crumbs={[{ label: 'Returns', to: '/returns' }]} description="Registers for a period, to check or hand to your accountant. Each downloads as a CSV for Excel." />
      <div className="toolbar" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <Segmented<PeriodChoice> label="Period" value={period} onChange={setPeriod} options={(['today', 'week', 'month', 'fy', 'all', 'custom'] as PeriodChoice[]).map((value) => ({ value, label: PERIOD_LABEL[value] }))} />
        {period === 'custom' && (
          <>
            <TextField label="From" type="date" max={localDay()} value={custom.from} onChange={(event) => setCustom({ ...custom, from: event.target.value })} />
            <TextField label="To" type="date" max={localDay()} value={custom.to} onChange={(event) => setCustom({ ...custom, to: event.target.value })} />
          </>
        )}
      </div>
      {!returns ? (
        <Card>
          <EmptyState icon={ArrowUUpLeftIcon} title={error ? 'Couldn’t load returns' : 'Loading…'}>
            {error}
          </EmptyState>
        </Card>
      ) : (
        <div className="report-grid">
          <Report
            title="Returns register"
            description="One row per return: customer, order, invoice, reason, values and where it stands."
            figures={[
              ['Returns', formatNumber(inPeriod.length)],
              ['Goods back', formatINR(inPeriod.filter((ret) => isActive(ret.status)).reduce((sum, ret) => sum + ret.returnValue, 0))],
              ['Rejected or cancelled', formatNumber(inPeriod.filter((ret) => !isActive(ret.status)).length)],
            ]}
            onExport={() =>
              downloadCsv(
                file('returns'),
                ['Return', 'Date', 'Type', 'Customer', 'Phone', 'Order', 'Invoice', 'Reason', 'Details', 'Goods back', 'Replacement', 'Charges', 'To settle', 'Refunded', 'Collected', 'Credit note', 'Status', 'Recorded by'],
                inPeriod.map((ret) => {
                  const money = moneyOf(ret);
                  return [
                    ret.number,
                    ret.returnDate,
                    RETURN_KIND[ret.kind],
                    ret.customerName,
                    ret.customerPhone,
                    ret.orderNumber,
                    ret.invoiceNumber,
                    RETURN_REASONS[ret.reason],
                    ret.reasonNote,
                    ret.returnValue,
                    ret.replacementValue,
                    ret.charges,
                    ret.settleAmount,
                    money.paidOut,
                    money.paidIn,
                    ret.creditNote?.status === 'posted' ? ret.creditNote.number : '',
                    RETURN_STATUS[ret.status].label,
                    ret.createdBy,
                  ];
                }),
              )
            }
          />
          <Report
            title="Returned items"
            description="Every item back: quantity, condition, the quality check, and its value with GST."
            figures={[
              ['Items', formatNumber(items.length)],
              ['Units', formatNumber(items.reduce((sum, { item }) => sum + item.qty, 0))],
              ['Back on sale', formatNumber(items.filter(({ item }) => item.outcome === 'restock').length)],
            ]}
            onExport={() =>
              downloadCsv(
                file('returned-items'),
                ['Return', 'Date', 'Customer', 'Item', 'Name', 'HSN', 'Qty', 'Unit', 'Rate', 'GST %', 'Taxable', 'CGST', 'SGST', 'IGST', 'Value', 'Condition', 'Checked as', 'Checked by', 'Status'],
                items.map(({ ret, item }) => [
                  ret.number,
                  ret.returnDate,
                  ret.customerName,
                  item.description,
                  item.name,
                  item.hsn,
                  item.qty,
                  UNITS[item.unit],
                  item.rate,
                  item.gstRate,
                  item.taxable,
                  item.cgst,
                  item.sgst,
                  item.igst,
                  item.amount,
                  CONDITIONS[item.condition],
                  item.outcome ? OUTCOMES[item.outcome].label : '',
                  item.inspectedBy,
                  RETURN_STATUS[ret.status].label,
                ]),
              )
            }
          />
          <Report
            title="Refunds register"
            description="Refunds paid and differences collected, by method and status."
            figures={[
              ['Refunded', formatINR(refunds.filter(({ refund }) => refund.direction === 'out' && refund.status === 'completed').reduce((sum, { refund }) => sum + refund.amount, 0))],
              ['Collected', formatINR(refunds.filter(({ refund }) => refund.direction === 'in' && refund.status === 'completed').reduce((sum, { refund }) => sum + refund.amount, 0))],
              ['In progress', formatNumber(refunds.filter(({ refund }) => ['pending', 'approved', 'processing'].includes(refund.status)).length)],
            ]}
            onExport={() =>
              downloadCsv(
                file('refunds'),
                ['Return', 'Customer', 'Direction', 'Amount', 'Method', 'Order', 'Reference', 'Paid on', 'Status', 'Entered by', 'Approved by', 'Completed by'],
                refunds.map(({ ret, refund }) => [
                  ret.number,
                  ret.customerName,
                  refund.direction === 'out' ? 'Refund' : 'Collected',
                  refund.amount,
                  REFUND_METHODS[refund.method],
                  refund.orderNumber,
                  refund.reference,
                  refund.paidOn,
                  REFUND_STATUS[refund.status].label,
                  refund.createdBy,
                  refund.approvedBy,
                  refund.completedBy,
                ]),
              )
            }
          />
          {owner && (
            <Report
              title="Credit notes (GST)"
              description="Credit notes against posted tax invoices, by HSN and rate, for GSTR-1’s credit and debit notes section. Your accountant files it."
              figures={[
                ['Credit notes', formatNumber(notesIn.filter((note) => note.status === 'posted').length)],
                ['Taxable', formatINR(notesIn.filter((note) => note.status === 'posted').reduce((sum, note) => sum + note.taxable, 0))],
                ['Tax credited', formatINR(notesIn.filter((note) => note.status === 'posted').reduce((sum, note) => sum + note.cgst + note.sgst + note.igst, 0))],
              ]}
              onExport={() =>
                downloadCsv(
                  file('credit-notes'),
                  ['Credit note', 'Date', 'Status', 'Return', 'Invoice', 'Invoice date', 'Buyer', 'Buyer GSTIN', 'Place of supply', 'State code', 'Item', 'HSN', 'Qty', 'Unit', 'GST %', 'Taxable', 'CGST', 'SGST', 'IGST'],
                  notesIn.flatMap((note) =>
                    note.items.map((item) => [
                      note.number,
                      note.noteDate,
                      note.status,
                      note.returnNumber,
                      note.invoiceNumber,
                      note.invoiceDate,
                      note.customerName,
                      note.customerGstin,
                      note.placeOfSupply,
                      note.posCode,
                      item.description,
                      item.hsn,
                      item.qty,
                      UNITS[item.unit],
                      item.gstRate,
                      item.taxable,
                      item.cgst,
                      item.sgst,
                      item.igst,
                    ]),
                  ),
                )
              }
            />
          )}
          {owner && (
            <Report
              title="Supplier returns"
              description="Goods sent back to suppliers, their credit notes and how each was settled."
              figures={[
                ['Supplier returns', formatNumber(supplierIn.filter((one) => one.status !== 'cancelled').length)],
                ['Value sent back', formatINR(supplierIn.filter((one) => one.status !== 'cancelled').reduce((sum, one) => sum + one.total, 0))],
                ['Credited', formatINR(supplierIn.reduce((sum, one) => sum + (one.creditNoteAmount ?? 0), 0))],
              ]}
              onExport={() =>
                downloadCsv(
                  file('supplier-returns'),
                  ['Supplier return', 'Date', 'Supplier', 'Supplier GSTIN', 'Bill', 'Their bill', 'Reason', 'Taxable', 'GST', 'Total', 'Challan', 'Credit note', 'Credit note date', 'Credited', 'GST credited', 'Settled by', 'Refund', 'Status'],
                  supplierIn.map((one) => [
                    one.number,
                    one.returnDate,
                    one.supplier.name,
                    one.supplier.gstin,
                    one.purchaseNumber,
                    one.supplierInvoice,
                    SUPPLIER_REASONS[one.reason],
                    one.taxable,
                    one.tax,
                    one.total,
                    one.challan,
                    one.creditNoteNumber,
                    one.creditNoteDate,
                    one.creditNoteAmount,
                    one.creditNoteTax,
                    one.settlement === 'adjust' ? 'Against what the shop owes' : one.settlement === 'refund' ? 'Refund' : '',
                    one.refundAmount,
                    SUPPLIER_RETURN_STATUS[one.status].label,
                  ]),
                )
              }
            />
          )}
          <Report
            title="Stock not for sale"
            description="Now, whatever the period: goods waiting for the quality check, and damaged or defective stock kept apart."
            figures={[
              ['Items', formatNumber(apart.length)],
              ['Awaiting check', formatNumber(apart.reduce((sum, row) => sum + (row.stock?.held ?? 0), 0))],
              ['Damaged or defective', formatNumber(apart.reduce((sum, row) => sum + (row.stock?.damaged ?? 0) + (row.stock?.defective ?? 0), 0))],
            ]}
            onExport={() =>
              downloadCsv(
                'vimalnath-stock-not-for-sale',
                ['Item', 'Code', 'Unit', 'For sale', 'Awaiting check', 'Damaged', 'Defective'],
                apart.map((row) => [row.title, row.code, UNITS[row.stock!.unit], row.stock!.quantity, row.stock!.held, row.stock!.damaged, row.stock!.defective]),
              )
            }
          >
            {apart.length > 0 && (
              <ul className="refund-list">
                {apart.slice(0, 6).map((row) => (
                  <li key={row.key} className="refund-list__item">
                    <span>{row.title}</span>
                    <span className="cell-sub num">
                      {[
                        row.stock!.held ? `${formatNumber(row.stock!.held)} to check` : '',
                        row.stock!.damaged ? `${formatNumber(row.stock!.damaged)} damaged` : '',
                        row.stock!.defective ? `${formatNumber(row.stock!.defective)} defective` : '',
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </li>
                ))}
                {apart.length > 6 && <li className="muted">and {plural(apart.length - 6, 'more item')} in the download</li>}
              </ul>
            )}
          </Report>
        </div>
      )}
    </>
  );
}

function Report({ title, description, figures, onExport, children }: { title: string; description: string; figures: [string, string][]; onExport: () => void; children?: ReactNode }) {
  return (
    <Card aria-label={title}>
      <CardHeader
        title={title}
        description={description}
        action={
          <Button size="sm" icon={DownloadSimpleIcon} onClick={onExport}>
            CSV
          </Button>
        }
      />
      <div className="card__body stack">
        <dl className="report-figures">
          {figures.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd className="num">{value}</dd>
            </div>
          ))}
        </dl>
        {children}
      </div>
    </Card>
  );
}
