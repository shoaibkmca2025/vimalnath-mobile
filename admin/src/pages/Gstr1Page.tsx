import { FileTextIcon, WarningCircleIcon } from '@phosphor-icons/react';
import { useState } from 'react';
import { Link } from 'react-router';

import { Button } from '@/components/Button';
import { Card, CardHeader } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { GstRange } from '@/components/GstRange';
import { PageHeader } from '@/components/PageHeader';
import { Stat } from '@/components/Stat';
import { B2CL_LIMIT, gstr1, initialRange, invoiceDay, resolveRange, type Gstr1Doc } from '@/data/gst';
import { formatMoney } from '@/data/purchases';
import { useGst } from '@/hooks/useGst';
import { downloadCsv } from '@/lib/csv';
import { plural } from '@/lib/format';

const tax = (row: { igst: number; cgst: number; sgst: number }) => row.igst + row.cgst + row.sgst;
const sum = <T,>(rows: T[], pick: (row: T) => number) => Math.round(rows.reduce((total, row) => total + pick(row), 0) * 100) / 100;

/**
 * GSTR-1 prepared from posted tax invoices and credit notes. Each section downloads with the GST offline tool's column
 * headings, to paste into its sheets. Nothing is filed from here.
 */
export default function Gstr1Page() {
  const { data, error } = useGst();
  const [range, setRange] = useState(() => initialRange('previous'));
  const period = resolveRange(range);
  if (!data)
    return (
      <>
        <PageHeader title="GSTR-1" crumbs={[{ label: 'GST', to: '/gst' }]} />
        <Card>
          <EmptyState icon={FileTextIcon} title={error ? 'Couldn’t load GST records' : 'Loading…'}>
            {error}
          </EmptyState>
        </Card>
      </>
    );
  const report = gstr1(data.invoices, data.creditNotes, period);
  const file = (section: string) => `gstr1-${section}-${period.from}-to-${period.to}`;
  const rateCols = (row: { rate: number; taxable: number }) => ['', row.rate, row.taxable, 0];

  const sections: { key: string; title: string; description: string; rows: number; taxable: number; tax: number; csv: () => void }[] = [
    {
      key: 'b2b',
      title: '4A · B2B invoices',
      description: 'To buyers with a GSTIN, one line per invoice and rate.',
      rows: new Set(report.b2b.map((row) => row.number)).size,
      taxable: sum(report.b2b, (row) => row.taxable),
      tax: sum(report.b2b, tax),
      csv: () =>
        downloadCsv(
          file('b2b'),
          ['GSTIN/UIN of Recipient', 'Receiver Name', 'Invoice Number', 'Invoice date', 'Invoice Value', 'Place Of Supply', 'Reverse Charge', 'Applicable % of Tax Rate', 'Invoice Type', 'E-Commerce GSTIN', 'Rate', 'Taxable Value', 'Cess Amount'],
          report.b2b.map((row) => [row.gstin, row.name, row.number, invoiceDay(row.date), row.value, row.pos, 'N', '', 'Regular B2B', '', row.rate, row.taxable, 0]),
        ),
    },
    {
      key: 'b2cl',
      title: '5 · B2C Large',
      description: `Unregistered buyers in another state, invoices over ${formatMoney(B2CL_LIMIT)}.`,
      rows: new Set(report.b2cl.map((row) => row.number)).size,
      taxable: sum(report.b2cl, (row) => row.taxable),
      tax: sum(report.b2cl, tax),
      csv: () =>
        downloadCsv(
          file('b2cl'),
          ['Invoice Number', 'Invoice date', 'Invoice Value', 'Place Of Supply', 'Applicable % of Tax Rate', 'Rate', 'Taxable Value', 'Cess Amount', 'E-Commerce GSTIN'],
          report.b2cl.map((row) => [row.number, invoiceDay(row.date), row.value, row.pos, ...rateCols(row), '']),
        ),
    },
    {
      key: 'b2cs',
      title: '7 · B2C Small',
      description: 'Every other sale to unregistered buyers, totalled by place of supply and rate, less their credit notes.',
      rows: report.b2cs.length,
      taxable: sum(report.b2cs, (row) => row.taxable),
      tax: sum(report.b2cs, tax),
      csv: () => downloadCsv(file('b2cs'), ['Type', 'Place Of Supply', 'Applicable % of Tax Rate', 'Rate', 'Taxable Value', 'Cess Amount', 'E-Commerce GSTIN'], report.b2cs.map((row) => ['OE', row.pos, ...rateCols(row), ''])),
    },
    {
      key: 'cdnr',
      title: '9B · Credit notes, registered',
      description: 'Credit notes for goods returned by buyers with a GSTIN.',
      rows: new Set(report.cdnr.map((row) => row.number)).size,
      taxable: sum(report.cdnr, (row) => row.taxable),
      tax: sum(report.cdnr, tax),
      csv: () =>
        downloadCsv(
          file('cdnr'),
          ['GSTIN/UIN of Recipient', 'Receiver Name', 'Note Number', 'Note Date', 'Note Type', 'Place Of Supply', 'Reverse Charge', 'Note Supply Type', 'Note Value', 'Applicable % of Tax Rate', 'Rate', 'Taxable Value', 'Cess Amount'],
          report.cdnr.map((row) => [row.gstin, row.name, row.number, invoiceDay(row.date), 'C', row.pos, 'N', 'Regular B2B', row.value, ...rateCols(row)]),
        ),
    },
    {
      key: 'cdnur',
      title: '9B · Credit notes, unregistered',
      description: 'Credit notes against B2C Large invoices. Others come off B2C Small.',
      rows: new Set(report.cdnur.map((row) => row.number)).size,
      taxable: sum(report.cdnur, (row) => row.taxable),
      tax: sum(report.cdnur, tax),
      csv: () =>
        downloadCsv(
          file('cdnur'),
          ['UR Type', 'Note Number', 'Note Date', 'Note Type', 'Place Of Supply', 'Note Value', 'Applicable % of Tax Rate', 'Rate', 'Taxable Value', 'Cess Amount'],
          report.cdnur.map((row) => ['B2CL', row.number, invoiceDay(row.date), 'C', row.pos, row.value, ...rateCols(row)]),
        ),
    },
  ];

  const docs = (rows: (Gstr1Doc & { invoice?: string })[]) =>
    rows.length ? (
      <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Number</th>
              <th scope="col">Date</th>
              <th scope="col">Buyer</th>
              <th scope="col">Place of supply</th>
              <th scope="col" className="is-num">
                Rate
              </th>
              <th scope="col" className="is-num">
                Taxable
              </th>
              <th scope="col" className="is-num">
                Tax
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.number}${row.rate}`}>
                <td className="num">
                  {row.number}
                  {row.invoice && <div className="cell-sub">Against {row.invoice}</div>}
                </td>
                <td className="num">{invoiceDay(row.date)}</td>
                <td>
                  {row.name}
                  {row.gstin && <div className="cell-sub mono">{row.gstin}</div>}
                </td>
                <td>{row.pos}</td>
                <td className="is-num">{row.rate}%</td>
                <td className="is-num">{formatMoney(row.taxable)}</td>
                <td className="is-num">{formatMoney(tax(row))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ) : (
      <p className="card__body muted">None in this period.</p>
    );

  return (
    <>
      <PageHeader
        title="GSTR-1"
        crumbs={[{ label: 'GST', to: '/gst' }]}
        description="Outward supplies for the return, from posted tax invoices and credit notes. Download each section to paste into the GST offline tool, then file it on the portal. Nothing is filed from here."
      />
      <div className="stack-lg">
        <GstRange value={range} onChange={setRange} />
        {!data.settings.gstin && (
          <p className="notice notice--warning" role="status">
            <WarningCircleIcon size={16} weight="bold" aria-hidden />
            <span>
              The shop’s GSTIN isn’t set. <Link to="/gst/settings">Add it in GST Settings</Link>.
            </span>
          </p>
        )}
        {report.problems.length > 0 && (
          <p className="notice notice--danger" role="status">
            <WarningCircleIcon size={16} weight="bold" aria-hidden />
            <span>{report.problems.join(' ')} Fix these before filing.</span>
          </p>
        )}
        <div className="stats">
          <Stat label="Taxable value" icon={FileTextIcon} value={formatMoney(sum(sections.slice(0, 3), (section) => section.taxable))} foot={`Invoices, ${period.label}`} />
          <Stat label="Tax on invoices" icon={FileTextIcon} value={formatMoney(sum(sections.slice(0, 3), (section) => section.tax))} />
          <Stat label="Credit notes" icon={FileTextIcon} value={formatMoney(sum(sections.slice(3), (section) => section.taxable))} foot="Taxable value returned" />
          <Stat label="HSN summary (12)" icon={FileTextIcon} value="Open" to="/gst/hsn" foot="Its own page and export" />
        </div>
        {sections.map((section) => (
          <Card key={section.key} className="table-card">
            <CardHeader
              title={section.title}
              description={`${section.description} ${plural(section.rows, section.key === 'b2cs' ? 'line' : 'document')}, taxable ${formatMoney(section.taxable)}, tax ${formatMoney(section.tax)}.`}
              action={
                <Button size="sm" disabled={!section.rows} onClick={section.csv}>
                  Download CSV
                </Button>
              }
            />
            {section.key === 'b2cs' ? (
              report.b2cs.length ? (
                <div className="table-scroll">
                  <table className="table">
                    <thead>
                      <tr>
                        <th scope="col">Place of supply</th>
                        <th scope="col">Supply</th>
                        <th scope="col" className="is-num">
                          Rate
                        </th>
                        <th scope="col" className="is-num">
                          Taxable
                        </th>
                        <th scope="col" className="is-num">
                          Tax
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.b2cs.map((row) => (
                        <tr key={`${row.pos}${row.rate}`}>
                          <td>{row.pos}</td>
                          <td>{row.type === 'INTER' ? 'Inter-state' : 'Within the state'}</td>
                          <td className="is-num">{row.rate}%</td>
                          <td className="is-num">{formatMoney(row.taxable)}</td>
                          <td className="is-num">{formatMoney(tax(row))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="card__body muted">None in this period.</p>
              )
            ) : (
              docs(report[section.key as 'b2b' | 'b2cl' | 'cdnr' | 'cdnur'])
            )}
          </Card>
        ))}
        <Card className="table-card">
          <CardHeader
            title="13 · Documents issued"
            description="Each series used in the period: first and last number, how many, and how many cancelled."
            action={
              <Button size="sm" disabled={!report.docs.length} onClick={() => downloadCsv(file('docs'), ['Nature of Document', 'Sr. No. From', 'Sr. No. To', 'Total Number', 'Cancelled'], report.docs.map((row) => [row.nature, row.from, row.to, row.total, row.cancelled]))}>
                Download CSV
              </Button>
            }
          />
          {report.docs.length ? (
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Document</th>
                    <th scope="col">From</th>
                    <th scope="col">To</th>
                    <th scope="col" className="is-num">
                      Total
                    </th>
                    <th scope="col" className="is-num">
                      Cancelled
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {report.docs.map((row) => (
                    <tr key={row.nature}>
                      <td>{row.nature}</td>
                      <td className="num">{row.from}</td>
                      <td className="num">{row.to}</td>
                      <td className="is-num">{row.total}</td>
                      <td className="is-num">{row.cancelled}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="card__body muted">No invoices or credit notes in this period.</p>
          )}
        </Card>
      </div>
    </>
  );
}
