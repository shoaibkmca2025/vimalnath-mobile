import { DownloadSimpleIcon, HashIcon } from '@phosphor-icons/react';
import { useMemo, useState } from 'react';

import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { Segmented } from '@/components/Field';
import { GstRange } from '@/components/GstRange';
import { PageHeader } from '@/components/PageHeader';
import { hsnSummary, initialRange, postedIn, purchaseHsnLines, receivedIn, resolveRange, salesHsnLines, totalOf } from '@/data/gst';
import { formatMoney } from '@/data/purchases';
import { UNITS, itemKey } from '@/data/stock';
import type { StockUnit } from '@/data/types';
import { useData } from '@/data/useData';
import { useGst } from '@/hooks/useGst';
import { downloadCsv } from '@/lib/csv';

type Side = 'sales' | 'purchases';

/** Sales or purchases grouped by HSN and GST rate, as GSTR-1’s HSN table asks for. */
export default function HsnSummaryPage() {
  const { db } = useData();
  const { data, error } = useGst();
  const [side, setSide] = useState<Side>('sales');
  const [range, setRange] = useState(initialRange('month'));
  const period = resolveRange(range);
  const hsn = useMemo(() => new Map(db.stock.map((item) => [itemKey(item.productId, item.option), item.hsn])), [db.stock]);

  const rows = useMemo(() => {
    if (!data) return [];
    return side === 'sales' ? hsnSummary(salesHsnLines(postedIn(data.invoices, period))) : hsnSummary(purchaseHsnLines(receivedIn(data.purchases, period), (productId, option) => hsn.get(itemKey(productId, option)) ?? ''));
  }, [data, side, period, hsn]);
  const missing = rows.filter((row) => !row.hsn).length;
  const total = (pick: (row: (typeof rows)[number]) => number) => rows.reduce((sum, row) => sum + pick(row), 0);

  return (
    <>
      <PageHeader
        title="HSN Summary"
        description="Taxable value and GST by HSN code and rate. Sales come from posted invoices; purchases from received bills, with HSN from Stock."
        actions={
          <Button
            icon={DownloadSimpleIcon}
            disabled={!rows.length}
            onClick={() =>
              downloadCsv(
                `vimalnath-hsn-${side}`,
                ['HSN', 'Description', 'UQC', 'Total quantity', 'Documents', 'GST %', 'Taxable value', 'IGST', 'CGST', 'SGST', 'Total value'],
                rows.map((row) => [row.hsn, row.description, UNITS[row.unit as StockUnit] ?? row.unit, row.qty, row.documents, row.rate, row.taxable, row.heads.igst, row.heads.cgst, row.heads.sgst, row.value]),
              )
            }
          >
            Export CSV
          </Button>
        }
      />
      {data ? (
        <div className="stack-lg">
          <div className="row-wrap" style={{ gap: 'var(--space-4)', alignItems: 'flex-end' }}>
            <Segmented<Side>
              label="Side"
              value={side}
              onChange={setSide}
              options={[
                { value: 'sales', label: 'Sales' },
                { value: 'purchases', label: 'Purchases' },
              ]}
            />
            <GstRange value={range} onChange={setRange} />
          </div>
          {missing > 0 && (
            <p className="notice notice--warning" style={{ margin: 0 }}>
              {missing === 1 ? 'One group has' : `${missing} groups have`} no HSN code. Add HSN codes under Stock{side === 'sales' ? ' and on draft invoices' : ''}.
            </p>
          )}
          <Card className="table-card">
            {rows.length ? (
              <div className="table-scroll">
                <table className="table">
                  <caption className="visually-hidden">HSN summary of {side}</caption>
                  <thead>
                    <tr>
                      <th scope="col">HSN</th>
                      <th scope="col">Description</th>
                      <th scope="col" className="is-num">
                        Quantity
                      </th>
                      <th scope="col" className="is-num">
                        GST %
                      </th>
                      <th scope="col" className="is-num">
                        Taxable
                      </th>
                      <th scope="col" className="is-num">
                        IGST
                      </th>
                      <th scope="col" className="is-num">
                        CGST
                      </th>
                      <th scope="col" className="is-num">
                        SGST
                      </th>
                      <th scope="col" className="is-num">
                        Total
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={`${row.hsn}-${row.rate}-${row.unit}`}>
                        <td className="mono">{row.hsn || <span className="money-late">Missing</span>}</td>
                        <td>
                          {row.description}
                          <div className="cell-sub">{row.documents} {side === 'sales' ? 'invoices' : 'bills'}</div>
                        </td>
                        <td className="is-num">
                          {row.qty} {UNITS[row.unit as StockUnit] ?? row.unit}
                        </td>
                        <td className="is-num">{row.rate}%</td>
                        <td className="is-num">{formatMoney(row.taxable)}</td>
                        <td className="is-num">{formatMoney(row.heads.igst)}</td>
                        <td className="is-num">{formatMoney(row.heads.cgst)}</td>
                        <td className="is-num">{formatMoney(row.heads.sgst)}</td>
                        <td className="is-num">{formatMoney(row.value)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th scope="row" colSpan={4}>
                        Total
                      </th>
                      <td className="is-num">{formatMoney(total((row) => row.taxable))}</td>
                      <td className="is-num">{formatMoney(total((row) => row.heads.igst))}</td>
                      <td className="is-num">{formatMoney(total((row) => row.heads.cgst))}</td>
                      <td className="is-num">{formatMoney(total((row) => row.heads.sgst))}</td>
                      <td className="is-num table__total">{formatMoney(total((row) => row.taxable + totalOf(row.heads)))}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            ) : (
              <EmptyState icon={HashIcon} title={`No ${side} in ${period.label}`}>
                {side === 'sales' ? 'Posted tax invoices appear here.' : 'Received purchase bills appear here.'}
              </EmptyState>
            )}
          </Card>
        </div>
      ) : (
        <Card>
          <EmptyState icon={HashIcon} title={error ? 'Couldn’t load it' : 'Loading…'}>
            {error}
          </EmptyState>
        </Card>
      )}
    </>
  );
}
