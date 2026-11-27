import { CheckIcon, SealPercentIcon, XIcon } from '@phosphor-icons/react';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';

import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Drawer } from '@/components/Drawer';
import { EmptyState } from '@/components/EmptyState';
import { Segmented, TextField } from '@/components/Field';
import { PageHeader } from '@/components/PageHeader';
import { useToast } from '@/components/useToast';
import { APPROVALS_CHANGED } from '@/data/approvalCount';
import { formatMoney } from '@/data/purchases';
import type { DiscountApproval, DiscountSetup } from '@/data/types';
import { api } from '@/lib/api';
import { formatDateTime, plural } from '@/lib/format';

const STATUS: Record<DiscountApproval['status'], { label: string; tone: 'warning' | 'success' | 'danger' | 'neutral' }> = {
  pending: { label: 'Waiting', tone: 'warning' },
  approved: { label: 'Approved', tone: 'success' },
  rejected: { label: 'Refused', tone: 'danger' },
  withdrawn: { label: 'Withdrawn', tone: 'neutral' },
};

/** Discounts above what their giver may give alone, for an Owner or discount admin to approve or refuse. */
export default function DiscountApprovalsPage() {
  const toast = useToast();
  const [rows, setRows] = useState<DiscountApproval[] | null>(null);
  const [me, setMe] = useState<DiscountSetup['me'] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'pending' | 'decided'>('pending');
  const [busy, setBusy] = useState<string | null>(null);
  const [refusing, setRefusing] = useState<DiscountApproval | null>(null);
  const [reason, setReason] = useState('');

  const load = useCallback(() => {
    let active = true;
    Promise.all([api<DiscountApproval[]>('/discounts/approvals'), api<DiscountSetup>('/discounts/rules')]).then(
      ([loaded, setup]) => {
        if (!active) return;
        setRows(loaded);
        setMe(setup.me);
      },
      (problem: unknown) => active && setError(problem instanceof Error ? problem.message : 'Couldn’t load approvals.'),
    );
    return () => {
      active = false;
    };
  }, []);
  useEffect(load, [load]);

  const decides = me?.level === 'owner' || me?.level === 'admin';
  const pending = (rows ?? []).filter((row) => row.status === 'pending');
  const decided = (rows ?? []).filter((row) => row.status !== 'pending');
  const shown = view === 'pending' ? pending : decided;

  const decide = async (row: DiscountApproval, approve: boolean, why = '') => {
    setBusy(row.id);
    try {
      await api(`/discounts/approvals/${row.id}/decide`, 'POST', { approve, reason: why });
      await api('/activity', 'POST', { area: 'orders', summary: `${approve ? 'Approved' : 'Refused'} a ${row.effectivePct}% discount on ${row.description} for ${row.customerName}`, to: `/billing/${row.invoiceId}` }).catch(() => null);
      toast({ message: approve ? `Approved: ${row.requestedBy} can finalize the bill.` : 'Refused. The bill must be brought within the limit.' });
      setRefusing(null);
      window.dispatchEvent(new Event(APPROVALS_CHANGED));
      load();
    } catch (problem) {
      toast({ tone: 'error', message: problem instanceof Error ? problem.message : 'Couldn’t record it.' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <PageHeader
        title="Discount Approvals"
        crumbs={[{ label: 'Billing', to: '/billing' }]}
        description="Discounts above what their giver may give alone. A bill can’t be finalized until each of its requests is approved."
      />
      {!rows ? (
        <Card>
          <EmptyState icon={SealPercentIcon} title={error ? 'Couldn’t load approvals' : 'Loading…'}>
            {error}
          </EmptyState>
        </Card>
      ) : (
        <div className="stack">
          <Segmented<'pending' | 'decided'>
            label="Show"
            value={view}
            onChange={setView}
            options={[
              { value: 'pending', label: `Waiting (${pending.length})` },
              { value: 'decided', label: 'Decided' },
            ]}
          />
          {!decides && pending.length > 0 && view === 'pending' && <p className="notice notice--info">An Owner or discount admin decides these. You’ll see the answer on the bill.</p>}
          {shown.length ? (
            <div className="stack">
              {shown.map((row) => (
                <Card key={row.id} className="approval">
                  <div className="card__body approval__body">
                    <div className="approval__main">
                      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                        <strong>{row.description}</strong>
                        {row.categoryLabel && <span className="cell-sub">{row.categoryLabel}</span>}
                        <Badge tone={STATUS[row.status].tone}>{STATUS[row.status].label}</Badge>
                      </div>
                      <div className="cell-sub">
                        <Link to={`/billing/${row.invoiceId}`}>{row.invoiceNumber ?? 'Draft bill'}</Link> · {row.customerName} · {row.qty} × {formatMoney(row.rate)}
                      </div>
                      <dl className="approval__facts">
                        <dt>Asked</dt>
                        <dd>
                          <strong>{row.effectivePct}%</strong>
                          {row.discountPct > 0 && row.discountAmount > 0 ? ` (${row.discountPct}% + ${formatMoney(row.discountAmount)})` : row.discountAmount > 0 ? ` (${formatMoney(row.discountAmount)} off)` : ''}
                        </dd>
                        <dt>Rule allows</dt>
                        <dd>
                          {row.ruleMin}% to {row.ruleMax}%
                        </dd>
                        <dt>{row.requestedBy} may give</dt>
                        <dd>up to {row.authority}%</dd>
                      </dl>
                      <div className="cell-sub">
                        Asked by {row.requestedBy} {formatDateTime(row.requestedAt)}
                        {row.decidedBy && ` · ${STATUS[row.status].label.toLowerCase()} by ${row.decidedBy} ${row.decidedAt ? formatDateTime(row.decidedAt) : ''}`}
                        {row.reason && `: ${row.reason}`}
                      </div>
                    </div>
                    {row.status === 'pending' && decides && (
                      <div className="approval__actions">
                        <Button variant="primary" icon={CheckIcon} loading={busy === row.id} onClick={() => void decide(row, true)}>
                          Approve
                        </Button>
                        <Button
                          variant="danger-plain"
                          icon={XIcon}
                          disabled={busy === row.id}
                          onClick={() => {
                            setReason('');
                            setRefusing(row);
                          }}
                        >
                          Refuse
                        </Button>
                      </div>
                    )}
                  </div>
                </Card>
              ))}
            </div>
          ) : (
            <Card>
              <EmptyState icon={SealPercentIcon} title={view === 'pending' ? 'Nothing waiting' : 'No decisions yet'}>
                {view === 'pending' ? 'Discounts above someone’s limit appear here when their bill is saved.' : `${plural(decided.length, 'decision')} so far.`}
              </EmptyState>
            </Card>
          )}
        </div>
      )}
      <Drawer
        open={refusing !== null}
        title="Refuse this discount?"
        description={refusing ? `${refusing.effectivePct}% on ${refusing.description}. ${refusing.requestedBy} sees the reason on the bill and brings the discount within the limit.` : undefined}
        dirty={Boolean(reason.trim())}
        onClose={() => setRefusing(null)}
        onSubmit={() => refusing && reason.trim() && void decide(refusing, false, reason.trim())}
        footer={
          <>
            <Button onClick={() => setRefusing(null)}>Keep It</Button>
            <Button type="submit" variant="danger" loading={busy === refusing?.id} disabled={!reason.trim()}>
              Refuse
            </Button>
          </>
        }
      >
        <TextField label="Reason" required value={reason} onChange={(event) => setReason(event.target.value)} maxLength={300} placeholder="e.g. Most we can do is 12%" />
      </Drawer>
    </>
  );
}
