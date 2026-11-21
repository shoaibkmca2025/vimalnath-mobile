import { DownloadSimpleIcon, TruckIcon } from '@phosphor-icons/react';
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';

import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { DataTable, type Column } from '@/components/DataTable';
import { Drawer } from '@/components/Drawer';
import { EmptyState } from '@/components/EmptyState';
import { SearchInput, Segmented, SelectField, TextField } from '@/components/Field';
import { GstRange, initialRange, resolveRange } from '@/components/GstRange';
import { PageHeader } from '@/components/PageHeader';
import { useToast } from '@/components/useToast';
import { ITC_STATUS, purchaseHeads, purchaseLine, receivedIn, totalOf } from '@/data/gst';
import { dayLabel } from '@/data/payments';
import { formatMoney } from '@/data/purchases';
import type { ItcStatus, Purchase } from '@/data/types';
import { useGst } from '@/hooks/useGst';
import { api } from '@/lib/api';
import { downloadCsv } from '@/lib/csv';
import { plural } from '@/lib/format';

type Show = 'all' | ItcStatus;

/** GST purchase register: received bills with their tax by head, and each one's input tax credit as the accountant decided it. */
export default function PurchaseRegisterPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const { data, error, setData } = useGst();
  const [params, setParams] = useSearchParams();
  const [range, setRange] = useState(initialRange('fy'));
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string[] | null>(null);
  const [draft, setDraft] = useState<{ status: ItcStatus; period: string; note: string }>({ status: 'eligible', period: '', note: '' });
  const [saving, setSaving] = useState(false);
  const period = resolveRange(range);
  const asked = params.get('itc') as Show | null;
  const show: Show = asked && (asked === 'all' || asked in ITC_STATUS) ? asked : 'all';

  const bills = data ? receivedIn(data.purchases, period) : [];
  const needle = query.trim().toLowerCase();
  const rows = bills.filter((bill) => (show === 'all' || bill.itcStatus === show) && (!needle || [bill.number, bill.supplier.name, bill.supplierInvoice ?? '', bill.supplierGstin ?? ''].some((text) => text.toLowerCase().includes(needle))));
  const count = (status: ItcStatus) => bills.filter((bill) => bill.itcStatus === status).length;
  const noGstin = bills.filter((bill) => !bill.supplierGstin && bill.tax > 0).length;

  const open = (ids: string[]) => {
    const first = data?.purchases.find((bill) => bill.id === ids[0]);
    setDraft({ status: first?.itcStatus === 'pending' ? 'eligible' : (first?.itcStatus ?? 'eligible'), period: first?.itcPeriod ?? (first?.billDate.slice(0, 7) ?? ''), note: first?.itcNote ?? '' });
    setEditing(ids);
  };

  const save = async () => {
    if (!editing) return;
    if ((draft.status === 'claimed' || draft.status === 'reversed') && !/^\d{4}-\d{2}$/.test(draft.period)) {
      toast({ tone: 'error', message: 'Pick the return month it’s claimed or reversed in.' });
      return;
    }
    setSaving(true);
    try {
      for (const id of editing) await api(`/gst/purchases/${id}/itc`, 'PATCH', { status: draft.status, period: draft.period || null, note: draft.note.trim() });
      const names = editing.map((id) => data!.purchases.find((bill) => bill.id === id)!.number);
      await api('/activity', 'POST', { area: 'purchases', summary: `Input tax credit: ${names.join(', ')} marked ${ITC_STATUS[draft.status].label.toLowerCase()}${draft.period ? ` (${draft.period})` : ''}`, to: '/gst/purchases' }).catch(() => null);
      setData((current) =>
        current && {
          ...current,
          purchases: current.purchases.map((bill) => (editing.includes(bill.id) ? { ...bill, itcStatus: draft.status, itcPeriod: draft.period || undefined, itcNote: draft.note.trim() || undefined } : bill)),
        },
      );
      toast({ message: `${plural(editing.length, 'bill')} updated.` });
      setEditing(null);
      setSelected(new Set());
    } catch (problem) {
      toast({ tone: 'error', message: problem instanceof Error ? problem.message : 'Couldn’t save it.' });
    } finally {
      setSaving(false);
    }
  };

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
    { key: 'date', header: 'Date', sortValue: (bill) => bill.billDate, cell: (bill) => <span className="num">{dayLabel(bill.billDate)}</span> },
    {
      key: 'supplier',
      header: 'Supplier',
      sortValue: (bill) => bill.supplier.name,
      cell: (bill) => (
        <>
          {bill.supplier.name}
          <div className={bill.supplierGstin ? 'cell-sub mono' : 'cell-sub money-late'}>{bill.supplierGstin ?? 'No GSTIN: no credit'}</div>
        </>
      ),
    },
    { key: 'taxable', header: 'Taxable', align: 'num', sortValue: (bill) => bill.subtotal, cell: (bill) => formatMoney(bill.subtotal) },
    {
      key: 'tax',
      header: 'GST',
      align: 'num',
      sortValue: (bill) => bill.tax,
      cell: (bill) => {
        const heads = purchaseHeads(bill);
        return (
          <>
            {formatMoney(totalOf(heads))}
            <div className="cell-sub">{bill.interstate ? `IGST ${formatMoney(heads.igst)}` : `CGST + SGST ${formatMoney(heads.cgst)} each`}</div>
          </>
        );
      },
    },
    { key: 'total', header: 'Total', align: 'num', sortValue: (bill) => bill.total, cell: (bill) => formatMoney(bill.total) },
    {
      key: 'itc',
      header: 'Input tax credit',
      sortValue: (bill) => bill.itcStatus,
      cell: (bill) => (
        <button type="button" className="cell-title" onClick={() => open([bill.id])} style={{ textAlign: 'left' }}>
          <Badge tone={ITC_STATUS[bill.itcStatus].tone}>{ITC_STATUS[bill.itcStatus].label}</Badge>
          <div className="cell-sub">{[bill.itcPeriod, bill.itcNote].filter(Boolean).join(' · ') || 'Change'}</div>
        </button>
      ),
    },
  ];

  const exportBills = () =>
    downloadCsv(
      'vimalnath-purchase-register',
      ['Bill', 'Their bill', 'Date', 'Supplier', 'Supplier GSTIN', 'Inter-state', 'Taxable', 'CGST', 'SGST', 'IGST', 'Freight', 'Other charges', 'Discount', 'Round off', 'Total', 'ITC status', 'ITC month', 'ITC note'],
      rows.map((bill) => {
        const heads = purchaseHeads(bill);
        return [bill.number, bill.supplierInvoice, bill.billDate, bill.supplier.name, bill.supplierGstin, bill.interstate ? 'Yes' : 'No', bill.subtotal, heads.cgst, heads.sgst, heads.igst, bill.freight, bill.otherCharges, bill.discount, bill.roundOff, bill.total, ITC_STATUS[bill.itcStatus].label, bill.itcPeriod, bill.itcNote];
      }),
    );
  const exportLines = () =>
    downloadCsv(
      'vimalnath-purchase-register-lines',
      ['Bill', 'Their bill', 'Date', 'Supplier', 'Supplier GSTIN', 'Item', 'Qty', 'Unit', 'Rate', 'Disc %', 'GST %', 'Taxable', 'CGST', 'SGST', 'IGST', 'ITC status'],
      rows.flatMap((bill) =>
        bill.items.map((item, index) => {
          const line = purchaseLine(bill, index);
          return [bill.number, bill.supplierInvoice, bill.billDate, bill.supplier.name, bill.supplierGstin, item.name, item.qty, item.unit, item.rate, item.discountPct, item.gstRate, line.taxable, line.cgst, line.sgst, line.igst, ITC_STATUS[bill.itcStatus].label];
        }),
      ),
    );

  return (
    <>
      <PageHeader
        title="Purchase Register"
        description="Received supplier bills with their GST by head. Nothing is claimed by itself: mark each bill’s input tax credit as your accountant decides."
        actions={
          <>
            <Button icon={DownloadSimpleIcon} disabled={!rows.length} onClick={exportBills}>
              Export Bills
            </Button>
            <Button icon={DownloadSimpleIcon} disabled={!rows.length} onClick={exportLines}>
              Export Lines
            </Button>
          </>
        }
      />
      {data ? (
        <div className="stack-lg">
          <GstRange value={range} onChange={setRange} />
          {noGstin > 0 && (
            <p className="notice notice--warning" style={{ margin: 0 }}>
              {plural(noGstin, 'bill')} in this period {noGstin === 1 ? 'is' : 'are'} from a supplier without a GSTIN. Credit needs the supplier’s GSTIN on the bill: add it under Suppliers.
            </p>
          )}
          <div className="toolbar">
            <Segmented<Show>
              label="Input tax credit"
              value={show}
              onChange={(next) => {
                setSelected(new Set());
                setParams(next === 'all' ? {} : { itc: next }, { replace: true });
              }}
              options={[
                { value: 'all', label: 'All', count: bills.length },
                { value: 'pending', label: 'Pending', count: count('pending') },
                { value: 'eligible', label: 'Eligible', count: count('eligible') },
                { value: 'claimed', label: 'Claimed', count: count('claimed') },
                { value: 'ineligible', label: 'Ineligible', count: count('ineligible') },
                { value: 'reversed', label: 'Reversed', count: count('reversed') },
              ]}
            />
            <SearchInput label="Search bills" placeholder="Bill, supplier, their bill number or GSTIN" value={query} onChange={setQuery} />
          </div>
          <Card className="table-card">
            <DataTable
              key={show}
              caption="Purchase register"
              rows={rows}
              columns={columns}
              getRowId={(bill) => bill.id}
              onRowClick={(bill) => navigate(`/purchases/${bill.id}`)}
              selectable
              selected={selected}
              onSelectedChange={setSelected}
              bulkActions={(ids) => (
                <Button size="sm" onClick={() => open(ids)}>
                  Set Input Tax Credit
                </Button>
              )}
              resetKey={`${query}|${period.from}|${period.to}`}
              initialSort={{ key: 'date', direction: 'desc' }}
              empty={<EmptyState icon={TruckIcon} title={needle ? 'No bills match' : `No received bills in ${period.label}`}>Received purchase bills appear here.</EmptyState>}
            />
          </Card>
        </div>
      ) : (
        <Card>
          <EmptyState icon={TruckIcon} title={error ? 'Couldn’t load the register' : 'Loading…'}>
            {error}
          </EmptyState>
        </Card>
      )}

      <Drawer
        open={Boolean(editing)}
        title="Input tax credit"
        description={editing && editing.length > 1 ? `${editing.length} bills` : data?.purchases.find((bill) => bill.id === editing?.[0])?.number}
        onClose={() => setEditing(null)}
        onSubmit={save}
        footer={
          <>
            <Button onClick={() => setEditing(null)}>Cancel</Button>
            <Button type="submit" variant="primary" loading={saving}>
              Save
            </Button>
          </>
        }
      >
        <div className="stack">
          <SelectField
            label="Status"
            value={draft.status}
            onChange={(event) => setDraft({ ...draft, status: event.target.value as ItcStatus })}
            options={(Object.keys(ITC_STATUS) as ItcStatus[]).map((status) => ({ value: status, label: ITC_STATUS[status].label }))}
            hint="Eligible and claimed bills count as credit in the GSTR-3B working."
          />
          <TextField
            label="Return month"
            type="month"
            value={draft.period}
            onChange={(event) => setDraft({ ...draft, period: event.target.value })}
            hint={draft.status === 'claimed' || draft.status === 'reversed' ? 'The GSTR-3B month it’s claimed or reversed in.' : 'Optional until it’s claimed.'}
          />
          <TextField label="Note" value={draft.note} onChange={(event) => setDraft({ ...draft, note: event.target.value })} maxLength={300} placeholder="e.g. In GSTR-2B for November" />
        </div>
      </Drawer>
    </>
  );
}
