import {
  ArrowCounterClockwiseIcon,
  ChatCircleTextIcon,
  CheckCircleIcon,
  CopyIcon,
  FilePdfIcon,
  HourglassIcon,
  PencilSimpleIcon,
  PrinterIcon,
  ReceiptIcon,
  TrashIcon,
  WalletIcon,
  WarningCircleIcon,
  XCircleIcon,
} from '@phosphor-icons/react';
import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';

import { Badge } from '@/components/Badge';
import { BillDocument } from '@/components/BillDocument';
import { Button, ButtonLink } from '@/components/Button';
import { Card, CardHeader } from '@/components/Card';
import { ConfirmDialog } from '@/components/Dialog';
import { Drawer } from '@/components/Drawer';
import { EmptyState } from '@/components/EmptyState';
import { Segmented, SelectField, TextField } from '@/components/Field';
import { PageHeader } from '@/components/PageHeader';
import { useToast } from '@/components/useToast';
import { BILL_METHODS, DISCOUNT_TYPE, PAY_STATUS, balanceOf, discountsOf, pageRule } from '@/data/billing';
import { INVOICE_STATUS, invoiceDay, printUnit } from '@/data/gst';
import { whatsappLink } from '@/data/orders';
import { localDay } from '@/data/payments';
import { formatMoney, parseMoney, r2 } from '@/data/purchases';
import { readSession } from '@/data/session';
import { MOVE_LABEL } from '@/data/stock';
import type { BillDetail, BillPaymentMethod, BillingSettings, SalesInvoice } from '@/data/types';
import { useData } from '@/data/useData';
import { useBilling } from '@/hooks/useBilling';
import { ApiError, api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';

const EVENT_LABEL: Record<BillDetail['events'][number]['kind'], string> = {
  created: 'Made',
  edited: 'Changed',
  finalized: 'Finalized',
  reopened: 'Reopened to correct',
  payment: 'Payment received',
  payment_voided: 'Payment voided',
  cancelled: 'Cancelled',
  duplicated: 'Duplicated',
  converted: 'Made from a quotation',
  credit_note: 'Credit note',
};
const TEMPLATE_LABEL: Record<BillingSettings['template'] | 'thermal', string> = { classic: 'Classic', modern: 'Modern', compact: 'Compact', thermal: 'Thermal' };

/** One bill: the document as it prints, and everything done to it (payments, history, stock). */
export default function BillPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { db } = useData();
  const role = readSession()?.role;
  const owner = role === 'owner';
  const maker = role === 'owner' || role === 'sales';
  const canVoid = role === 'owner' || role === 'accountant';
  const { setup, error: setupError } = useBilling({ invoices: false });
  const [detail, setDetail] = useState<BillDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<BillingSettings['template'] | 'thermal' | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'finalize' | 'delete' | 'reopen' | 'cancel' | 'pay' | { void: string } | null>(null);

  const load = useCallback(() => {
    let active = true;
    api<BillDetail>(`/billing/invoices/${id}`).then(
      (loaded) => {
        if (!active) return;
        setDetail(loaded);
        setError(null);
      },
      (problem: unknown) => active && setError(problem instanceof Error ? problem.message : 'Couldn’t load the bill.'),
    );
    return () => {
      active = false;
    };
  }, [id]);
  useEffect(load, [load]);

  const invoice = detail?.invoice;
  // Printing names the PDF after the bill, and sizes the page as Invoice Settings say.
  useEffect(() => {
    if (!invoice) return;
    const before = document.title;
    document.title = invoice.number ?? 'Draft bill';
    return () => {
      document.title = before;
    };
  }, [invoice]);

  if (detail && detail.invoice.source !== 'counter') return <Navigate to={`/gst/invoices/${detail.invoice.id}`} replace />;
  if (!detail || !setup || !invoice)
    return (
      <>
        <PageHeader title="Bill" crumbs={[{ label: 'Billing', to: '/billing' }]} />
        <Card>
          <EmptyState icon={ReceiptIcon} title={error || setupError ? 'Couldn’t load the bill' : 'Loading…'}>
            {error ?? setupError}
          </EmptyState>
        </Card>
      </>
    );

  const settings = setup.settings;
  const state = balanceOf(invoice, localDay());
  const pending = invoice.items.filter((item) => item.discountStatus === 'pending').length;
  const rejected = invoice.items.filter((item) => item.discountStatus === 'rejected').length;
  const activePayments = detail.payments.filter((payment) => !payment.voidedAt);
  const paper = view === 'thermal' ? 'thermal' : view ? (settings.paperSize === 'thermal' ? 'A4' : settings.paperSize) : settings.paperSize;
  const template = view && view !== 'thermal' ? view : settings.template;
  const productName = (productId: string, option: string) => {
    const product = db.products.find((one) => one.id === productId);
    return product ? `${product.code || product.name}${option ? ` · ${option}` : ''}` : productId;
  };

  const act = async (name: string, run: () => Promise<unknown>, done: string) => {
    setBusy(name);
    try {
      await run();
      toast({ message: done });
      setDialog(null);
      load();
    } catch (problem) {
      toast({ tone: 'error', message: problem instanceof Error ? problem.message : 'Something went wrong.' });
    } finally {
      setBusy(null);
    }
  };
  const finalize = () =>
    act(
      'finalize',
      async () => {
        const answer = await api<{ invoices: SalesInvoice[] }>(`/billing/invoices/${invoice.id}/finalize`, 'POST', { version: invoice.version });
        const saved = answer.invoices[0]!;
        await api('/activity', 'POST', { area: 'orders', summary: `Billed ${saved.number} to ${saved.customerName} (${formatMoney(saved.total)})`, to: `/billing/${saved.id}` }).catch(() => null);
      },
      invoice.number ? `${invoice.number} posted again.` : 'Bill finalized.',
    );
  const remove = () =>
    act(
      'delete',
      async () => {
        await api(`/billing/invoices/${invoice.id}`, 'DELETE');
        navigate('/billing', { replace: true });
      },
      'Draft deleted.',
    );
  const duplicate = () =>
    act(
      'duplicate',
      async () => {
        const answer = await api<{ invoices: SalesInvoice[] }>(`/billing/invoices/${invoice.id}/duplicate`, 'POST');
        navigate(`/billing/${answer.invoices[0]!.id}/edit`);
      },
      'Copied to a new draft, dated today.',
    );
  const share = () => {
    const lines = [
      `Dear ${invoice.customerName},`,
      `${invoice.number ? `Invoice ${invoice.number}` : 'Your bill'} dated ${invoiceDay(invoice.invoiceDate)}: ${formatMoney(invoice.total)}.`,
      state.balance > 0 && invoice.status === 'posted' ? `Balance due ${formatMoney(state.balance)}${invoice.dueDate ? ` by ${invoiceDay(invoice.dueDate)}` : ''}.` : invoice.status === 'posted' ? 'Paid in full. Thank you!' : '',
      settings.bankAccount && state.balance > 0 ? `Bank: ${[settings.bankName, settings.bankAccount, settings.bankBranchIfsc].filter(Boolean).join(', ')}` : '',
      settings.tradeName || settings.legalName,
    ].filter(Boolean);
    const base = invoice.customerPhone ? whatsappLink(invoice.customerPhone) : 'https://wa.me/';
    window.open(`${base}?text=${encodeURIComponent(lines.join('\n'))}`, '_blank', 'noopener');
  };
  const print = () => window.print();

  const statusBadge = invoice.status === 'draft' && invoice.number ? 'Reopened' : INVOICE_STATUS[invoice.status].label;
  return (
    <>
      <style>{pageRule(paper)}</style>
      <PageHeader
        title={invoice.number ? `Invoice ${invoice.number}` : 'Draft bill'}
        crumbs={[{ label: 'Billing', to: '/billing' }]}
        description={
          <span className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <Badge tone={INVOICE_STATUS[invoice.status].tone}>{statusBadge}</Badge>
            {invoice.status === 'posted' && <Badge tone={PAY_STATUS[state.status].tone}>{PAY_STATUS[state.status].label}</Badge>}
            <span>
              {invoice.customerName} · {formatMoney(invoice.total)}
              {invoice.postedAt && invoice.status === 'posted' && ` · finalized ${formatDateTime(invoice.postedAt)} by ${invoice.postedBy}`}
              {invoice.quotationId && (
                <>
                  {' · from '}
                  <Link to={`/billing/quotations/${invoice.quotationId}`}>{invoice.quotationNumber}</Link>
                </>
              )}
            </span>
          </span>
        }
        actions={
          <span className="row no-print" style={{ gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            {invoice.status === 'draft' && maker && (
              <>
                <ButtonLink to={`/billing/${invoice.id}/edit`} icon={PencilSimpleIcon}>
                  Edit
                </ButtonLink>
                <Button variant="primary" icon={CheckCircleIcon} disabled={pending > 0 || rejected > 0} onClick={() => setDialog('finalize')}>
                  Finalize
                </Button>
              </>
            )}
            {invoice.status !== 'cancelled' && maker && state.balance > 0 && (
              <Button icon={WalletIcon} onClick={() => setDialog('pay')}>
                {invoice.status === 'draft' ? 'Take Advance' : 'Record Payment'}
              </Button>
            )}
            <Button icon={PrinterIcon} onClick={print}>
              Print
            </Button>
            <Button icon={FilePdfIcon} onClick={print} title="Choose Save as PDF in the print window">
              PDF
            </Button>
            <Button icon={ChatCircleTextIcon} onClick={share}>
              WhatsApp
            </Button>
            {maker && (
              <Button icon={CopyIcon} loading={busy === 'duplicate'} onClick={duplicate}>
                Duplicate
              </Button>
            )}
            {invoice.status === 'posted' && owner && (
              <Button variant="plain" icon={ArrowCounterClockwiseIcon} onClick={() => setDialog('reopen')}>
                Reopen
              </Button>
            )}
            {invoice.status === 'posted' && (owner || role === 'accountant') && (
              <ButtonLink variant="plain" icon={ReceiptIcon} to={`/returns/new?invoiceId=${invoice.id}`}>
                Credit Note
              </ButtonLink>
            )}
            {invoice.status === 'posted' && canVoid && (
              <Button variant="danger-plain" icon={XCircleIcon} onClick={() => setDialog('cancel')}>
                Cancel Bill
              </Button>
            )}
            {invoice.status === 'draft' && !invoice.number && maker && (
              <Button variant="danger-plain" icon={TrashIcon} onClick={() => setDialog('delete')}>
                Delete Draft
              </Button>
            )}
          </span>
        }
      />

      <div className="stack no-print" style={{ marginBottom: 'var(--space-4)' }}>
        {invoice.status === 'cancelled' && (
          <p className="notice notice--warning" style={{ margin: 0 }}>
            <XCircleIcon size={16} weight="bold" aria-hidden />
            <span>
              Cancelled {invoice.cancelledAt ? formatDateTime(invoice.cancelledAt) : ''} by {invoice.cancelledBy}: {invoice.cancelReason}. Its number stays used and its goods went back to stock. Duplicate it to bill again.
            </span>
          </p>
        )}
        {invoice.status === 'draft' && invoice.number && (
          <p className="notice notice--warning" style={{ margin: 0 }}>
            <ArrowCounterClockwiseIcon size={16} weight="bold" aria-hidden />
            <span>
              Reopened {invoice.reopenedAt ? formatDateTime(invoice.reopenedAt) : ''} by {invoice.reopenedBy}: {invoice.reopenReason}. It keeps {invoice.number}; finalizing it again moves only the stock that changed.
            </span>
          </p>
        )}
        {(pending > 0 || rejected > 0) && (
          <p className="notice notice--warning" style={{ margin: 0 }}>
            <HourglassIcon size={16} weight="bold" aria-hidden />
            <span>
              {pending > 0 && `${pending === 1 ? 'A discount is' : `${pending} discounts are`} waiting for approval. `}
              {rejected > 0 && `${rejected === 1 ? 'A discount was' : `${rejected} discounts were`} refused: edit the bill to bring it within the limit. `}
              It can be finalized once every discount is approved. <Link to="/billing/approvals">Discount approvals</Link>
            </span>
          </p>
        )}
        <div className="row" style={{ justifyContent: 'space-between', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
          <Segmented<BillingSettings['template'] | 'thermal'>
            label="Layout"
            value={view ?? (settings.paperSize === 'thermal' ? 'thermal' : settings.template)}
            onChange={setView}
            options={(['classic', 'modern', 'compact', 'thermal'] as const).map((value) => ({ value, label: TEMPLATE_LABEL[value] }))}
          />
          <span className="cell-sub">
            Prints on {paper === 'thermal' ? '80 mm thermal roll' : paper}. {owner && <Link to="/billing/settings">Invoice Settings</Link>}
          </span>
        </div>
      </div>

      <BillDocument invoice={invoice} settings={settings} company={db.settings} template={template} paper={paper} />

      <div className="grid-2 no-print" style={{ marginTop: 'var(--space-5)' }}>
        <Card aria-labelledby="payments-title">
          <CardHeader
            id="payments-title"
            title="Payments"
            description={invoice.status === 'cancelled' ? undefined : `Received ${formatMoney(state.paid)} of ${formatMoney(invoice.total)}; ${state.balance > 0 ? `${formatMoney(state.balance)} to come${invoice.dueDate ? `, due ${invoiceDay(invoice.dueDate)}` : ''}` : 'nothing owed'}.`}
          />
          {detail.payments.length ? (
            <ul className="list">
              {detail.payments.map((payment) => (
                <li key={payment.id} className="list-row">
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <span className={`list-row__title${payment.voidedAt ? ' is-struck' : ''}`}>
                      {formatMoney(payment.amount)} · {BILL_METHODS[payment.method]}
                    </span>
                    <div className="cell-sub">
                      {invoiceDay(payment.paidOn)}
                      {payment.reference && ` · ${payment.reference}`}
                      {payment.note && ` · ${payment.note}`} · {payment.by}
                    </div>
                    {payment.voidedAt && (
                      <div className="cell-sub money-late">
                        Voided {formatDateTime(payment.voidedAt)} by {payment.voidedBy}: {payment.voidReason}
                      </div>
                    )}
                  </div>
                  {!payment.voidedAt && canVoid && invoice.status !== 'cancelled' && (
                    <Button size="sm" variant="danger-plain" onClick={() => setDialog({ void: payment.id })}>
                      Void
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <div className="card__body">
              <p className="muted" style={{ margin: 0 }}>
                Nothing received yet.
              </p>
            </div>
          )}
        </Card>

        <Card aria-labelledby="history-title">
          <CardHeader id="history-title" title="History" description="Every change, with who made it." />
          <ul className="list">
            {[...detail.events].reverse().map((event) => (
              <li key={event.id} className="list-row">
                <div style={{ minWidth: 0 }}>
                  <span className="list-row__title">{EVENT_LABEL[event.kind]}</span>
                  <div className="cell-sub">
                    {formatDateTime(event.at)} · {event.by}
                    {event.note && ` · ${event.note}`}
                  </div>
                  {event.before && event.after && (
                    <div className="cell-sub">
                      {formatMoney(event.before.total)} → {formatMoney(event.after.total)}
                      {event.before.customer !== event.after.customer && ` · ${event.before.customer} → ${event.after.customer}`}
                      {event.before.lines.length !== event.after.lines.length && ` · ${event.before.lines.length} → ${event.after.lines.length} lines`}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card aria-labelledby="discount-title" className="table-card no-print" style={{ marginTop: 'var(--space-5)' }}>
        <CardHeader id="discount-title" title="Lines and discounts" description="Each line’s discount against the rule it was billed under, before GST." />
        <div className="table-scroll">
          <table className="table">
            <caption className="visually-hidden">Lines and discounts</caption>
            <thead>
              <tr>
                <th scope="col">Item</th>
                <th scope="col">Category</th>
                <th scope="col" className="is-num">
                  Price
                </th>
                <th scope="col">Discount</th>
                <th scope="col" className="is-num">
                  Off
                </th>
                <th scope="col" className="is-num">
                  Taxable
                </th>
                <th scope="col" className="is-num">
                  GST
                </th>
                <th scope="col" className="is-num">
                  Final
                </th>
                <th scope="col">Rule</th>
              </tr>
            </thead>
            <tbody>
              {invoice.items.map((item, index) => {
                const measured = discountsOf(invoice).lines[index];
                const gst = r2(item.cgst + item.sgst + item.igst);
                return (
                  <tr key={index}>
                    <td>
                      <span className="cell-title">{item.description}</span>
                      <div className="cell-sub">
                        {item.lineType === 'charge' ? 'Charge' : `${item.qty} ${printUnit(item.unit)}`}
                        {item.sku && ` · ${item.sku}`}
                      </div>
                    </td>
                    <td>{item.categoryLabel ?? <span className="muted">—</span>}</td>
                    <td className="is-num">{formatMoney(item.rate)}</td>
                    <td>
                      {item.lineType === 'charge' ? (
                        <span className="muted">—</span>
                      ) : (
                        <>
                          {[item.discountPct ? `${item.discountPct}%` : '', item.discountAmount ? formatMoney(item.discountAmount) : ''].filter(Boolean).join(' + ') || <span className="muted">None</span>}
                          {(item.billDiscount ?? 0) > 0 && <div className="cell-sub">+ bill {formatMoney(item.billDiscount ?? 0)}</div>}
                        </>
                      )}
                    </td>
                    <td className="is-num">
                      {measured && measured.value > 0 ? (
                        <>
                          {formatMoney(measured.value)}
                          <div className="cell-sub">{measured.effectivePct}%</div>
                        </>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td className="is-num">{formatMoney(item.taxable)}</td>
                    <td className="is-num">
                      {formatMoney(gst)}
                      <div className="cell-sub">{item.gstRate}%</div>
                    </td>
                    <td className="is-num">
                      <strong>{formatMoney(r2(item.taxable + gst))}</strong>
                    </td>
                    <td>
                      {item.ruleType ? (
                        <>
                          {DISCOUNT_TYPE[item.ruleType]} {item.ruleType === 'amount' ? `₹${item.ruleMin ?? 0}–${item.ruleMax ?? 'any'}` : `${item.ruleMin ?? 0}–${item.ruleMax ?? 0}%`}
                          <div className="cell-sub">{item.discountSource === 'product' ? 'Product rule' : item.discountSource === 'category' ? 'Category rule' : 'Default rule'}</div>
                        </>
                      ) : (
                        <span className="muted">—</span>
                      )}
                      {item.discountStatus && item.discountStatus !== 'ok' && (
                        <div>
                          <Badge tone={item.discountStatus === 'approved' ? 'success' : item.discountStatus === 'pending' ? 'warning' : 'danger'}>
                            {item.discountStatus === 'approved' ? 'Approved' : item.discountStatus === 'pending' ? 'Awaiting approval' : 'Refused'}
                          </Badge>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {detail.moves.length > 0 && (
        <Card aria-labelledby="moves-title" className="no-print" style={{ marginTop: 'var(--space-5)' }}>
          <CardHeader id="moves-title" title="Stock" description="What this bill took from stock, and gave back when it was corrected or cancelled." />
          <ul className="list">
            {[...detail.moves].reverse().map((move) => (
              <li key={move.id} className="list-row">
                <div style={{ minWidth: 0, flex: 1 }}>
                  <span className="list-row__title">{productName(move.productId, move.option)}</span>
                  <div className="cell-sub">
                    {MOVE_LABEL[move.kind]} · {formatDateTime(move.at)} · {move.by}
                  </div>
                </div>
                <span className={`num ${move.change < 0 ? 'money-late' : ''}`}>
                  {move.change > 0 ? '+' : ''}
                  {move.change}
                  <span className="cell-sub"> → {move.balance}</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <ConfirmDialog
        open={dialog === 'finalize'}
        title={invoice.number ? `Post ${invoice.number} again?` : 'Finalize this bill?'}
        body={`${invoice.number ? `It keeps ${invoice.number}` : `It gets the next number in the ${settings.invoicePrefix || 'invoice'} series`}, and its goods go out of stock. Total ${formatMoney(invoice.total)}. After this, only an Owner can reopen it.`}
        confirmLabel="Finalize"
        onCancel={() => setDialog(null)}
        onConfirm={finalize}
      />
      <ConfirmDialog open={dialog === 'delete'} title="Delete this draft?" body="It has no number yet, so nothing else changes." confirmLabel="Delete Draft" destructive onCancel={() => setDialog(null)} onConfirm={remove} />
      <ReasonDrawer
        open={dialog === 'reopen'}
        title={`Reopen ${invoice.number}?`}
        description="It becomes a draft again and keeps its number. Finalizing it again moves only the stock that changed. After the month’s GSTR-1 is filed, issue a credit note instead."
        label="Why is it being corrected?"
        action="Reopen Bill"
        busy={busy === 'reopen'}
        onClose={() => setDialog(null)}
        onSubmit={(reason) => act('reopen', () => api(`/billing/invoices/${invoice.id}/reopen`, 'POST', { version: invoice.version, reason }), `${invoice.number} reopened.`)}
      />
      <ReasonDrawer
        open={dialog === 'cancel'}
        title={`Cancel ${invoice.number}?`}
        description={
          activePayments.length
            ? `${activePayments.length === 1 ? 'A payment stands' : `${activePayments.length} payments stand`} against it: void ${activePayments.length === 1 ? 'it' : 'them'} first (refunding the customer), then cancel.`
            : 'It stays in the register as cancelled and keeps its number; its goods go back to stock.'
        }
        label="Reason for cancelling"
        action="Cancel Bill"
        destructive
        busy={busy === 'cancel'}
        onClose={() => setDialog(null)}
        onSubmit={(reason) => act('cancel', () => api(`/billing/invoices/${invoice.id}/cancel`, 'POST', { version: invoice.version, reason }), `${invoice.number} cancelled. Its number stays used.`)}
      />
      <ReasonDrawer
        open={typeof dialog === 'object' && dialog !== null}
        title="Void this payment?"
        description="It stays on record, struck through, and no longer counts towards the bill. Use it for a payment entered by mistake or refunded."
        label="Why is it voided?"
        action="Void Payment"
        destructive
        busy={busy === 'void'}
        onClose={() => setDialog(null)}
        onSubmit={(reason) => typeof dialog === 'object' && dialog && act('void', () => api(`/billing/payments/${dialog.void}/void`, 'POST', { reason }), 'Payment voided.')}
      />
      <PaymentDrawer open={dialog === 'pay'} invoice={invoice} balance={state.balance} onClose={() => setDialog(null)} onSaved={() => (setDialog(null), load())} />
    </>
  );
}

function ReasonDrawer({
  open,
  title,
  description,
  label,
  action,
  destructive,
  busy,
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  description: string;
  label: string;
  action: string;
  destructive?: boolean;
  busy: boolean;
  onClose: () => void;
  onSubmit: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setReason('');
      setTouched(false);
    }
  }
  return (
    <Drawer
      open={open}
      title={title}
      description={description}
      dirty={Boolean(reason.trim())}
      onClose={onClose}
      onSubmit={() => {
        setTouched(true);
        if (reason.trim()) onSubmit(reason.trim());
      }}
      footer={
        <>
          <Button onClick={onClose}>Keep It</Button>
          <Button type="submit" variant={destructive ? 'danger' : 'primary'} loading={busy}>
            {action}
          </Button>
        </>
      }
    >
      <TextField label={label} required value={reason} onChange={(event) => setReason(event.target.value)} maxLength={300} error={touched && !reason.trim() ? 'Give the reason: it’s kept with the bill.' : null} />
    </Drawer>
  );
}

/** Money received against the bill: in full, in part, or as an advance on a draft. */
function PaymentDrawer({ open, invoice, balance, onClose, onSaved }: { open: boolean; invoice: SalesInvoice; balance: number; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({ amount: '', method: 'cash' as BillPaymentMethod, paidOn: localDay(), reference: '', note: '' });
  const [failure, setFailure] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setForm({ amount: String(balance), method: 'cash', paidOn: localDay(), reference: '', note: '' });
      setFailure(null);
    }
  }
  const amount = parseMoney(form.amount);
  const save = async () => {
    if (!(amount > 0)) return setFailure(new ApiError('Enter an amount above ₹0.', 'amount'));
    if (amount > balance + 0.001) return setFailure(new ApiError(`That’s more than the bill still owes (${formatMoney(balance)}).`, 'amount'));
    setBusy(true);
    setFailure(null);
    try {
      await api(`/billing/invoices/${invoice.id}/payments`, 'POST', { amount, method: form.method, paidOn: form.paidOn, reference: form.reference.trim(), note: form.note.trim() });
      await api('/activity', 'POST', { area: 'orders', summary: `Received ${formatMoney(amount)} (${BILL_METHODS[form.method]}) against ${invoice.number ?? `${invoice.customerName}’s draft bill`}`, to: `/billing/${invoice.id}` }).catch(() => null);
      toast({ message: `${formatMoney(amount)} recorded.` });
      onSaved();
    } catch (problem) {
      setFailure(problem instanceof ApiError ? problem : new ApiError('Couldn’t record it.'));
    } finally {
      setBusy(false);
    }
  };
  const fieldError = (key: string) => (failure?.field === key ? failure.message : null);
  return (
    <Drawer
      open={open}
      title={invoice.status === 'draft' ? 'Take an advance' : 'Record a payment'}
      description={`${formatMoney(balance)} still owed on ${invoice.number ?? 'this draft'}. Part payments are fine; take more payments later.`}
      dirty={form.amount !== String(balance) || Boolean(form.reference || form.note)}
      onClose={onClose}
      onSubmit={() => void save()}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={busy}>
            Record Payment
          </Button>
        </>
      }
    >
      <div className="stack">
        <TextField label="Amount" prefix="₹" inputMode="decimal" required value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} error={fieldError('amount')} />
        <SelectField
          label="Paid by"
          value={form.method}
          onChange={(event) => setForm({ ...form, method: event.target.value as BillPaymentMethod })}
          options={(Object.keys(BILL_METHODS) as BillPaymentMethod[]).map((value) => ({ value, label: BILL_METHODS[value] }))}
        />
        <TextField label="Date" type="date" max={localDay()} value={form.paidOn} onChange={(event) => setForm({ ...form, paidOn: event.target.value })} error={fieldError('paidOn')} />
        <TextField
          label={form.method === 'cheque' ? 'Cheque number' : form.method === 'upi' || form.method === 'bank' ? 'Transaction reference' : 'Reference'}
          value={form.reference}
          onChange={(event) => setForm({ ...form, reference: event.target.value })}
          maxLength={100}
          hint="Optional."
        />
        <TextField label="Note" value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} maxLength={300} hint="Optional." />
        {failure && !failure.field && (
          <p className="notice notice--warning" role="alert" style={{ margin: 0 }}>
            <WarningCircleIcon size={16} weight="bold" aria-hidden />
            <span>{failure.message}</span>
          </p>
        )}
        {r2(balance - (amount || 0)) > 0 && amount > 0 && <p className="field__hint">{formatMoney(r2(balance - amount))} will still be owed.</p>}
      </div>
    </Drawer>
  );
}
