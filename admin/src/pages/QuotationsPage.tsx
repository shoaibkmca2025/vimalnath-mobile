import { CheckCircleIcon, FileTextIcon, HourglassIcon, NotePencilIcon, PlusIcon, ReceiptIcon } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';

import { Badge } from '@/components/Badge';
import { Button, ButtonLink } from '@/components/Button';
import { Card } from '@/components/Card';
import { DataTable, type Column } from '@/components/DataTable';
import { EmptyState } from '@/components/EmptyState';
import { SearchInput, SelectField } from '@/components/Field';
import { PageHeader } from '@/components/PageHeader';
import { Stat } from '@/components/Stat';
import { QUOTATION_STATUS, quotationState } from '@/data/billing';
import { dayLabel, localDay } from '@/data/payments';
import { formatMoney, r2 } from '@/data/purchases';
import { readSession } from '@/data/session';
import type { Quotation, QuotationStatus } from '@/data/types';
import { api } from '@/lib/api';
import { formatNumber, plural } from '@/lib/format';

/** Quotations: priced offers in their own QTN series, which become bills when the customer agrees. */
export default function QuotationsPage() {
  const navigate = useNavigate();
  const role = readSession()?.role;
  const today = localDay();
  const [quotes, setQuotes] = useState<Quotation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<QuotationStatus | ''>('');
  useEffect(() => {
    let active = true;
    api<Quotation[]>('/billing/quotations').then(
      (loaded) => active && setQuotes(loaded),
      (problem: unknown) => active && setError(problem instanceof Error ? problem.message : 'Couldn’t load quotations.'),
    );
    return () => {
      active = false;
    };
  }, []);
  const all = quotes ?? [];
  const needle = query.trim().toLowerCase();
  const rows = all.filter(
    (quote) =>
      (!needle || [quote.number, quote.customerName, quote.customerPhone ?? '', quote.customerGstin ?? ''].some((text) => text.toLowerCase().includes(needle))) && (!status || quotationState(quote, today) === status),
  );
  const open = all.filter((quote) => ['draft', 'sent', 'accepted'].includes(quotationState(quote, today)));
  const converted = all.filter((quote) => quote.status === 'converted');
  const decided = all.filter((quote) => !['draft', 'sent'].includes(quotationState(quote, today)));

  const columns: Column<Quotation>[] = [
    {
      key: 'number',
      header: 'Quotation',
      sortValue: (quote) => `${quote.quoteDate} ${quote.number}`,
      cell: (quote) => (
        <>
          <Link to={`/billing/quotations/${quote.id}`} className="cell-title num">
            {quote.number}
          </Link>
          <div className="cell-sub">
            {dayLabel(quote.quoteDate)}
            {quote.validUntil && ` · valid until ${dayLabel(quote.validUntil)}`}
          </div>
        </>
      ),
    },
    {
      key: 'customer',
      header: 'Customer',
      sortValue: (quote) => quote.customerName,
      cell: (quote) => (
        <>
          {quote.customerName}
          <div className="cell-sub">{quote.customerPhone ?? quote.customerGstin ?? ''}</div>
        </>
      ),
    },
    { key: 'items', header: 'Items', align: 'num', sortValue: (quote) => quote.items.length, cell: (quote) => formatNumber(quote.items.filter((item) => item.lineType !== 'charge').length) },
    { key: 'total', header: 'Total', align: 'num', sortValue: (quote) => quote.total, cell: (quote) => <strong>{formatMoney(quote.total)}</strong> },
    {
      key: 'status',
      header: 'Status',
      sortValue: (quote) => quotationState(quote, today),
      cell: (quote) => {
        const state = quotationState(quote, today);
        return (
          <>
            <Badge tone={QUOTATION_STATUS[state].tone}>{QUOTATION_STATUS[state].label}</Badge>
            {quote.invoiceId && (
              <div className="cell-sub">
                <Link to={`/billing/${quote.invoiceId}`}>{quote.invoiceNumber ?? 'Draft bill'}</Link>
              </div>
            )}
          </>
        );
      },
    },
  ];

  return (
    <>
      <PageHeader
        title="Quotations"
        crumbs={[{ label: 'Billing', to: '/billing' }]}
        description="Priced offers in their own series (QTN). When the customer agrees, convert one into a bill with the same lines; stock moves only when the bill is finalized."
        actions={
          (role === 'owner' || role === 'sales') && (
            <ButtonLink to="/billing/quotations/new" variant="primary" icon={PlusIcon}>
              New Quotation
            </ButtonLink>
          )
        }
      />
      {!quotes ? (
        <Card>
          <EmptyState icon={NotePencilIcon} title={error ? 'Couldn’t load quotations' : 'Loading…'}>
            {error}
          </EmptyState>
        </Card>
      ) : (
        <div className="stack-lg">
          <div className="stats">
            <Stat label="Open" icon={HourglassIcon} value={formatNumber(open.length)} foot={formatMoney(r2(open.reduce((sum, quote) => sum + quote.total, 0)))} />
            <Stat label="Converted to bills" icon={ReceiptIcon} value={formatNumber(converted.length)} foot={formatMoney(r2(converted.reduce((sum, quote) => sum + quote.total, 0)))} />
            <Stat label="Conversion rate" icon={CheckCircleIcon} value={decided.length ? `${Math.round((converted.length / decided.length) * 100)}%` : '—'} foot={`of ${plural(decided.length, 'decided quotation')}`} />
            <Stat label="All quotations" icon={FileTextIcon} value={formatNumber(all.length)} foot="This and earlier years" />
          </div>
          <div>
            <div className="toolbar" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <SearchInput label="Search quotations" placeholder="Number, customer, phone or GSTIN" value={query} onChange={setQuery} />
              <SelectField
                label="Status"
                value={status}
                onChange={(event) => setStatus(event.target.value as QuotationStatus | '')}
                options={[{ value: '', label: 'Any' }, ...(Object.keys(QUOTATION_STATUS) as QuotationStatus[]).map((value) => ({ value, label: QUOTATION_STATUS[value].label }))]}
              />
              {(needle || status) && (
                <Button
                  variant="plain"
                  onClick={() => {
                    setQuery('');
                    setStatus('');
                  }}
                >
                  Clear filters
                </Button>
              )}
            </div>
            <Card className="table-card">
              <DataTable
                caption="Quotations"
                rows={rows}
                columns={columns}
                getRowId={(quote) => quote.id}
                onRowClick={(quote) => navigate(`/billing/quotations/${quote.id}`)}
                initialSort={{ key: 'number', direction: 'desc' }}
                resetKey={`${needle}|${status}`}
                empty={
                  <EmptyState icon={NotePencilIcon} title={needle || status ? 'No quotations match' : 'No quotations yet'}>
                    {needle || status ? 'Clear a filter to see more.' : 'Make one with New Quotation: the same editor as a bill.'}
                  </EmptyState>
                }
              />
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
