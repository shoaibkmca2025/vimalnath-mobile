import { BankIcon, CalculatorIcon, CurrencyInrIcon, ReceiptIcon, ScalesIcon, TruckIcon, WarningCircleIcon } from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';

import { ButtonLink } from '@/components/Button';
import { Card, CardHeader } from '@/components/Card';
import { AreaChart } from '@/components/Charts';
import { EmptyState } from '@/components/EmptyState';
import { GstRange } from '@/components/GstRange';
import { PageHeader } from '@/components/PageHeader';
import { Stat } from '@/components/Stat';
import { initialRange, monthlyTax, periodLabel, postedIn, purchaseHeads, receivedIn, resolveRange, summary3b, totalOf, type Heads } from '@/data/gst';
import { localDay } from '@/data/payments';
import { formatMoney } from '@/data/purchases';
import { useGst } from '@/hooks/useGst';
import { plural } from '@/lib/format';

const HEADS: (keyof Heads)[] = ['igst', 'cgst', 'sgst'];
const NAME: Record<keyof Heads, string> = { igst: 'IGST', cgst: 'CGST', sgst: 'SGST' };

/** GST at a glance for a period, and the GSTR-3B working: output tax, input tax credit, the set-off, and cash to pay. */
export default function GstDashboardPage() {
  const { data, error } = useGst();
  const [range, setRange] = useState(initialRange('month'));
  const period = resolveRange(range);
  const today = localDay();

  const figures = useMemo(() => {
    if (!data) return null;
    const posted = postedIn(data.invoices, period);
    const bills = receivedIn(data.purchases, period);
    return {
      sales: posted.reduce((total, invoice) => total + invoice.total, 0),
      taxable: posted.reduce((total, invoice) => total + invoice.taxable, 0),
      purchases: bills.reduce((total, bill) => total + bill.total, 0),
      purchaseTax: bills.reduce((total, bill) => total + totalOf(purchaseHeads(bill)), 0),
      drafts: data.invoices.filter((invoice) => invoice.status === 'draft').length,
      summary: summary3b(data.invoices, data.purchases, data.payments, period),
      months: monthlyTax(data.invoices, data.purchases, today),
    };
  }, [data, period, today]);

  if (!data || !figures)
    return (
      <>
        <PageHeader title="GST Dashboard" />
        <Card>
          <EmptyState icon={ScalesIcon} title={error ? 'Couldn’t load GST records' : 'Loading…'}>
            {error}
          </EmptyState>
        </Card>
      </>
    );

  const { summary } = figures;
  const cash = summary.utilisation.cash;
  const cashTotal = totalOf(cash);
  const paidTotal = totalOf(summary.paid);
  const missingSettings = !data.settings.gstin || !data.settings.legalName;

  return (
    <>
      <PageHeader
        title="GST Dashboard"
        description="From posted tax invoices and received purchase bills. A working aid: your accountant checks it before filing."
        actions={
          <ButtonLink to="/gst/sales" variant="primary" icon={ReceiptIcon}>
            Sales Register
          </ButtonLink>
        }
      />

      <div className="stack-lg">
        {(missingSettings || summary.pendingBills > 0 || figures.drafts > 0) && (
          <div className="notice notice--warning" style={{ display: 'grid', gap: 4 }}>
            {missingSettings && (
              <span>
                <WarningCircleIcon size={16} weight="bold" aria-hidden /> The shop’s GSTIN and legal name aren’t set: <Link to="/gst/settings">fill in GST Settings</Link> before posting invoices.
              </span>
            )}
            {summary.pendingBills > 0 && (
              <span>
                {plural(summary.pendingBills, 'purchase bill')} in this period {summary.pendingBills === 1 ? 'needs' : 'need'} an input tax credit review: <Link to="/gst/purchases?itc=pending">Purchase Register</Link>.
              </span>
            )}
            {figures.drafts > 0 && (
              <span>
                {plural(figures.drafts, 'draft invoice')} not posted yet: <Link to="/gst/sales?status=draft">Sales Register</Link>.
              </span>
            )}
          </div>
        )}

        <GstRange value={range} onChange={setRange} />

        <div className="stats stats--3">
          <Stat label="Sales, GST included" icon={CurrencyInrIcon} value={formatMoney(figures.sales)} foot={`${plural(summary.outward.invoices, 'posted invoice')} · taxable ${formatMoney(figures.taxable)}`} to="/gst/sales" />
          <Stat label="Output GST" icon={ReceiptIcon} value={formatMoney(totalOf(summary.outward.heads))} foot={`CGST ${formatMoney(summary.outward.heads.cgst)} · SGST ${formatMoney(summary.outward.heads.sgst)} · IGST ${formatMoney(summary.outward.heads.igst)}`} />
          <Stat label="Purchases, GST included" icon={TruckIcon} value={formatMoney(figures.purchases)} foot={`GST on them ${formatMoney(figures.purchaseTax)}`} to="/gst/purchases" />
          <Stat
            label="Input tax credit"
            icon={CalculatorIcon}
            value={formatMoney(totalOf(summary.itc))}
            foot={`Claimed or eligible · ineligible ${formatMoney(totalOf(summary.ineligible))}${totalOf(summary.reversed) ? ` · reversed ${formatMoney(totalOf(summary.reversed))}` : ''}`}
            to="/gst/purchases"
          />
          <Stat label="Net GST payable" icon={ScalesIcon} value={formatMoney(cashTotal)} foot={totalOf(summary.utilisation.carried) ? `Credit carried forward ${formatMoney(totalOf(summary.utilisation.carried))}` : 'After input tax credit'} />
          <Stat
            label="GST paid"
            icon={BankIcon}
            value={formatMoney(paidTotal)}
            foot={paidTotal >= cashTotal ? (cashTotal ? 'Covers the net payable' : 'Nothing payable') : <span className="money-late">{formatMoney(cashTotal - paidTotal)} still to pay</span>}
            to="/gst/payments"
          />
        </div>

        <Card aria-labelledby="gstr3b-title" className="table-card">
          <CardHeader id="gstr3b-title" title={`GSTR-3B working · ${period.label}`} description="Output tax less input tax credit, used in the order GST law sets: IGST credit first; CGST and SGST credit never pay each other." />
          <div className="table-scroll">
            <table className="table">
              <caption className="visually-hidden">GSTR-3B working summary</caption>
              <thead>
                <tr>
                  <th scope="col">Head</th>
                  <th scope="col" className="is-num">
                    Output tax
                  </th>
                  <th scope="col" className="is-num">
                    Input tax credit
                  </th>
                  <th scope="col" className="is-num">
                    Paid by credit
                  </th>
                  <th scope="col" className="is-num">
                    Cash payable
                  </th>
                  <th scope="col" className="is-num">
                    Paid (challans)
                  </th>
                </tr>
              </thead>
              <tbody>
                {HEADS.map((head) => (
                  <tr key={head}>
                    <th scope="row">{NAME[head]}</th>
                    <td className="is-num">{formatMoney(summary.liability[head])}</td>
                    <td className="is-num">{formatMoney(summary.itc[head])}</td>
                    <td className="is-num">{formatMoney(summary.liability[head] - cash[head])}</td>
                    <td className="is-num" style={{ fontWeight: 600 }}>
                      {formatMoney(cash[head])}
                    </td>
                    <td className="is-num">{formatMoney(summary.paid[head])}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">Total</th>
                  <td className="is-num">{formatMoney(totalOf(summary.liability))}</td>
                  <td className="is-num">{formatMoney(totalOf(summary.itc))}</td>
                  <td className="is-num">{formatMoney(totalOf(summary.liability) - cashTotal)}</td>
                  <td className="is-num table__total">{formatMoney(cashTotal)}</td>
                  <td className="is-num">{formatMoney(paidTotal)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="card__body stack">
            {summary.utilisation.steps.length > 0 && (
              <div>
                <p className="field__label" style={{ marginBottom: 6 }}>
                  How the credit was used
                </p>
                <ul className="plain-list">
                  {summary.utilisation.steps.map((step, index) => (
                    <li key={index} className="num">
                      {NAME[step.from]} credit → {NAME[step.to]} tax: {formatMoney(step.amount)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <dl className="kv kv--compact">
              <dt>3.1(a) Outward taxable supplies</dt>
              <dd className="num">{formatMoney(summary.outward.taxable)} taxable</dd>
              <dt>3.1(c) Nil-rated (0%) supplies</dt>
              <dd className="num">{formatMoney(summary.nil.taxable)}</dd>
              <dt>3.2 Inter-state to unregistered</dt>
              <dd className="num">
                {formatMoney(summary.interstateUnregistered.taxable)} taxable · IGST {formatMoney(summary.interstateUnregistered.igst)}
              </dd>
              <dt>4(A) Input tax credit</dt>
              <dd className="num">{formatMoney(totalOf(summary.itc))}</dd>
              <dt>4(B) Reversed</dt>
              <dd className="num">{formatMoney(totalOf(summary.reversed))}</dd>
              <dt>4(D) Ineligible</dt>
              <dd className="num">{formatMoney(totalOf(summary.ineligible))}</dd>
              {(summary.paid.interest > 0 || summary.paid.penalty > 0) && (
                <>
                  <dt>Interest and penalty paid</dt>
                  <dd className="num">{formatMoney(summary.paid.interest + summary.paid.penalty)}</dd>
                </>
              )}
            </dl>
            {summary.eligibleNotClaimed > 0 && <p className="field__hint">{plural(summary.eligibleNotClaimed, 'bill')} marked eligible in this period are counted as credit; mark them claimed with the return month once filed.</p>}
          </div>
        </Card>

        <Card aria-labelledby="months-title">
          <CardHeader id="months-title" title="Output tax by month" description="GST on posted invoices over the last 12 months; input tax credit in the table below." />
          <div className="card__body">
            <AreaChart
              points={figures.months.map((month) => ({ key: month.period, label: periodLabel(month.period), axisLabel: periodLabel(month.period).slice(0, 3), value: month.output, detail: `Credit ${formatMoney(month.itc)}` }))}
              label="Output GST by month over the last 12 months"
              format={formatMoney}
              formatAxis={(value) => (value ? formatMoney(Math.round(value)) : '₹0')}
              height={200}
            />
            <details className="disclosure">
              <summary>Show as a table</summary>
              <div className="table-scroll">
                <table className="table">
                  <caption className="visually-hidden">Output tax and input tax credit by month</caption>
                  <thead>
                    <tr>
                      <th scope="col">Month</th>
                      <th scope="col" className="is-num">
                        Output GST
                      </th>
                      <th scope="col" className="is-num">
                        Input tax credit
                      </th>
                      <th scope="col" className="is-num">
                        Difference
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...figures.months].reverse().map((month) => (
                      <tr key={month.period}>
                        <td>{periodLabel(month.period)}</td>
                        <td className="is-num">{formatMoney(month.output)}</td>
                        <td className="is-num">{formatMoney(month.itc)}</td>
                        <td className="is-num">{formatMoney(month.output - month.itc)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </div>
        </Card>
      </div>
    </>
  );
}
