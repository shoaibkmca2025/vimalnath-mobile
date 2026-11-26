import {
  ArrowUUpLeftIcon,
  ArrowsLeftRightIcon,
  CheckCircleIcon,
  HandCoinsIcon,
  MagnifyingGlassIcon,
  NotePencilIcon,
  PackageIcon,
  PrinterIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

import { Badge } from '@/components/Badge';
import { Button, ButtonLink } from '@/components/Button';
import { Card, CardHeader } from '@/components/Card';
import { ConfirmDialog } from '@/components/Dialog';
import { Drawer } from '@/components/Drawer';
import { EmptyState } from '@/components/EmptyState';
import { SelectField, Switch, TextAreaField, TextField } from '@/components/Field';
import { PageHeader } from '@/components/PageHeader';
import { AttachButton, AttachmentList, ReturnStatusBadge, Steps } from '@/components/ReturnParts';
import { useToast } from '@/components/useToast';
import { billOf, dayLabel, localDay, paidOf } from '@/data/payments';
import {
  CONDITIONS,
  FLAGS,
  OUTCOMES,
  REFUND_METHODS,
  REFUND_NEXT,
  REFUND_STATUS,
  REPLACEMENT_STEPS,
  RETURN_KIND,
  RETURN_REASONS,
  RETURN_STATUS,
  RETURN_STEPS,
  SUGGESTED_OUTCOME,
  actionsFor,
  canDo,
  moneyOf,
  type ReturnActionKey,
} from '@/data/returns';
import { readSession } from '@/data/session';
import { BUCKET_LABEL, MOVE_LABEL, UNITS } from '@/data/stock';
import type { RefundMethod, RefundStatus, RefundTransaction, ReturnEvent, ReturnOutcome, ReturnSettings, ReturnStockMove, SalesReturn } from '@/data/types';
import { useData } from '@/data/useData';
import { useReturns } from '@/hooks/useReturns';
import { api } from '@/lib/api';
import { formatDateTime, formatINR, formatNumber } from '@/lib/format';

type Detail = { return: SalesReturn; events: ReturnEvent[]; moves: ReturnStockMove[] };

const ACTION_LABEL: Record<ReturnActionKey, string> = {
  review: 'Mark Under Review',
  approve: 'Approve Return',
  reject: 'Reject Return',
  edit: 'Edit',
  receive: 'Mark Product Received',
  inspect: 'Complete Quality Check',
  replace: 'Give Replacement',
  refund: 'Initiate Refund',
  collect: 'Collect Difference',
  creditNote: 'Issue Credit Note',
  close: 'Close Return',
  cancel: 'Cancel Return',
};
/** The step that moves a return on, shown as the main button. */
const PRIMARY: ReturnActionKey[] = ['approve', 'receive', 'inspect', 'replace', 'refund', 'collect', 'close'];

export default function ReturnDetailPage() {
  const { id } = useParams();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const { settings } = useReturns();
  const reload = useCallback(() => setAttempt((count) => count + 1), []);

  useEffect(() => {
    let active = true;
    api<Detail>(`/returns/${id}`).then(
      (loaded) => active && (setDetail(loaded), setError(null)),
      (problem: unknown) => active && setError(problem instanceof Error ? problem.message : 'Couldn’t load the return.'),
    );
    return () => {
      active = false;
    };
  }, [id, attempt]);

  if (!detail || detail.return.id !== id)
    return (
      <>
        <PageHeader title="Return" crumbs={[{ label: 'Customer Returns', to: '/returns/list' }]} />
        <Card>
          <EmptyState icon={ArrowUUpLeftIcon} title={error ? 'Couldn’t load the return' : 'Loading…'}>
            {error}
          </EmptyState>
        </Card>
      </>
    );
  return <ReturnView detail={detail} settings={settings} onChanged={reload} />;
}

function ReturnView({ detail, settings, onChanged }: { detail: Detail; settings: ReturnSettings | null; onChanged: () => void }) {
  const ret = detail.return;
  const navigate = useNavigate();
  const toast = useToast();
  const { send } = useData();
  const role = readSession()?.role;
  const [open, setOpen] = useState<ReturnActionKey | 'note' | null>(null);
  const [refundStep, setRefundStep] = useState<RefundTransaction | null>(null);
  const [busy, setBusy] = useState(false);
  const actions = actionsFor(ret, settings, role);
  const money = moneyOf(ret);
  const primary = PRIMARY.find((action) => actions.includes(action));
  const others = actions.filter((action) => action !== primary);
  const steps = ret.kind === 'replacement' ? REPLACEMENT_STEPS : RETURN_STEPS;
  const shownStatus = ret.status === 'under_review' ? 'pending' : ret.status;
  const stoppedAt = ret.status === 'rejected' || ret.status === 'cancelled' ? (detail.events.filter((event) => event.kind === 'status' && event.from).at(-1)?.from ?? 'pending') : null;

  /** Runs a step through the shared store (stock and orders it changed update everywhere), and logs it. */
  const act = async (path: string, body: Record<string, unknown>, summary: string, message: string) => {
    setBusy(true);
    const answer = await send(`/returns/${path}`, 'POST', { version: ret.version, ...body }, { area: 'returns', summary: `${summary} (${ret.number}, ${ret.customerName})`, to: `/returns/${ret.id}` });
    setBusy(false);
    if (!answer) {
      onChanged();
      return false;
    }
    window.dispatchEvent(new Event('vimalnath:returns-changed'));
    toast({ message });
    setOpen(null);
    setRefundStep(null);
    onChanged();
    return true;
  };

  const run = (action: ReturnActionKey) => {
    if (action === 'edit') navigate(`/returns/${ret.id}/edit`);
    else setOpen(action);
  };

  return (
    <>
      <PageHeader
        title={`${RETURN_KIND[ret.kind]} ${ret.number}`}
        crumbs={[{ label: ret.kind === 'replacement' ? 'Product Replacements' : 'Customer Returns', to: ret.kind === 'replacement' ? '/returns/replacements' : '/returns/list' }]}
        description={
          <>
            <ReturnStatusBadge status={ret.status} /> · {ret.customerName} ·{' '}
            {ret.orderId ? (
              <>
                order <Link to={`/orders/${ret.orderId}`}>{ret.orderNumber}</Link>
              </>
            ) : (
              <>
                counter bill <Link to={`/billing/${ret.invoiceId}`}>{ret.orderNumber}</Link>
              </>
            )}
            {ret.invoiceNumber && (
              <>
                {' '}
                · invoice <Link to={`/gst/invoices/${ret.invoiceId}`}>{ret.invoiceNumber}</Link>
              </>
            )}{' '}
            · {dayLabel(ret.returnDate)}
          </>
        }
        actions={
          <>
            {primary && (
              <Button variant="primary" icon={primary === 'refund' || primary === 'collect' ? HandCoinsIcon : primary === 'replace' ? ArrowsLeftRightIcon : CheckCircleIcon} onClick={() => run(primary)}>
                {ACTION_LABEL[primary]}
              </Button>
            )}
            <ButtonLink to={`/returns/${ret.id}/receipt`} icon={PrinterIcon}>
              Receipt
            </ButtonLink>
          </>
        }
      />

      <Card style={{ marginBottom: 'var(--space-5)' }}>
        <div className="card__body stack">
          <Steps steps={steps} labels={RETURN_STATUS} current={shownStatus === 'inspected' && ret.kind === 'replacement' ? 'received' : shownStatus} stopped={stoppedAt ? RETURN_STATUS[ret.status] : undefined} />
          <p className="muted" style={{ margin: 0 }}>
            {RETURN_STATUS[ret.status].description}
          </p>
          {ret.flags.length > 0 && (
            <p className="notice notice--warning" style={{ margin: 0 }}>
              <WarningCircleIcon size={16} weight="bold" aria-hidden />
              <span>Flagged: {ret.flags.map((flag) => FLAGS[flag]).join('; ')}. Approve only if that’s been agreed.</span>
            </p>
          )}
          {others.length > 0 && (
            <div className="row" style={{ gap: 'var(--space-2)', flexWrap: 'wrap' }}>
              {others.map((action) => (
                <Button key={action} size="sm" variant={action === 'reject' || action === 'cancel' ? 'danger-plain' : 'secondary'} onClick={() => run(action)}>
                  {ACTION_LABEL[action]}
                </Button>
              ))}
            </div>
          )}
        </div>
      </Card>

      <div className="editor">
        <div className="stack">
          <Card aria-labelledby="goods-title" className="table-card">
            <CardHeader id="goods-title" title="Goods coming back" description={RETURN_REASONS[ret.reason] + (ret.reasonNote ? `: ${ret.reasonNote}` : '')} />
            <div className="table-scroll">
              <table className="table">
                <caption className="visually-hidden">Returned goods</caption>
                <thead>
                  <tr>
                    <th scope="col">Item</th>
                    <th scope="col" className="is-num">
                      Qty
                    </th>
                    <th scope="col">Condition → check</th>
                    <th scope="col" className="is-num">
                      Value
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {ret.items.map((item) => (
                    <tr key={item.position}>
                      <td>
                        <div className="cell-title" style={{ whiteSpace: 'normal' }}>
                          {item.description}
                        </div>
                        <div className="cell-sub">
                          {item.name}
                          {item.hsn ? ` · HSN ${item.hsn}` : ''}
                        </div>
                      </td>
                      <td className="is-num" style={{ whiteSpace: 'nowrap' }}>
                        {formatNumber(item.qty)} {UNITS[item.unit]}
                      </td>
                      <td>
                        <div>{CONDITIONS[item.condition]}</div>
                        {item.outcome ? (
                          <>
                            <Badge tone={item.outcome === 'restock' ? 'success' : 'neutral'}>{OUTCOMES[item.outcome].label}</Badge>
                            <div className="cell-sub">
                              {item.inspectedBy}
                              {item.outcomeNote ? ` · ${item.outcomeNote}` : ''}
                            </div>
                          </>
                        ) : (
                          <div className="cell-sub">{ret.status === 'approved' || ret.status === 'pending' || ret.status === 'under_review' ? 'Checked when it comes in' : 'Not checked yet'}</div>
                        )}
                      </td>
                      <td className="is-num">
                        <strong>{formatINR(item.amount)}</strong>
                        <div className="cell-sub">{ret.invoiceId && item.cgst + item.sgst + item.igst > 0 ? `incl. ${formatINR(item.cgst + item.sgst + item.igst)} GST` : `${formatINR(item.rate)} each`}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {ret.kind === 'replacement' && (
            <Card aria-labelledby="swap-title" className="table-card">
              <CardHeader id="swap-title" title="Goods given in exchange" description={ret.status === 'replaced' || ret.status === 'closed' ? 'Given; taken out of stock.' : 'Taken out of stock when they’re given.'} />
              <div className="table-scroll">
                <table className="table">
                  <caption className="visually-hidden">Replacement goods</caption>
                  <thead>
                    <tr>
                      <th scope="col">Item</th>
                      <th scope="col" className="is-num">
                        Qty
                      </th>
                      <th scope="col" className="is-num">
                        Rate
                      </th>
                      <th scope="col" className="is-num">
                        Value
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {(ret.replacementItems ?? []).map((item) => (
                      <tr key={item.position}>
                        <td>
                          <div className="cell-title" style={{ whiteSpace: 'normal' }}>
                            {item.name}
                          </div>
                          <div className="cell-sub mono">{item.description}</div>
                        </td>
                        <td className="is-num" style={{ whiteSpace: 'nowrap' }}>
                          {formatNumber(item.qty)} {UNITS[item.unit]}
                        </td>
                        <td className="is-num">
                          {formatINR(item.rate)}
                          {item.discountPct ? <div className="cell-sub">less {item.discountPct}%</div> : null}
                        </td>
                        <td className="is-num">
                          <strong>{formatINR(item.amount)}</strong>
                          {item.cgst + item.sgst + item.igst > 0 && <div className="cell-sub">incl. {formatINR(item.cgst + item.sgst + item.igst)} GST</div>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          <Card aria-labelledby="money-title">
            <CardHeader
              id="money-title"
              title={ret.kind === 'replacement' ? 'Difference' : 'Refund'}
              description={
                ret.settleAmount > 0
                  ? money.pendingOut
                    ? `${formatINR(money.pendingOut)} still to refund.`
                    : 'Refunded in full.'
                  : ret.settleAmount < 0
                    ? money.pendingIn
                      ? `${formatINR(money.pendingIn)} still to collect from the customer.`
                      : 'The customer has paid the difference.'
                    : 'Nothing changes hands.'
              }
            />
            <div className="card__body stack">
              <dl className="kv kv--compact kv--split" style={{ margin: 0 }}>
                <dt>Goods coming back</dt>
                <dd className="num">{formatINR(ret.returnValue)}</dd>
                {ret.charges > 0 && (
                  <>
                    <dt>Charges{ret.chargesNote ? ` (${ret.chargesNote})` : ''}</dt>
                    <dd className="num">− {formatINR(ret.charges)}</dd>
                  </>
                )}
                {ret.kind === 'replacement' && (
                  <>
                    <dt>Goods given</dt>
                    <dd className="num">− {formatINR(ret.replacementValue)}</dd>
                  </>
                )}
                <dt style={{ fontWeight: 600, color: 'var(--text)' }}>{ret.settleAmount > 0 ? 'Refundable' : ret.settleAmount < 0 ? 'Customer pays' : 'Even'}</dt>
                <dd className="num" style={{ fontWeight: 700 }}>
                  {formatINR(Math.abs(ret.settleAmount))}
                </dd>
                {money.paidOut > 0 && (
                  <>
                    <dt>Refunded</dt>
                    <dd className="num">{formatINR(money.paidOut)}</dd>
                  </>
                )}
                {money.paidIn > 0 && (
                  <>
                    <dt>Collected</dt>
                    <dd className="num">{formatINR(money.paidIn)}</dd>
                  </>
                )}
              </dl>
              {(ret.refunds ?? []).length > 0 && (
                <ul className="refund-list">
                  {ret.refunds!.map((refund) => {
                    const next = REFUND_NEXT[refund.status] ?? [];
                    return (
                      <li key={refund.id} className="refund-list__item">
                        <span style={{ minWidth: 0 }}>
                          <strong className="num">
                            {refund.direction === 'in' ? 'In' : 'Out'} {formatINR(refund.amount)}
                          </strong>{' '}
                          · {REFUND_METHODS[refund.method]}
                          {refund.orderNumber ? ` (${refund.orderNumber})` : ''}
                          <div className="cell-sub">
                            {[refund.reference, refund.paidOn && dayLabel(refund.paidOn), refund.completedBy ? `by ${refund.completedBy}` : `entered by ${refund.createdBy}`, refund.note].filter(Boolean).join(' · ')}
                          </div>
                        </span>
                        <span className="row" style={{ gap: 6 }}>
                          <Badge tone={REFUND_STATUS[refund.status].tone}>{REFUND_STATUS[refund.status].label}</Badge>
                          {next.length > 0 && canDo(settings, role, 'refund') && (
                            <Button size="sm" variant="plain" onClick={() => setRefundStep(refund)}>
                              Update
                            </Button>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </Card>

          {(ret.invoiceId || ret.creditNote || ret.replacementInvoice) && (
            <Card aria-labelledby="gst-title">
              <CardHeader id="gst-title" title="GST" description="From the original tax invoice’s rates and HSN; the invoice itself never changes." />
              <div className="card__body">
                <dl className="kv kv--compact" style={{ margin: 0 }}>
                  <dt>Original invoice</dt>
                  <dd>
                    {ret.invoiceId ? (
                      <Link to={`/gst/invoices/${ret.invoiceId}`}>
                        {ret.invoiceNumber} · {ret.invoiceDate && dayLabel(ret.invoiceDate)}
                      </Link>
                    ) : (
                      'None from the admin'
                    )}
                  </dd>
                  <dt>Credit note</dt>
                  <dd>
                    {ret.creditNote ? (
                      <>
                        <span className="num">{ret.creditNote.number}</span> · {dayLabel(ret.creditNote.date)} · {formatINR(ret.creditNote.total)} (taxable {formatINR(ret.creditNote.taxable)},{' '}
                        {ret.interstate ? `IGST ${formatINR(ret.creditNote.igst)}` : `CGST ${formatINR(ret.creditNote.cgst)}, SGST ${formatINR(ret.creditNote.sgst)}`}){' '}
                        {ret.creditNote.status === 'cancelled' && <Badge tone="neutral">Cancelled</Badge>}
                      </>
                    ) : ret.invoiceId ? (
                      'Issued when the goods come back'
                    ) : (
                      'Not needed'
                    )}
                  </dd>
                  {ret.replacementInvoice && (
                    <>
                      <dt>Replacement invoice</dt>
                      <dd>
                        <Link to={`/gst/invoices/${ret.replacementInvoice.id}`}>{ret.replacementInvoice.number ?? 'Draft: post it'}</Link> · {formatINR(ret.replacementInvoice.total)}
                      </dd>
                    </>
                  )}
                </dl>
              </div>
            </Card>
          )}

          {detail.moves.length > 0 && (
            <Card aria-labelledby="moves-title" className="table-card">
              <CardHeader id="moves-title" title="Stock moved" description="Every change this return made, from the stock ledger." />
              <div className="table-scroll">
                <table className="table">
                  <caption className="visually-hidden">Stock movements</caption>
                  <thead>
                    <tr>
                      <th scope="col">When</th>
                      <th scope="col">Item</th>
                      <th scope="col">Movement</th>
                      <th scope="col" className="is-num">
                        Before
                      </th>
                      <th scope="col" className="is-num">
                        Change
                      </th>
                      <th scope="col" className="is-num">
                        After
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.moves.map((move) => {
                      const item = ret.items.find((one) => one.productId === move.productId && one.option === move.option) ?? ret.replacementItems?.find((one) => one.productId === move.productId && one.option === move.option);
                      return (
                        <tr key={move.id}>
                          <td className="num" style={{ whiteSpace: 'nowrap' }}>
                            {formatDateTime(move.at)}
                            <div className="cell-sub">{move.by}</div>
                          </td>
                          <td>{item?.description ?? move.productId}</td>
                          <td>
                            {MOVE_LABEL[move.kind]}
                            <div className="cell-sub">{BUCKET_LABEL[move.bucket]}</div>
                          </td>
                          <td className="is-num">{formatNumber(move.balance - move.change)}</td>
                          <td className="is-num">
                            {move.change > 0 ? '+' : '−'}
                            {formatNumber(Math.abs(move.change))}
                          </td>
                          <td className="is-num">{formatNumber(move.balance)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          <Card aria-labelledby="history-title">
            <CardHeader
              id="history-title"
              title="History"
              action={
                <Button size="sm" icon={NotePencilIcon} onClick={() => setOpen('note')}>
                  Add Note
                </Button>
              }
            />
            <ol className="timeline" aria-label="Return history">
              {[...detail.events].reverse().map((event) => (
                <li key={event.id} className="timeline__item">
                  <span className="timeline__dot" data-tone={event.to ? RETURN_STATUS[event.to].tone : 'neutral'} aria-hidden />
                  <span>
                    <strong>{eventTitle(event)}</strong>
                    {event.note && <div>{event.note}</div>}
                    <div className="cell-sub">
                      {event.by} · {formatDateTime(event.at)}
                    </div>
                  </span>
                </li>
              ))}
            </ol>
          </Card>
        </div>

        <div className="stack editor__aside">
          <Card aria-labelledby="customer-title">
            <CardHeader id="customer-title" title="Customer" />
            <div className="card__body">
              <dl className="kv kv--compact" style={{ margin: 0 }}>
                <dt>Name</dt>
                <dd>{ret.customerId ? <Link to={`/customers/${ret.customerId}`}>{ret.customerName}</Link> : ret.customerName}</dd>
                {ret.customerPhone && (
                  <>
                    <dt>Phone</dt>
                    <dd className="num">{ret.customerPhone}</dd>
                  </>
                )}
                <dt>Recorded</dt>
                <dd>
                  {ret.createdBy}, {formatDateTime(ret.createdAt)}
                </dd>
              </dl>
            </div>
          </Card>
          <Card aria-labelledby="files-title">
            <CardHeader id="files-title" title="Photos & documents" />
            <div className="card__body stack">
              {ret.attachments.length ? <AttachmentList files={ret.attachments} /> : <p className="muted" style={{ margin: 0 }}>None attached.</p>}
              <div>
                <AttachButton onAdd={(urls) => void act(`${ret.id}/notes`, { attachments: urls }, `Attached ${urls.length} file(s)`, 'Attached.')} disabled={busy} label="Attach" />
              </div>
            </div>
          </Card>
          {ret.notes && (
            <Card aria-labelledby="notes-title">
              <CardHeader id="notes-title" title="Internal notes" />
              <p className="card__body" style={{ margin: 0, whiteSpace: 'pre-line' }}>
                {ret.notes}
              </p>
            </Card>
          )}
        </div>
      </div>

      <SimpleStep
        open={open === 'approve'}
        title={`Approve ${ret.number}?`}
        body={`The customer can bring the goods back. ${ret.settleAmount > 0 ? `${formatINR(ret.settleAmount)} will be owed to them once they’re in.` : ret.settleAmount < 0 ? `They’ll owe ${formatINR(-ret.settleAmount)} for the replacement.` : ''}`}
        confirm="Approve Return"
        busy={busy}
        onClose={() => setOpen(null)}
        onConfirm={(note) => act(`${ret.id}/status`, { to: 'approved', note }, 'Approved return', `${ret.number} approved.`)}
      />
      <SimpleStep
        open={open === 'review'}
        title={`Look into ${ret.number}`}
        body="Marks it under review, so others know it’s being checked before a decision."
        confirm="Mark Under Review"
        busy={busy}
        onClose={() => setOpen(null)}
        onConfirm={(note) => act(`${ret.id}/status`, { to: 'under_review', note }, 'Put return under review', `${ret.number} is under review.`)}
      />
      <SimpleStep
        open={open === 'reject'}
        title={`Reject ${ret.number}?`}
        body="Nothing moves. The customer keeps the goods, and the quantity can be returned another time."
        confirm="Reject Return"
        destructive
        noteRequired="Reason for rejecting"
        busy={busy}
        onClose={() => setOpen(null)}
        onConfirm={(note) => act(`${ret.id}/status`, { to: 'rejected', note }, 'Rejected return', `${ret.number} rejected.`)}
      />
      <SimpleStep
        open={open === 'receive'}
        title="Goods received?"
        body={`${ret.items.map((item) => `${formatNumber(item.qty)} ${UNITS[item.unit]} ${item.description}`).join(', ')} go into stock awaiting the quality check${settings?.restockRule === 'unopened' ? ' (unopened goods straight back on sale)' : ''}.${ret.invoiceId && settings?.creditNoteOnReceipt && (ret.kind === 'refund' || settings.replacementTax === 'invoice') ? ' The GST credit note is issued now.' : ''}`}
        confirm="Mark Product Received"
        busy={busy}
        onClose={() => setOpen(null)}
        onConfirm={(note) => act(`${ret.id}/receive`, { note }, 'Received returned goods', 'Goods received.')}
        icon={PackageIcon}
      />
      <SimpleStep
        open={open === 'replace'}
        title="Give the replacement?"
        body={`${(ret.replacementItems ?? []).map((item) => `${formatNumber(item.qty)} ${UNITS[item.unit]} ${item.name}`).join(', ')} leave stock now.${ret.invoiceId && settings?.replacementTax === 'invoice' ? ' A tax invoice for them is drafted, to post from GST.' : ''}`}
        confirm="Give Replacement"
        busy={busy}
        onClose={() => setOpen(null)}
        onConfirm={(note) => act(`${ret.id}/replace`, { note }, 'Gave replacement goods', 'Replacement given.')}
      />
      <SimpleStep
        open={open === 'creditNote'}
        title="Issue the credit note?"
        body={`A GST credit note for ${formatINR(ret.returnValue)} against ${ret.invoiceNumber}, numbered in the ${settings?.creditNotePrefix ?? 'CN'} series.`}
        confirm="Issue Credit Note"
        busy={busy}
        withNote={false}
        onClose={() => setOpen(null)}
        onConfirm={() => act(`${ret.id}/credit-note`, {}, 'Issued credit note', 'Credit note issued.')}
      />
      <SimpleStep
        open={open === 'close'}
        title={`Close ${ret.number}?`}
        body="Everything is checked and settled. A closed return can’t change."
        confirm="Close Return"
        busy={busy}
        onClose={() => setOpen(null)}
        onConfirm={(note) => act(`${ret.id}/status`, { to: 'closed', note }, 'Closed return', `${ret.number} closed.`)}
      />
      <SimpleStep
        open={open === 'cancel'}
        title={`Cancel ${ret.number}?`}
        body={
          ret.status === 'received' || ret.status === 'inspected'
            ? 'A reversal: the stock it moved goes back where it came from, and its credit note is cancelled. It stays on record.'
            : 'It stays on record as cancelled. Nothing has moved yet.'
        }
        confirm="Cancel Return"
        destructive
        noteRequired="Why it’s cancelled"
        busy={busy}
        onClose={() => setOpen(null)}
        onConfirm={(note) => act(`${ret.id}/status`, { to: 'cancelled', note }, 'Cancelled return', `${ret.number} cancelled.`)}
      />
      <SimpleStep
        open={open === 'note'}
        title="Add a note"
        body="Only staff see it. It goes into the history with your name."
        confirm="Add Note"
        noteRequired="Note"
        busy={busy}
        onClose={() => setOpen(null)}
        onConfirm={(note) => act(`${ret.id}/notes`, { note }, 'Added a note', 'Note added.')}
      />
      <InspectDrawer open={open === 'inspect'} ret={ret} busy={busy} onClose={() => setOpen(null)} onSubmit={(items) => act(`${ret.id}/inspect`, { items }, 'Quality-checked returned goods', 'Quality check saved.')} />
      <RefundDrawer
        open={open === 'refund' || open === 'collect'}
        direction={open === 'collect' ? 'in' : 'out'}
        ret={ret}
        settings={settings}
        busy={busy}
        onClose={() => setOpen(null)}
        onSubmit={(body) =>
          act(`${ret.id}/refunds`, body, `${body.direction === 'in' ? 'Collected' : 'Refund'} ${formatINR(body.amount)} (${REFUND_METHODS[body.method]})${body.complete ? '' : ', pending'}`, body.complete ? 'Recorded.' : 'Refund entered as pending.')
        }
      />
      <RefundStepDrawer refund={refundStep} settings={settings} busy={busy} onClose={() => setRefundStep(null)} onSubmit={(refund, body) => act(`refunds/${refund.id}/status`, body, `Refund ${formatINR(refund.amount)} marked ${body.to}`, `Refund marked ${REFUND_STATUS[body.to].label.toLowerCase()}.`)} />
    </>
  );
}

function eventTitle(event: ReturnEvent) {
  if (event.kind === 'created') return 'Recorded';
  if (event.kind === 'edited') return 'Changed';
  if ((event.kind === 'status' || event.kind === 'received' || event.kind === 'inspected') && event.to && event.from !== event.to) return RETURN_STATUS[event.to].label;
  return { inspected: 'Quality checked', replaced: 'Replacement given', credit_note: 'Credit note', refund: 'Money', note: 'Note', attachment: 'Attachment', status: 'Status', received: 'Received', created: 'Recorded', edited: 'Changed' }[event.kind];
}

/** A step that only needs a yes, with an optional (or required) note. */
function SimpleStep({
  open,
  title,
  body,
  confirm,
  destructive,
  noteRequired,
  withNote = true,
  busy,
  onClose,
  onConfirm,
  icon,
}: {
  open: boolean;
  title: string;
  body: string;
  confirm: string;
  destructive?: boolean;
  noteRequired?: string;
  withNote?: boolean;
  busy: boolean;
  onClose: () => void;
  onConfirm: (note: string) => Promise<boolean>;
  icon?: typeof CheckCircleIcon;
}) {
  const [note, setNote] = useState('');
  const [touched, setTouched] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setNote('');
      setTouched(false);
    }
  }
  if (!withNote && !noteRequired) return <ConfirmDialog open={open} title={title} body={body} confirmLabel={confirm} destructive={destructive} onCancel={onClose} onConfirm={() => void onConfirm('')} />;
  const missing = noteRequired && !note.trim() ? `${noteRequired}: needed.` : null;
  return (
    <Drawer
      open={open}
      title={title}
      description={body}
      dirty={Boolean(note.trim())}
      onClose={onClose}
      onSubmit={() => {
        setTouched(true);
        if (!missing) void onConfirm(note.trim());
      }}
      footer={
        <>
          <Button onClick={onClose}>Back</Button>
          <Button type="submit" variant={destructive ? 'danger' : 'primary'} loading={busy} icon={icon}>
            {confirm}
          </Button>
        </>
      }
    >
      <TextAreaField label={noteRequired ?? 'Note (optional)'} required={Boolean(noteRequired)} value={note} onChange={(event) => setNote(event.target.value)} error={touched ? missing : null} rows={3} maxLength={500} />
    </Drawer>
  );
}

/** The quality check: where each item still unchecked goes. Suggested from its condition. */
function InspectDrawer({ open, ret, busy, onClose, onSubmit }: { open: boolean; ret: SalesReturn; busy: boolean; onClose: () => void; onSubmit: (items: { position: number; outcome: ReturnOutcome; note: string }[]) => Promise<boolean> }) {
  const pending = ret.items.filter((item) => !item.outcome);
  const [choices, setChoices] = useState<Record<number, { outcome: ReturnOutcome; note: string }>>({});
  const [touched, setTouched] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setChoices(Object.fromEntries(pending.map((item) => [item.position, { outcome: SUGGESTED_OUTCOME[item.condition], note: '' }])));
      setTouched(false);
    }
  }
  const needsWhy = (position: number) => {
    const item = ret.items.find((one) => one.position === position)!;
    const choice = choices[position];
    return choice?.outcome === 'restock' && ['damaged', 'defective', 'used', 'incomplete'].includes(item.condition) && !choice.note.trim();
  };
  const missing = pending.some((item) => needsWhy(item.position));
  return (
    <Drawer
      open={open}
      title="Quality check"
      description="Back on sale goes to stock that can be sold; damaged and defective stock is kept apart and never sold by mistake."
      onClose={onClose}
      onSubmit={() => {
        setTouched(true);
        if (!missing) void onSubmit(pending.map((item) => ({ position: item.position, outcome: choices[item.position]!.outcome, note: choices[item.position]!.note.trim() })));
      }}
      footer={
        <>
          <Button onClick={onClose}>Back</Button>
          <Button type="submit" variant="primary" loading={busy} icon={MagnifyingGlassIcon}>
            Complete Quality Check
          </Button>
        </>
      }
    >
      <div className="stack-lg">
        {pending.map((item) => {
          const choice = choices[item.position] ?? { outcome: SUGGESTED_OUTCOME[item.condition], note: '' };
          return (
            <fieldset key={item.position} className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="cell-title" style={{ marginBottom: 6 }}>
                {formatNumber(item.qty)} {UNITS[item.unit]} {item.description}
                <span className="cell-sub" style={{ display: 'block', fontWeight: 400 }}>
                  Came back {CONDITIONS[item.condition].toLowerCase()}
                </span>
              </legend>
              <SelectField
                label="Goes to"
                value={choice.outcome}
                onChange={(event) => setChoices((current) => ({ ...current, [item.position]: { ...choice, outcome: event.target.value as ReturnOutcome } }))}
                options={(Object.keys(OUTCOMES) as ReturnOutcome[]).map((outcome) => ({ value: outcome, label: `${OUTCOMES[outcome].label}: ${OUTCOMES[outcome].description}` }))}
              />
              <TextField
                label={needsWhy(item.position) || (choice.outcome === 'restock' && ['damaged', 'defective', 'used', 'incomplete'].includes(item.condition)) ? 'Why it can go back on sale' : 'Note (optional)'}
                value={choice.note}
                onChange={(event) => setChoices((current) => ({ ...current, [item.position]: { ...choice, note: event.target.value } }))}
                error={touched && needsWhy(item.position) ? 'It came back damaged or incomplete: say why it can be sold.' : null}
                maxLength={300}
              />
            </fieldset>
          );
        })}
      </div>
    </Drawer>
  );
}

type RefundBody = { direction: 'out' | 'in'; amount: number; method: RefundMethod; orderId: number | null; reference: string; paidOn: string; note: string; complete: boolean };

/** Money for a return: a refund out, or the difference collected in. */
function RefundDrawer({ open, direction, ret, settings, busy, onClose, onSubmit }: { open: boolean; direction: 'out' | 'in'; ret: SalesReturn; settings: ReturnSettings | null; busy: boolean; onClose: () => void; onSubmit: (body: RefundBody) => Promise<boolean> }) {
  const { db } = useData();
  const money = moneyOf(ret);
  const left = direction === 'out' ? money.leftOut : money.leftIn;
  const methods: RefundMethod[] = direction === 'in' ? ['cash', 'upi', 'bank', 'cheque'] : (settings?.refundMethods ?? ['cash']).filter((method) => method !== 'store_credit' || ret.customerId);
  const [draft, setDraft] = useState({ amount: '', method: methods[0] ?? 'cash', orderId: '', reference: '', paidOn: localDay(), note: '', complete: true });
  const [touched, setTouched] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setDraft({ amount: String(left), method: methods[0] ?? 'cash', orderId: '', reference: '', paidOn: localDay(), note: '', complete: !(settings?.refundApproval && direction === 'out' && !canDo(settings, readSession()?.role, 'approve')) });
      setTouched(false);
    }
  }
  // The customer's other orders that still owe something, for a refund set against one.
  const owing = db.orders.filter((order) => order.customerRecord?.id === ret.customerId && ['placed', 'confirmed', 'packed', 'dispatched', 'delivered'].includes(order.status) && billOf(order) - paidOf(order) > 0);
  const amount = /^\d+$/.test(draft.amount.trim()) ? Number(draft.amount.trim()) : NaN;
  const target = owing.find((order) => order.id === draft.orderId);
  const errors = {
    amount: !(amount > 0) ? 'Enter whole rupees.' : amount > left ? `Up to ${formatINR(left)}.` : target && amount > billOf(target) - paidOf(target) ? `${target.number} owes ${formatINR(billOf(target) - paidOf(target))}.` : null,
    orderId: draft.method === 'adjustment' && !draft.orderId ? 'Choose the order it pays.' : null,
    paidOn: draft.complete && draft.paidOn > localDay() ? 'The day can’t be in the future.' : null,
  };
  const invalid = Object.values(errors).some(Boolean);
  const approvalNeeded = Boolean(settings?.refundApproval && direction === 'out' && !canDo(settings, readSession()?.role, 'approve'));
  return (
    <Drawer
      open={open}
      title={direction === 'out' ? 'Refund' : 'Collect the difference'}
      description={`${ret.number} · ${formatINR(left)} ${direction === 'out' ? 'left to refund' : 'left to collect'}`}
      dirty={Boolean(draft.reference || draft.note)}
      onClose={onClose}
      onSubmit={() => {
        setTouched(true);
        if (!invalid)
          void onSubmit({ direction, amount, method: draft.method, orderId: draft.method === 'adjustment' ? Number(draft.orderId) : null, reference: draft.reference.trim(), paidOn: draft.paidOn, note: draft.note.trim(), complete: draft.complete });
      }}
      footer={
        <>
          <Button onClick={onClose}>Back</Button>
          <Button type="submit" variant="primary" loading={busy} icon={HandCoinsIcon}>
            {draft.complete ? (direction === 'out' ? 'Record Refund' : 'Record Payment') : 'Enter as Pending'}
          </Button>
        </>
      }
    >
      <div className="stack">
        <TextField label="Amount" prefix="₹" inputMode="numeric" value={draft.amount} onChange={(event) => setDraft({ ...draft, amount: event.target.value })} error={touched ? errors.amount : null} required />
        <SelectField
          label={direction === 'out' ? 'Refunded by' : 'Paid by'}
          value={draft.method}
          onChange={(event) => setDraft({ ...draft, method: event.target.value as RefundMethod })}
          options={methods.map((method) => ({ value: method, label: REFUND_METHODS[method] }))}
          hint={
            draft.method === 'store_credit'
              ? 'Held by the customer, to pay future orders from Payments.'
              : draft.method === 'adjustment'
                ? 'Recorded as a payment on that order.'
                : draft.method === 'original'
                  ? 'Back the way they paid; note how in the reference.'
                  : undefined
          }
        />
        {draft.method === 'adjustment' && (
          <SelectField
            label="Order it pays"
            value={draft.orderId}
            onChange={(event) => setDraft({ ...draft, orderId: event.target.value })}
            error={touched ? errors.orderId : null}
            options={[{ value: '', label: owing.length ? 'Choose an order…' : 'No order of theirs owes anything' }, ...owing.map((order) => ({ value: order.id, label: `${order.number} · owes ${formatINR(billOf(order) - paidOf(order))}` }))]}
          />
        )}
        <TextField label="Reference" value={draft.reference} onChange={(event) => setDraft({ ...draft, reference: event.target.value })} maxLength={100} placeholder="e.g. UPI ref 4471, cheque 004512" />
        <Switch
          label={direction === 'out' ? 'Paid already' : 'Received already'}
          description={approvalNeeded ? 'Refunds need approval first (Return Settings): it’s entered as pending.' : 'Off: entered as pending, to mark completed when it’s paid.'}
          checked={draft.complete && !approvalNeeded}
          disabled={approvalNeeded}
          onChange={(complete) => setDraft({ ...draft, complete })}
        />
        {draft.complete && <TextField label="Paid on" type="date" max={localDay()} value={draft.paidOn} onChange={(event) => setDraft({ ...draft, paidOn: event.target.value })} error={touched ? errors.paidOn : null} />}
        <TextField label="Note" value={draft.note} onChange={(event) => setDraft({ ...draft, note: event.target.value })} maxLength={300} />
      </div>
    </Drawer>
  );
}

/** A refund's next step: approved, processing, completed, failed, cancelled, or tried again. */
function RefundStepDrawer({ refund, settings, busy, onClose, onSubmit }: { refund: RefundTransaction | null; settings: ReturnSettings | null; busy: boolean; onClose: () => void; onSubmit: (refund: RefundTransaction, body: { to: RefundStatus; reference?: string; paidOn: string | null; note: string }) => Promise<boolean> }) {
  const role = readSession()?.role;
  const options = (refund ? (REFUND_NEXT[refund.status] ?? []) : []).filter((to) => to !== 'approved' || canDo(settings, role, 'approve'));
  const [to, setTo] = useState<RefundStatus | ''>('');
  const [reference, setReference] = useState('');
  const [paidOn, setPaidOn] = useState(localDay());
  const [note, setNote] = useState('');
  const [shownFor, setShownFor] = useState<string | null>(null);
  if ((refund?.id ?? null) !== shownFor) {
    setShownFor(refund?.id ?? null);
    if (refund) {
      setTo(options.includes('completed') ? 'completed' : (options[0] ?? ''));
      setReference(refund.reference ?? '');
      setPaidOn(localDay());
      setNote('');
    }
  }
  return (
    <Drawer
      open={Boolean(refund)}
      title="Update refund"
      description={refund ? `${refund.direction === 'in' ? 'Collection' : 'Refund'} of ${formatINR(refund.amount)} · ${REFUND_METHODS[refund.method]} · ${REFUND_STATUS[refund.status].label}` : ''}
      onClose={onClose}
      onSubmit={() => refund && to && void onSubmit(refund, { to, reference: reference.trim(), paidOn: to === 'completed' ? paidOn : null, note: note.trim() })}
      footer={
        <>
          <Button onClick={onClose}>Back</Button>
          <Button type="submit" variant={to === 'failed' || to === 'cancelled' ? 'danger' : 'primary'} loading={busy} disabled={!to}>
            Save
          </Button>
        </>
      }
    >
      <div className="stack">
        <SelectField label="Mark it" value={to} onChange={(event) => setTo(event.target.value as RefundStatus)} options={options.map((status) => ({ value: status, label: status === 'pending' ? 'Pending (try again)' : REFUND_STATUS[status].label }))} />
        <TextField label="Reference" value={reference} onChange={(event) => setReference(event.target.value)} maxLength={100} />
        {to === 'completed' && <TextField label="Paid on" type="date" max={localDay()} value={paidOn} onChange={(event) => setPaidOn(event.target.value)} />}
        <TextField label="Note" value={note} onChange={(event) => setNote(event.target.value)} maxLength={300} />
        {to === 'completed' && refund?.method === 'adjustment' && <p className="field__hint">Recorded as a payment on {refund.orderNumber}.</p>}
      </div>
    </Drawer>
  );
}

