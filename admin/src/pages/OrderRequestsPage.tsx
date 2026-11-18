import { ArrowRightIcon, PaperPlaneTiltIcon } from '@phosphor-icons/react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';

import { Badge } from '@/components/Badge';
import { ButtonLink } from '@/components/Button';
import { Card } from '@/components/Card';
import { DataTable, type Column } from '@/components/DataTable';
import { EmptyState } from '@/components/EmptyState';
import { SearchInput, Segmented } from '@/components/Field';
import { PageHeader } from '@/components/PageHeader';
import { itemCount } from '@/data/orders';
import { useRequestNotifications } from '@/data/requestNotifications';
import { REQUEST_STATE, isNew, isRequest, latestUpdate, requestState, requestUpdates, updateLabel, type RequestState } from '@/data/requests';
import { useData } from '@/data/useData';
import type { Order } from '@/data/types';
import { formatDateTime, formatINR, formatRelativeDay, plural, relativePhrase } from '@/lib/format';

type Filter = 'all' | RequestState;
const FILTERS: Filter[] = ['all', 'waiting', 'confirmed', 'declined', 'cancelled'];
const FILTER_LABEL: Record<Filter, string> = { all: 'All', waiting: 'Waiting', confirmed: 'Confirmed', declined: 'Declined', cancelled: 'Cancelled' };

/**
 * Orders the shop sends to customers' apps, with every update until the customer confirms: sent, received in
 * their app, then confirmed (it moves to Orders and the inventory team) or declined.
 */
export default function OrderRequestsPage() {
  const { db } = useData();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const filter: Filter = (FILTERS as string[]).includes(params.get('state') ?? '') ? (params.get('state') as Filter) : 'all';

  const requests = useMemo(() => db.orders.filter(isRequest), [db.orders]);
  const { seen, markSeen } = useRequestNotifications(db.orders);
  // What was new when the page opened stays marked while it's open, even though the badge clears.
  const [openedSeen] = useState(seen);
  useEffect(() => markSeen(), [markSeen]);

  const counts = useMemo(() => {
    const map: Record<string, number> = { all: requests.length };
    for (const order of requests) map[requestState(order)] = (map[requestState(order)] ?? 0) + 1;
    return map;
  }, [requests]);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const digits = needle.replace(/\D/g, '');
    return requests.filter(
      (order) =>
        (filter === 'all' || requestState(order) === filter) &&
        (!needle ||
          [order.number, order.customer, order.appUser?.label ?? '', ...order.lines.map((line) => line.code)].some((field) => field.toLowerCase().includes(needle)) ||
          (digits.length >= 4 && (order.phone ?? '').replace(/\D/g, '').includes(digits))),
    );
  }, [requests, filter, query]);

  const columns: Column<Order>[] = [
    {
      key: 'number',
      header: 'Request',
      sortValue: (order) => order.number,
      cell: (order) => (
        <>
          <Link to={`/orders/${order.id}`} className="cell-title num">
            {order.number}
          </Link>
          <div className="cell-sub">Sent {relativePhrase(formatRelativeDay(order.createdAt))}</div>
        </>
      ),
    },
    {
      key: 'customer',
      header: 'Customer',
      sortValue: (order) => order.customer,
      cell: (order) => (
        <>
          {order.customer}
          <div className="cell-sub">{order.appUser ? `App: ${order.appUser.label}` : (order.phone ?? '')}</div>
        </>
      ),
    },
    {
      key: 'total',
      header: 'Total (MRP)',
      align: 'num',
      sortValue: (order) => order.total,
      cell: (order) => (
        <>
          {formatINR(order.total)}
          <div className="cell-sub">{plural(itemCount(order), 'item')}</div>
        </>
      ),
    },
    {
      key: 'state',
      header: 'Status',
      sortValue: (order) => FILTERS.indexOf(requestState(order)),
      cell: (order) => {
        const state = requestState(order);
        const fresh = requestUpdates(order).some((update) => isNew(update, openedSeen));
        return (
          <span className="stack" style={{ gap: 4, alignItems: 'flex-start' }}>
            <Badge tone={REQUEST_STATE[state].tone}>{REQUEST_STATE[state].label}</Badge>
            {fresh && <span className="new-pill">New</span>}
          </span>
        );
      },
    },
    {
      key: 'updates',
      header: 'Updates',
      sortValue: (order) => latestUpdate(order),
      cell: (order) => <Updates order={order} seen={openedSeen} />,
    },
  ];

  return (
    <>
      <PageHeader
        title="Order Requests"
        description="Send an order to a customer’s app. Every update shows here until they confirm it; then it moves to Orders and the inventory team."
        actions={
          <ButtonLink to="/order-requests/new" variant="primary" icon={PaperPlaneTiltIcon}>
            Request Order
          </ButtonLink>
        }
      />

      <div className="toolbar">
        <Segmented<Filter>
          label="Show requests that are"
          value={filter}
          onChange={(value) => setParams(value === 'all' ? {} : { state: value }, { replace: true })}
          options={FILTERS.map((value) => ({ value, label: FILTER_LABEL[value], count: counts[value] ?? 0 }))}
        />
        <SearchInput label="Search requests" placeholder="Request, customer, phone or product code" value={query} onChange={setQuery} />
      </div>

      <Card className="table-card">
        <DataTable
          caption="Order requests"
          rows={rows}
          columns={columns}
          getRowId={(order) => order.id}
          onRowClick={(order) => navigate(`/orders/${order.id}`)}
          resetKey={`${filter}|${query}`}
          initialSort={{ key: 'updates', direction: 'desc' }}
          empty={
            <EmptyState
              icon={PaperPlaneTiltIcon}
              title={requests.length ? 'No requests match' : 'No order requests yet'}
              action={
                !requests.length && (
                  <ButtonLink to="/order-requests/new" variant="primary" icon={PaperPlaneTiltIcon}>
                    Request Order
                  </ButtonLink>
                )
              }
            >
              {requests.length ? 'Try a different status or search.' : 'Make an order for a customer and send it to their app. You’ll see here when they receive and confirm it.'}
            </EmptyState>
          }
        />
      </Card>
    </>
  );
}

function Updates({ order, seen }: { order: Order; seen: number }) {
  const updates = requestUpdates(order);
  const state = requestState(order);
  return (
    <ol className="request-updates" aria-label={`Updates for ${order.number}`}>
      {updates.map((update) => (
        <li key={`${update.kind}-${update.at}`} data-kind={update.kind} data-new={isNew(update, seen) || undefined}>
          <span className="request-updates__label">{updateLabel(update)}</span>
          <span className="cell-sub">
            {formatDateTime(update.at)}
            {update.by !== 'App' && ` · ${update.by}`}
          </span>
        </li>
      ))}
      {state === 'waiting' && !order.customerSeenAt && (
        <li data-kind="pending">
          <span className="request-updates__label muted">Not received yet</span>
          <span className="cell-sub">Their app gets it the next time it syncs.</span>
        </li>
      )}
      {state === 'confirmed' && (
        <li data-kind="link">
          <Link to={`/orders/${order.id}`} className="row" style={{ gap: 4 }} onClick={(event) => event.stopPropagation()}>
            Now in Orders, {order.status === 'confirmed' ? 'pending with inventory' : order.status} <ArrowRightIcon size={12} aria-hidden />
          </Link>
        </li>
      )}
    </ol>
  );
}
