import {
  ArrowUUpLeftIcon,
  ArrowsLeftRightIcon,
  CheckCircleIcon,
  ClockIcon,
  HandCoinsIcon,
  HourglassIcon,
  PackageIcon,
  PlusIcon,
  StorefrontIcon,
  TrayIcon,
} from '@phosphor-icons/react';
import { useEffect, useMemo, useState } from 'react';

import { ButtonLink } from '@/components/Button';
import { Card, CardHeader } from '@/components/Card';
import { AreaChart, BarList } from '@/components/Charts';
import { EmptyState } from '@/components/EmptyState';
import { SelectField, Segmented, TextField } from '@/components/Field';
import { PageHeader } from '@/components/PageHeader';
import { Stat } from '@/components/Stat';
import { localDay } from '@/data/payments';
import { CONDITIONS, PERIOD_LABEL, RETURN_REASONS, RETURN_STATUS, canDo, inFilter, periodOf, returnSummary, returnsByMonth, type PeriodChoice } from '@/data/returns';
import { readSession } from '@/data/session';
import type { ReturnCondition, ReturnReason, ReturnStatus, SupplierReturn } from '@/data/types';
import { useReturns } from '@/hooks/useReturns';
import { api } from '@/lib/api';
import { formatINR, formatINRCompact, formatNumber, plural } from '@/lib/format';

const monthName = new Intl.DateTimeFormat('en-IN', { month: 'short', year: 'numeric' });
const monthShort = new Intl.DateTimeFormat('en-IN', { month: 'short' });

/** Returns at a glance: how many, why, what, what they cost, and what's waiting. */
export default function ReturnsDashboardPage() {
  const { returns, settings, error } = useReturns();
  const role = readSession()?.role;
  const [period, setPeriod] = useState<PeriodChoice>('month');
  const [custom, setCustom] = useState({ from: '', to: '' });
  const [productId, setProductId] = useState('');
  const [customer, setCustomer] = useState('');
  const [status, setStatus] = useState<ReturnStatus | 'open' | ''>('');
  const [supplierReturns, setSupplierReturns] = useState<SupplierReturn[] | null>(null);

  // Supplier returns are Owners' (like purchases).
  useEffect(() => {
    if (role !== 'owner' && role !== 'accountant') return;
    let active = true;
    api<SupplierReturn[]>('/supplier-returns').then(
      (loaded) => active && setSupplierReturns(loaded),
      () => {},
    );
    return () => {
      active = false;
    };
  }, [role]);

  const all = useMemo(() => returns ?? [], [returns]);
  const range = periodOf(period, localDay(), custom);
  const filter = { ...range, productId: productId || undefined, customer: customer || undefined, status: status || undefined };
  const inPeriod = all.filter((ret) => inFilter(ret, filter));
  const summary = returnSummary(inPeriod);
  // The chart runs over the last 12 months whatever the period, with the other filters applied.
  const months = returnsByMonth(all.filter((ret) => inFilter(ret, { ...filter, from: '2000-01-01', to: localDay() })));
  const products = useMemo(() => {
    const seen = new Map<string, string>();
    for (const ret of all) for (const item of ret.items) seen.set(item.productId, item.name.split(' · ')[0] || item.description);
    return [...seen].sort((a, b) => a[1].localeCompare(b[1]));
  }, [all]);
  const customers = useMemo(() => [...new Set(all.map((ret) => ret.customerName))].sort(), [all]);
  const supplierCount = (supplierReturns ?? []).filter((one) => one.status !== 'cancelled' && one.returnDate >= range.from && one.returnDate <= range.to).length;

  return (
    <>
      <PageHeader
        title="Returns Dashboard"
        description="Customers’ returns and replacements, what they cost, and what’s waiting on someone."
        actions={
          canDo(settings, role, 'create') && (
            <ButtonLink to="/returns/new" variant="primary" icon={PlusIcon}>
              New Return
            </ButtonLink>
          )
        }
      />
      <div className="toolbar" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <Segmented<PeriodChoice>
          label="Period"
          value={period}
          onChange={setPeriod}
          options={(['today', 'week', 'month', 'fy', 'all', 'custom'] as PeriodChoice[]).map((value) => ({ value, label: PERIOD_LABEL[value] }))}
        />
        {period === 'custom' && (
          <>
            <TextField label="From" type="date" max={localDay()} value={custom.from} onChange={(event) => setCustom({ ...custom, from: event.target.value })} />
            <TextField label="To" type="date" max={localDay()} value={custom.to} onChange={(event) => setCustom({ ...custom, to: event.target.value })} />
          </>
        )}
        <SelectField label="Product" value={productId} onChange={(event) => setProductId(event.target.value)} options={[{ value: '', label: 'All products' }, ...products.map(([value, label]) => ({ value, label }))]} />
        <SelectField label="Customer" value={customer} onChange={(event) => setCustomer(event.target.value)} options={[{ value: '', label: 'All customers' }, ...customers.map((name) => ({ value: name, label: name }))]} />
        <SelectField
          label="Status"
          value={status}
          onChange={(event) => setStatus(event.target.value as ReturnStatus | 'open' | '')}
          options={[{ value: '', label: 'Any status' }, { value: 'open', label: 'Open' }, ...(Object.keys(RETURN_STATUS) as ReturnStatus[]).map((value) => ({ value, label: RETURN_STATUS[value].label }))]}
        />
      </div>

      {!returns ? (
        <Card>
          <EmptyState icon={ArrowUUpLeftIcon} title={error ? 'Couldn’t load returns' : 'Loading…'}>
            {error}
          </EmptyState>
        </Card>
      ) : (
        <div className="stack-lg">
          <div className="stats">
            <Stat label="Return requests" icon={TrayIcon} value={formatNumber(summary.total)} foot={`${PERIOD_LABEL[period]}${summary.rejected ? ` · ${summary.rejected} rejected` : ''}`} to="/returns/list?show=all" />
            <Stat label="Pending approvals" icon={HourglassIcon} value={formatNumber(summary.pending)} foot={summary.pending ? 'Waiting for a decision' : 'Nothing waiting'} to="/returns/requests" />
            <Stat label="Approved, in progress" icon={ClockIcon} value={formatNumber(summary.approved)} foot="Goods coming back or being checked" to="/returns/list" />
            <Stat label="Completed" icon={CheckCircleIcon} value={formatNumber(summary.completed)} foot="Refunded, replaced or closed" />
          </div>
          <div className="stats">
            <Stat label="Products returned" icon={PackageIcon} value={formatNumber(summary.items)} foot="Units, all items" />
            <Stat label="Refunded" icon={HandCoinsIcon} value={formatINRCompact(summary.refunded)} title={formatINR(summary.refunded)} foot={summary.pendingRefund ? `${formatINR(summary.pendingRefund)} still to refund` : 'Nothing left to refund'} to="/returns/refunds" />
            <Stat label="Replacements" icon={ArrowsLeftRightIcon} value={formatNumber(summary.replacements)} foot={`${plural(summary.refunds, 'refund return')} besides`} to="/returns/replacements" />
            {(role === 'owner' || role === 'accountant') && <Stat label="Supplier returns" icon={StorefrontIcon} value={formatNumber(supplierCount)} foot="Sent back to suppliers" to="/supplier-returns" />}
          </div>

          <Card aria-labelledby="month-title">
            <CardHeader id="month-title" title="Returns by month" description="The last 12 months, with the product, customer and status filters applied." />
            <div className="card__body">
              <AreaChart
                label="Returns each month"
                points={months.map((month) => ({ key: month.period, label: monthName.format(month.date), axisLabel: monthShort.format(month.date), value: month.count, detail: `${formatINR(month.value)} of goods` }))}
                format={(value) => plural(value, 'return')}
                formatAxis={(value) => (Number.isInteger(value) ? formatNumber(value) : '')}
              />
            </div>
          </Card>

          <div className="grid-2">
            <Card aria-labelledby="reasons-title">
              <CardHeader id="reasons-title" title="Why they come back" description="Returns by reason." />
              <div className="card__body">
                {summary.reasons.length ? (
                  <BarList label="Returns by reason" rows={summary.reasons.map(([reason, count]) => ({ key: reason, label: RETURN_REASONS[reason as ReturnReason], value: count }))} format={(value) => formatNumber(value)} />
                ) : (
                  <p className="muted">No returns in this period.</p>
                )}
              </div>
            </Card>
            <Card aria-labelledby="kind-title">
              <CardHeader id="kind-title" title="Refunds and replacements" description="How many of each, and the goods’ value." />
              <div className="card__body">
                {summary.refunds + summary.replacements ? (
                  <BarList
                    label="Refunds compared with replacements"
                    rows={[
                      { key: 'refund', label: 'Refunds', value: summary.refunds, detail: `${formatINR(summary.refundValue)} of goods` },
                      { key: 'replacement', label: 'Replacements', value: summary.replacements, detail: `${formatINR(summary.replacementValue)} of goods` },
                    ]}
                    format={(value) => formatNumber(value)}
                  />
                ) : (
                  <p className="muted">No returns in this period.</p>
                )}
              </div>
            </Card>
            <Card aria-labelledby="products-title">
              <CardHeader id="products-title" title="Most returned products" description="By quantity returned." />
              <div className="card__body">
                {summary.products.length ? (
                  <BarList
                    label="Most returned products"
                    rows={summary.products.map((product) => ({ key: product.name, label: product.name, value: product.qty, detail: `${plural(product.returns, 'return')} · ${formatINR(product.value)}` }))}
                    format={(value) => formatNumber(value)}
                  />
                ) : (
                  <p className="muted">No returns in this period.</p>
                )}
              </div>
            </Card>
            <Card aria-labelledby="condition-title">
              <CardHeader id="condition-title" title="Condition when returned" description="Returns with goods in each condition." />
              <div className="card__body">
                {summary.conditions.length ? (
                  <BarList label="Returns by product condition" rows={summary.conditions.map(([condition, count]) => ({ key: condition, label: CONDITIONS[condition as ReturnCondition], value: count }))} format={(value) => formatNumber(value)} />
                ) : (
                  <p className="muted">No returns in this period.</p>
                )}
              </div>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
