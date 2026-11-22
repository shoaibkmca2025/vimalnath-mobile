import { ArrowUUpLeftIcon, ArrowsLeftRightIcon, DownloadSimpleIcon, PlusIcon, WarningCircleIcon } from '@phosphor-icons/react';
import { useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';

import { Badge } from '@/components/Badge';
import { Button, ButtonLink } from '@/components/Button';
import { Card } from '@/components/Card';
import { DataTable, type Column } from '@/components/DataTable';
import { EmptyState } from '@/components/EmptyState';
import { SearchInput, Segmented } from '@/components/Field';
import { PageHeader } from '@/components/PageHeader';
import { ReturnStatusBadge } from '@/components/ReturnParts';
import { dayLabel } from '@/data/payments';
import { FLAGS, RETURN_KIND, RETURN_REASONS, RETURN_STATUS, canDo, isActive, moneyOf, waitingFor } from '@/data/returns';
import { readSession } from '@/data/session';
import type { SalesReturn } from '@/data/types';
import { useReturns } from '@/hooks/useReturns';
import { downloadCsv } from '@/lib/csv';
import { formatINR, plural } from '@/lib/format';

type Mode = 'all' | 'requests' | 'replacements';
type Show = 'open' | 'decide' | 'done' | 'stopped' | 'all';

const MODES: Record<Mode, { title: string; description: string; empty: string }> = {
  all: { title: 'Customer Returns', description: 'Goods customers bring back from delivered orders, for a refund or a replacement. Each moves stock and money only through its steps.', empty: 'No returns yet' },
  requests: { title: 'Return Requests', description: 'Returns waiting for a decision. Approving lets the goods come in; rejecting needs a reason the customer can be given.', empty: 'Nothing waiting for a decision' },
  replacements: { title: 'Product Replacements', description: 'Goods swapped for other goods. The difference is worked out from what was billed: the customer pays more, gets back the rest, or nothing changes hands.', empty: 'No replacements yet' },
};

const modeOf = (path: string): Mode => (path.startsWith('/returns/requests') ? 'requests' : path.startsWith('/returns/replacements') ? 'replacements' : 'all');

export default function ReturnsListPage() {
  const mode = modeOf(useLocation().pathname);
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { returns, settings, error } = useReturns();
  const [query, setQuery] = useState('');
  const role = readSession()?.role;
  const all = (returns ?? []).filter((ret) => (mode === 'replacements' ? ret.kind === 'replacement' : true));
  const groups: Record<Show, (ret: SalesReturn) => boolean> = {
    decide: (ret) => ret.status === 'pending' || ret.status === 'under_review',
    open: (ret) => isActive(ret.status) && ret.status !== 'closed',
    done: (ret) => ret.status === 'closed',
    stopped: (ret) => !isActive(ret.status),
    all: () => true,
  };
  const counts = Object.fromEntries((Object.keys(groups) as Show[]).map((key) => [key, all.filter(groups[key]).length])) as Record<Show, number>;
  const fallback: Show = mode === 'requests' ? 'decide' : 'open';
  const asked = params.get('show') as Show | null;
  const show: Show = asked && asked in groups ? asked : fallback;
  const setShow = (next: Show) => setParams(next === fallback ? {} : { show: next }, { replace: true });
  const needle = query.trim().toLowerCase();
  const rows = all.filter(
    (ret) =>
      groups[show](ret) &&
      (!needle || [ret.number, ret.customerName, ret.customerPhone ?? '', ret.orderNumber, ret.invoiceNumber ?? '', ...ret.items.map((item) => `${item.description} ${item.name}`)].some((text) => text.toLowerCase().includes(needle))),
  );

  const columns: Column<SalesReturn>[] = [
    {
      key: 'number',
      header: 'Return',
      sortValue: (ret) => ret.returnDate + ret.number,
      cell: (ret) => (
        <>
          <Link to={`/returns/${ret.id}`} className="cell-title num">
            {ret.number}
          </Link>
          <div className="cell-sub">{dayLabel(ret.returnDate)}</div>
        </>
      ),
    },
    {
      key: 'customer',
      header: 'Customer',
      sortValue: (ret) => ret.customerName,
      cell: (ret) => (
        <>
          {ret.customerName}
          <div className="cell-sub num">
            {ret.orderNumber}
            {ret.invoiceNumber ? ` · ${ret.invoiceNumber}` : ''}
          </div>
        </>
      ),
    },
    {
      key: 'items',
      header: 'Goods',
      cell: (ret) => (
        <>
          <span className="row" style={{ gap: 6 }}>
            {ret.kind === 'replacement' ? <ArrowsLeftRightIcon size={14} aria-label="Replacement" /> : <ArrowUUpLeftIcon size={14} aria-label="Refund" />}
            {plural(ret.items.length, 'item')}
          </span>
          <div className="cell-sub">{RETURN_REASONS[ret.reason]}</div>
        </>
      ),
    },
    {
      key: 'value',
      header: ret0Header(mode),
      align: 'num',
      sortValue: (ret) => ret.settleAmount,
      cell: (ret) => {
        const money = moneyOf(ret);
        return (
          <>
            <span style={{ fontWeight: 600 }}>{formatINR(Math.abs(ret.settleAmount))}</span>
            <div className="cell-sub">
              {ret.settleAmount > 0 ? (money.pendingOut ? `To refund ${formatINR(money.pendingOut)}` : 'Refunded') : ret.settleAmount < 0 ? (money.pendingIn ? `Customer pays ${formatINR(money.pendingIn)}` : 'Paid') : 'Even exchange'}
            </div>
          </>
        );
      },
    },
    {
      key: 'status',
      header: 'Status',
      sortValue: (ret) => Object.keys(RETURN_STATUS).indexOf(ret.status),
      cell: (ret) => {
        const waiting = isActive(ret.status) ? waitingFor(ret) : null;
        return (
          <>
            <ReturnStatusBadge status={ret.status} />
            {ret.flags.length > 0 && (
              <span style={{ marginLeft: 6 }}>
                <Badge tone="warning" icon={WarningCircleIcon}>
                  {ret.flags.map((flag) => FLAGS[flag]).join(', ')}
                </Badge>
              </span>
            )}
            {waiting && <div className="cell-sub">Waiting for: {waiting}</div>}
          </>
        );
      },
    },
  ];

  const mayCreate = canDo(settings, role, 'create');
  return (
    <>
      <PageHeader
        title={MODES[mode].title}
        description={MODES[mode].description}
        crumbs={[{ label: 'Returns', to: '/returns' }]}
        actions={
          <>
            {mayCreate && mode !== 'replacements' && (
              <ButtonLink to="/returns/new" variant="primary" icon={PlusIcon}>
                New Return
              </ButtonLink>
            )}
            {mayCreate && mode !== 'requests' && settings?.allowReplacements && (
              <ButtonLink to="/returns/new?kind=replacement" variant={mode === 'replacements' ? 'primary' : 'secondary'} icon={ArrowsLeftRightIcon}>
                New Replacement
              </ButtonLink>
            )}
            <Button
              icon={DownloadSimpleIcon}
              disabled={!rows.length}
              onClick={() =>
                downloadCsv(
                  `vimalnath-${mode === 'all' ? 'returns' : mode}`,
                  ['Return', 'Date', 'Type', 'Customer', 'Phone', 'Order', 'Invoice', 'Reason', 'Items', 'Goods back', 'Replacement', 'Charges', 'To settle', 'Refunded', 'Collected', 'Status', 'Flags'],
                  rows.map((ret) => {
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
                      ret.items.length,
                      ret.returnValue,
                      ret.replacementValue,
                      ret.charges,
                      ret.settleAmount,
                      money.paidOut,
                      money.paidIn,
                      RETURN_STATUS[ret.status].label,
                      ret.flags.map((flag) => FLAGS[flag]).join('; '),
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
      <div className="toolbar">
        <Segmented<Show>
          label="Show"
          value={show}
          onChange={setShow}
          options={[
            ...(mode === 'requests' ? [] : [{ value: 'open' as Show, label: 'Open', count: counts.open }]),
            { value: 'decide', label: 'To decide', count: counts.decide },
            { value: 'done', label: 'Closed', count: counts.done },
            { value: 'stopped', label: 'Rejected & cancelled', count: counts.stopped },
            { value: 'all', label: 'All', count: counts.all },
          ]}
        />
        <SearchInput label="Search returns" placeholder="Return, customer, phone, order, invoice or item" value={query} onChange={setQuery} />
      </div>
      <Card className="table-card">
        <DataTable
          caption={MODES[mode].title}
          rows={rows}
          columns={columns}
          getRowId={(ret) => ret.id}
          onRowClick={(ret) => navigate(`/returns/${ret.id}`)}
          initialSort={{ key: 'number', direction: 'desc' }}
          resetKey={`${show}|${needle}`}
          empty={
            <EmptyState icon={ArrowUUpLeftIcon} title={error ? 'Couldn’t load returns' : !returns ? 'Loading…' : needle ? `No return matches “${query.trim()}”` : MODES[mode].empty}>
              {error ?? (returns && !needle && mayCreate ? 'Start one from a delivered order: search it by its order or invoice number, or the customer.' : undefined)}
            </EmptyState>
          }
        />
      </Card>
    </>
  );
}

const ret0Header = (mode: Mode) => (mode === 'replacements' ? 'Difference' : 'Settlement');
