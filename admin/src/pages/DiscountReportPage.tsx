import { ChartBarIcon, DownloadSimpleIcon, PercentIcon, ReceiptIcon, SealPercentIcon, TagIcon } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';

import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Card, CardHeader } from '@/components/Card';
import { BarList } from '@/components/Charts';
import { EmptyState } from '@/components/EmptyState';
import { GstRange } from '@/components/GstRange';
import { Segmented } from '@/components/Field';
import { PageHeader } from '@/components/PageHeader';
import { Stat } from '@/components/Stat';
import { discountGroups, type DiscountGroup } from '@/data/billing';
import { initialRange, resolveRange, type RangeState } from '@/data/gst';
import { dayLabel } from '@/data/payments';
import { formatMoney, r2 } from '@/data/purchases';
import type { DiscountReport } from '@/data/types';
import { api } from '@/lib/api';
import { downloadCsv } from '@/lib/csv';
import { formatDateTime, formatNumber } from '@/lib/format';

type By = 'category' | 'product' | 'employee' | 'day';
const BY_LABEL: Record<By, string> = { category: 'Category', product: 'Product', employee: 'Staff', day: 'Day' };
const DECISION: Record<string, { label: string; tone: 'warning' | 'success' | 'danger' | 'neutral' }> = {
  pending: { label: 'Waiting', tone: 'warning' },
  approved: { label: 'Approved', tone: 'success' },
  rejected: { label: 'Refused', tone: 'danger' },
  withdrawn: { label: 'Withdrawn', tone: 'neutral' },
};
const CHANGE: Record<string, string> = { rule_created: 'Rule set', rule_changed: 'Rule changed', rule_removed: 'Rule removed', level_changed: 'Staff level changed' };

/** Discounts given on finalized bills in a period: by category, product, staff member and day, with approvals and rule changes. */
export default function DiscountReportPage() {
  const [range, setRange] = useState<RangeState>(initialRange('month'));
  const [by, setBy] = useState<By>('category');
  const [report, setReport] = useState<DiscountReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const period = resolveRange(range);

  useEffect(() => {
    if (!period.from || !period.to) return;
    let active = true;
    api<DiscountReport>(`/discounts/report?from=${period.from}&to=${period.to}`).then(
      (loaded) => {
        if (!active) return;
        setReport(loaded);
        setError(null);
      },
      (problem: unknown) => active && setError(problem instanceof Error ? problem.message : 'Couldn’t load the report.'),
    );
    return () => {
      active = false;
    };
  }, [period.from, period.to]);

  const lines = report?.lines ?? [];
  const given = lines.filter((line) => line.discount > 0);
  const base = r2(lines.reduce((sum, line) => sum + line.base, 0));
  const discount = r2(lines.reduce((sum, line) => sum + line.discount, 0));
  const bills = new Set(given.map((line) => line.invoiceId)).size;
  const groups: Record<By, DiscountGroup[]> = {
    category: discountGroups(lines, (line) => line.categoryId ?? '', (line) => line.categoryLabel),
    product: discountGroups(lines, (line) => `${line.productId}\u0000${line.option}`, (line) => line.description || line.detail),
    employee: discountGroups(lines, (line) => line.by),
    day: discountGroups(lines, (line) => line.day, (line) => dayLabel(line.day)).sort((a, b) => b.key.localeCompare(a.key)),
  };
  const shown = groups[by];

  return (
    <>
      <PageHeader
        title="Discount Report"
        crumbs={[{ label: 'Billing', to: '/billing' }]}
        description="Discounts given on finalized bills, before GST: each line’s own discount and its share of the bill discount."
        actions={
          <Button
            icon={DownloadSimpleIcon}
            disabled={!lines.length}
            onClick={() =>
              downloadCsv(
                `vimalnath-discounts-${period.from}-${period.to}`,
                ['Date', 'Invoice', 'Customer', 'Item', 'Category', 'Qty', 'Value before discount', 'Discount', 'Discount %', 'Line %', 'Line ₹', 'Bill discount share', 'Rule', 'Rule min', 'Rule max', 'Given by', 'Approval'],
                lines.map((line) => [
                  line.day,
                  line.number,
                  line.customer,
                  line.description,
                  line.categoryLabel,
                  line.qty,
                  line.base,
                  line.discount,
                  line.effectivePct,
                  line.discountPct,
                  line.discountAmount,
                  line.billDiscount,
                  line.source ?? '',
                  line.ruleMin,
                  line.ruleMax,
                  line.by,
                  line.status,
                ]),
              )
            }
          >
            Export CSV
          </Button>
        }
      />
      <div className="stack-lg">
        <GstRange value={range} onChange={setRange} />
        {!report ? (
          <Card>
            <EmptyState icon={PercentIcon} title={error ? 'Couldn’t load the report' : 'Loading…'}>
              {error}
            </EmptyState>
          </Card>
        ) : (
          <>
            <div className="stats">
              <Stat label="Discount given" icon={PercentIcon} value={formatMoney(discount)} foot={`${period.label}`} />
              <Stat label="Average discount" icon={ChartBarIcon} value={base ? `${Math.round((discount / base) * 10000) / 100}%` : '—'} foot={`of ${formatMoney(base)} before discount`} />
              <Stat label="Bills with a discount" icon={ReceiptIcon} value={formatNumber(bills)} foot={`${formatNumber(given.length)} of ${formatNumber(lines.length)} lines`} />
              <Stat label="Approvals asked" icon={SealPercentIcon} value={formatNumber(report.decisions.length)} foot={`${formatNumber(report.decisions.filter((one) => one.status === 'approved').length)} approved`} />
            </div>

            <Card aria-labelledby="groups-title" className="table-card">
              <CardHeader
                id="groups-title"
                title={`By ${BY_LABEL[by].toLowerCase()}`}
                action={
                  <Segmented<By> label="Group by" value={by} onChange={setBy} options={(Object.keys(BY_LABEL) as By[]).map((value) => ({ value, label: BY_LABEL[value] }))} />
                }
              />
              {shown.length ? (
                <>
                  {by !== 'day' && (
                    <div className="card__body">
                      <BarList label={`Discount by ${BY_LABEL[by].toLowerCase()}`} rows={shown.map((group) => ({ key: group.key, label: group.label, value: group.discount, detail: `${group.pct}% of ${formatMoney(group.base)}` }))} format={formatMoney} />
                    </div>
                  )}
                  <div className="table-scroll">
                    <table className="table">
                      <caption className="visually-hidden">Discount by {BY_LABEL[by].toLowerCase()}</caption>
                      <thead>
                        <tr>
                          <th scope="col">{BY_LABEL[by]}</th>
                          <th scope="col" className="is-num">
                            Bills
                          </th>
                          <th scope="col" className="is-num">
                            Lines
                          </th>
                          <th scope="col" className="is-num">
                            Before discount
                          </th>
                          <th scope="col" className="is-num">
                            Discount
                          </th>
                          <th scope="col" className="is-num">
                            Average
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {shown.map((group) => (
                          <tr key={group.key}>
                            <th scope="row">{group.label}</th>
                            <td className="is-num">{formatNumber(group.bills)}</td>
                            <td className="is-num">{formatNumber(group.lines)}</td>
                            <td className="is-num">{formatMoney(group.base)}</td>
                            <td className="is-num">
                              <strong>{formatMoney(group.discount)}</strong>
                            </td>
                            <td className="is-num">{group.pct}%</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr>
                          <th scope="row">Total</th>
                          <td className="is-num">{formatNumber(new Set(lines.map((line) => line.invoiceId)).size)}</td>
                          <td className="is-num">{formatNumber(lines.length)}</td>
                          <td className="is-num">{formatMoney(base)}</td>
                          <td className="is-num">
                            <strong>{formatMoney(discount)}</strong>
                          </td>
                          <td className="is-num">{base ? `${Math.round((discount / base) * 10000) / 100}%` : '—'}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </>
              ) : (
                <EmptyState icon={TagIcon} title="No finalized bills in this period" />
              )}
            </Card>

            <div className="grid-2">
              <Card aria-labelledby="decisions-title">
                <CardHeader id="decisions-title" title="Approval history" description="Discounts above someone’s limit, and what was decided." />
                {report.decisions.length ? (
                  <ul className="list">
                    {report.decisions.map((one) => (
                      <li key={one.id} className="list-row">
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <span className="list-row__title">
                            {one.description} · {one.effectivePct}%
                          </span>
                          <div className="cell-sub">
                            {one.number ?? 'Draft'} · asked by {one.requestedBy} {formatDateTime(one.requestedAt)}
                            {one.decidedBy && ` · ${one.decidedBy}`}
                            {one.reason && `: ${one.reason}`}
                          </div>
                        </div>
                        <Badge tone={DECISION[one.status]?.tone ?? 'neutral'}>{DECISION[one.status]?.label ?? one.status}</Badge>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="card__body muted">No approvals asked in this period.</div>
                )}
              </Card>
              <Card aria-labelledby="changes-title">
                <CardHeader id="changes-title" title="Rule changes" description={<Link to="/billing/discounts">Discount Management</Link>} />
                {report.changes.length ? (
                  <ul className="list">
                    {report.changes.map((one) => (
                      <li key={one.id} className="list-row">
                        <div style={{ minWidth: 0 }}>
                          <span className="list-row__title">
                            {CHANGE[one.kind] ?? one.kind}: {one.subject}
                          </span>
                          <div className="cell-sub">
                            {formatDateTime(one.at)} · {one.by}
                            {describe(one.before, one.after)}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="card__body muted">No rules changed in this period.</div>
                )}
              </Card>
            </div>
          </>
        )}
      </div>
    </>
  );
}

/** A rule change in words: "5–15% → 5–20%". */
function describe(before: Record<string, unknown> | null, after: Record<string, unknown> | null) {
  const span = (rule: Record<string, unknown> | null) =>
    !rule ? '' : 'level' in rule ? `${rule.level}${rule.limitPct !== null && rule.limitPct !== undefined ? ` ${rule.limitPct}%` : ''}` : 'productRules' in rule ? (rule.productRules ? 'on' : 'off') : rule.enabled === false ? 'no discount' : rule.type === 'amount' ? `₹${rule.minAmount}–${rule.maxAmount ?? 'any'}` : `${rule.minPct}–${rule.maxPct}%`;
  const from = span(before);
  const to = span(after);
  return from && to ? ` · ${from} → ${to}` : to ? ` · ${to}` : from ? ` · was ${from}` : '';
}
