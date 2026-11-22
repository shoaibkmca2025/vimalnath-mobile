import { CheckCircleIcon, PencilSimpleIcon, StorefrontIcon, TrashIcon, TruckIcon } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';

import { Button } from '@/components/Button';
import { Card, CardHeader } from '@/components/Card';
import { ConfirmDialog } from '@/components/Dialog';
import { Drawer } from '@/components/Drawer';
import { EmptyState } from '@/components/EmptyState';
import { SelectField, Segmented, TextAreaField, TextField } from '@/components/Field';
import { PageHeader } from '@/components/PageHeader';
import { AttachButton, AttachmentList, Steps, SupplierReturnStatusBadge } from '@/components/ReturnParts';
import { useToast } from '@/components/useToast';
import { dayLabel, localDay } from '@/data/payments';
import { formatMoney, parseMoney, r2 } from '@/data/purchases';
import { SUPPLIER_REASONS, SUPPLIER_RETURN_STATUS, SUPPLIER_RETURN_STEPS } from '@/data/returns';
import { BUCKET_LABEL, UNITS } from '@/data/stock';
import type { SupplierReturn, SupplierReturnReason, SupplierReturnSource, SupplierReturnStatus } from '@/data/types';
import { useData } from '@/data/useData';
import { usePurchasing } from '@/hooks/usePurchasing';
import { ApiError, api } from '@/lib/api';
import { formatDateTime, formatNumber } from '@/lib/format';

type Bucket = 'available' | 'damaged' | 'defective';
type Draft = { returnDate: string; reason: SupplierReturnReason | ''; reasonNote: string; picks: Record<number, { qty: string; bucket: Bucket }>; challan: string; transport: string; attachments: string[]; notes: string };

/** A new supplier return (/supplier-returns/new), or one already made: its draft, or its steps. */
export default function SupplierReturnPage() {
  const { id } = useParams();
  const [found, setFound] = useState<SupplierReturn | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!id) return;
    let active = true;
    api<SupplierReturn[]>('/supplier-returns').then(
      (all) => {
        if (!active) return;
        const one = all.find((row) => row.id === id) ?? null;
        setFound(one);
        if (!one) setError('This supplier return doesn’t exist.');
      },
      (problem: unknown) => active && setError(problem instanceof Error ? problem.message : 'Couldn’t load it.'),
    );
    return () => {
      active = false;
    };
  }, [id]);
  if (!id) return <Editor />;
  if (!found || found.id !== id)
    return (
      <>
        <PageHeader title="Supplier Return" crumbs={[{ label: 'Supplier Returns', to: '/supplier-returns' }]} />
        <Card>
          <EmptyState icon={StorefrontIcon} title={error ? 'Couldn’t load it' : 'Loading…'}>
            {error}
          </EmptyState>
        </Card>
      </>
    );
  if (editing) return <Editor existing={found} onDone={(saved) => (setFound(saved), setEditing(false))} />;
  return <Detail ret={found} onChange={setFound} onEdit={() => setEditing(true)} />;
}

function Editor({ existing, onDone }: { existing?: SupplierReturn; onDone?: (saved: SupplierReturn) => void }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const { suppliers, purchases } = usePurchasing();
  const purchaseId = existing?.purchaseId ?? params.get('purchaseId') ?? '';
  const [source, setSource] = useState<{ id: string; data: SupplierReturnSource } | null>(null);
  const [draft, setDraft] = useState<Draft>(() => ({
    returnDate: existing?.returnDate ?? localDay(),
    reason: existing?.reason ?? '',
    reasonNote: existing?.reasonNote ?? '',
    picks: Object.fromEntries((existing?.items ?? []).map((item) => [item.purchasePosition, { qty: String(item.qty), bucket: item.bucket }])),
    challan: existing?.challan ?? '',
    transport: existing?.transport ?? '',
    attachments: existing?.attachments ?? [],
    notes: existing?.notes ?? '',
  }));
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<ApiError | null>(null);

  useEffect(() => {
    if (!purchaseId) return;
    let active = true;
    api<SupplierReturnSource>(`/supplier-returns/bills/${purchaseId}${existing ? `?returnId=${existing.id}` : ''}`).then(
      (data) => active && setSource({ id: purchaseId, data }),
      () => {},
    );
    return () => {
      active = false;
    };
  }, [purchaseId, existing]);
  const data = source?.id === purchaseId ? source.data : null;
  const bills = (purchases ?? []).filter((bill) => bill.status === 'received');
  const supplierOf = (supplierId: number) => suppliers?.find((one) => one.id === supplierId)?.name ?? '';
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const qtyOf = (text: string) => (/^\d+(\.\d{1,3})?$/.test(text.trim()) ? Number(text.trim()) : text.trim() ? NaN : 0);
  const lines = (data?.lines ?? []).map((line) => {
    const pick = draft.picks[line.position];
    const qty = pick ? qtyOf(pick.qty) : 0;
    const taxable = qty > 0 ? r2(line.rate * qty) : 0;
    return { line, pick, qty, taxable, tax: r2((taxable * line.gstRate) / 100) };
  });
  const chosen = lines.filter((row) => row.qty > 0);
  const total = r2(chosen.reduce((sum, row) => sum + row.taxable + row.tax, 0));
  const errors = {
    items: chosen.length ? null : 'Choose what goes back and how many.',
    qty: lines.find((row) => Number.isNaN(row.qty) || row.qty > row.line.returnable) ? 'A quantity is more than can go back.' : null,
    reason: draft.reason ? null : 'Choose the reason.',
    reasonNote: draft.reason === 'other' && !draft.reasonNote.trim() ? 'Say what the reason is.' : null,
  };
  const firstError = Object.values(errors).find(Boolean);

  const save = async () => {
    setTouched(true);
    setFailure(null);
    if (firstError) {
      toast({ tone: 'error', message: firstError });
      return;
    }
    setSaving(true);
    try {
      const body = {
        purchaseId: Number(purchaseId),
        returnDate: draft.returnDate,
        reason: draft.reason,
        reasonNote: draft.reasonNote.trim(),
        items: chosen.map((row) => ({ purchasePosition: row.line.position, qty: row.qty, bucket: row.pick!.bucket })),
        challan: draft.challan.trim(),
        transport: draft.transport.trim(),
        attachments: draft.attachments,
        notes: draft.notes.trim(),
        ...(existing ? { version: existing.version } : {}),
      };
      const answer = await api<{ supplierReturns: SupplierReturn[] }>(existing ? `/supplier-returns/${existing.id}` : '/supplier-returns', existing ? 'PUT' : 'POST', body);
      const saved = answer.supplierReturns[0]!;
      await api('/activity', 'POST', { area: 'returns', summary: `${existing ? 'Changed' : 'Drafted'} supplier return ${saved.number} to ${saved.supplier.name} (${formatMoney(saved.total)})`, to: `/supplier-returns/${saved.id}` }).catch(() => null);
      toast({ message: `${saved.number} saved as a draft.` });
      if (onDone) onDone(saved);
      else navigate(`/supplier-returns/${saved.id}`, { replace: true });
    } catch (problem) {
      const apiError = problem instanceof ApiError ? problem : new ApiError('Something went wrong.');
      setFailure(apiError);
      toast({ tone: 'error', message: apiError.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader
        title={existing ? `Edit ${existing.number}` : 'New Supplier Return'}
        crumbs={[{ label: 'Supplier Returns', to: '/supplier-returns' }]}
        description="Against a received bill, at its rates. Nothing leaves stock until it’s dispatched."
      />
      <div className="editor">
        <div className="stack">
          <Card aria-labelledby="bill-title">
            <CardHeader id="bill-title" title="Bill" />
            <div className="card__body">
              <SelectField
                label="Purchase bill"
                value={purchaseId}
                disabled={Boolean(existing)}
                onChange={(event) => {
                  setParams(event.target.value ? { purchaseId: event.target.value } : {}, { replace: true });
                  set('picks', {});
                }}
                options={[
                  { value: '', label: purchases ? 'Choose a received bill…' : 'Loading bills…' },
                  ...bills.map((bill) => ({ value: bill.id, label: `${bill.number} · ${supplierOf(bill.supplier.id) || bill.supplier.name}${bill.supplierInvoice ? ` · their bill ${bill.supplierInvoice}` : ''} · ${dayLabel(bill.billDate)}` })),
                ]}
              />
            </div>
            {data && (
              <div className="table-scroll">
                <table className="table bill-lines">
                  <caption className="visually-hidden">Bill lines</caption>
                  <thead>
                    <tr>
                      <th scope="col">Item</th>
                      <th scope="col" className="is-num">
                        Bought
                      </th>
                      <th scope="col" className="is-num">
                        Rate
                      </th>
                      <th scope="col">Going back</th>
                      <th scope="col">From</th>
                      <th scope="col" className="is-num">
                        Value
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map(({ line, pick, taxable, tax }) => (
                      <tr key={line.position}>
                        <td>
                          <div className="cell-title" style={{ whiteSpace: 'normal' }}>
                            {line.name}
                          </div>
                          <div className="cell-sub mono">{line.code}</div>
                        </td>
                        <td className="is-num">
                          {formatNumber(line.qty)} {UNITS[line.unit]}
                          {line.returned > 0 && <div className="cell-sub">{formatNumber(line.returned)} back already</div>}
                        </td>
                        <td className="is-num">
                          {formatMoney(line.rate)}
                          <div className="cell-sub">+ {line.gstRate}% GST</div>
                        </td>
                        <td>
                          {line.returnable > 0 ? (
                            <input
                              className="input"
                              aria-label={`How many ${line.name} go back, up to ${line.returnable}`}
                              inputMode="decimal"
                              placeholder="0"
                              value={pick?.qty ?? ''}
                              onChange={(event) => set('picks', { ...draft.picks, [line.position]: { bucket: pick?.bucket ?? 'available', qty: event.target.value } })}
                              style={{ width: 80 }}
                            />
                          ) : (
                            <span className="muted">All gone back</span>
                          )}
                        </td>
                        <td>
                          {line.returnable > 0 && (
                            <select
                              className="select"
                              aria-label={`Which stock ${line.name} leaves from`}
                              value={pick?.bucket ?? 'available'}
                              onChange={(event) => set('picks', { ...draft.picks, [line.position]: { qty: pick?.qty ?? '', bucket: event.target.value as Bucket } })}
                            >
                              {(['available', 'damaged', 'defective'] as Bucket[]).map((bucket) => (
                                <option key={bucket} value={bucket}>
                                  {BUCKET_LABEL[bucket]}
                                </option>
                              ))}
                            </select>
                          )}
                        </td>
                        <td className="is-num">{taxable ? formatMoney(r2(taxable + tax)) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {touched && (errors.items || errors.qty) && (
              <p className="card__body field__error" role="alert">
                {errors.qty ?? errors.items}
              </p>
            )}
          </Card>
          <Card aria-labelledby="why-title">
            <CardHeader id="why-title" title="Details" />
            <div className="card__body form-grid">
              <SelectField
                label="Reason"
                required
                value={draft.reason}
                onChange={(event) => set('reason', event.target.value as SupplierReturnReason)}
                error={touched ? errors.reason : null}
                options={[{ value: '', label: 'Choose the reason…' }, ...(Object.keys(SUPPLIER_REASONS) as SupplierReturnReason[]).map((reason) => ({ value: reason, label: SUPPLIER_REASONS[reason] }))]}
              />
              <TextField label="Return date" type="date" max={localDay()} value={draft.returnDate} onChange={(event) => set('returnDate', event.target.value)} />
              <TextAreaField className="span-2" label="Details" required={draft.reason === 'other'} value={draft.reasonNote} onChange={(event) => set('reasonNote', event.target.value)} error={touched ? errors.reasonNote : null} rows={2} maxLength={500} />
              <TextField label="Challan / reference" value={draft.challan} onChange={(event) => set('challan', event.target.value)} maxLength={60} placeholder="e.g. DC-17" />
              <TextField label="Sent by" value={draft.transport} onChange={(event) => set('transport', event.target.value)} maxLength={100} placeholder="e.g. VRL Logistics, LR 4471" />
              <div className="span-2 stack" style={{ gap: 'var(--space-2)' }}>
                <span className="field__label">Photos and documents</span>
                <AttachmentList files={draft.attachments} onRemove={(url) => set('attachments', draft.attachments.filter((one) => one !== url))} />
                <div>
                  <AttachButton onAdd={(urls) => set('attachments', [...draft.attachments, ...urls].slice(0, 20))} />
                </div>
              </div>
              <TextAreaField className="span-2" label="Internal notes" value={draft.notes} onChange={(event) => set('notes', event.target.value)} rows={2} maxLength={2000} />
            </div>
          </Card>
        </div>
        <div className="stack editor__aside">
          <Card aria-labelledby="total-title">
            <CardHeader id="total-title" title="Value" />
            <div className="card__body stack">
              <dl className="kv kv--compact kv--split" style={{ margin: 0 }}>
                <dt>Taxable</dt>
                <dd className="num">{formatMoney(r2(chosen.reduce((sum, row) => sum + row.taxable, 0)))}</dd>
                <dt>GST</dt>
                <dd className="num">{formatMoney(r2(chosen.reduce((sum, row) => sum + row.tax, 0)))}</dd>
                <dt style={{ fontWeight: 600, color: 'var(--text)' }}>Total</dt>
                <dd className="num" style={{ fontWeight: 700 }}>
                  {formatMoney(total)}
                </dd>
              </dl>
              {failure && !failure.field && (
                <p className="notice notice--warning" role="alert" style={{ margin: 0 }}>
                  {failure.message}
                </p>
              )}
              <Button variant="primary" block loading={saving} disabled={!purchaseId} onClick={save}>
                Save Draft
              </Button>
              {onDone && existing && (
                <Button block onClick={() => onDone(existing)}>
                  Discard Changes
                </Button>
              )}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

function Detail({ ret, onChange, onEdit }: { ret: SupplierReturn; onChange: (ret: SupplierReturn) => void; onEdit: () => void }) {
  const toast = useToast();
  const navigate = useNavigate();
  const { send } = useData();
  const [open, setOpen] = useState<'approved' | 'dispatched' | 'supplier_received' | 'closed' | 'cancelled' | 'credit' | 'settle' | 'delete' | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ note: '', challan: ret.challan ?? '', transport: ret.transport ?? '', number: '', date: localDay(), amount: String(ret.total), tax: String(ret.tax), settlement: 'adjust' as 'adjust' | 'refund', method: 'bank', reference: '' });
  const act = async (path: string, body: Record<string, unknown>, summary: string, message: string) => {
    setBusy(true);
    const answer = await send(`/supplier-returns/${ret.id}${path}`, path ? 'POST' : 'DELETE', path ? { version: ret.version, ...body } : undefined, { area: 'returns', summary: `${summary} (${ret.number}, ${ret.supplier.name})`, to: `/supplier-returns/${ret.id}` });
    setBusy(false);
    if (!answer) return;
    toast({ message });
    setOpen(null);
    if (answer.supplierReturns?.[0]) onChange(answer.supplierReturns[0]);
    if (answer.removedSupplierReturns) navigate('/supplier-returns', { replace: true });
  };
  const next: Partial<Record<SupplierReturnStatus, { to: NonNullable<typeof open>; label: string }[]>> = {
    draft: [{ to: 'approved', label: 'Approve' }],
    approved: [{ to: 'dispatched', label: 'Mark Dispatched' }],
    dispatched: [
      { to: 'supplier_received', label: 'Supplier Received It' },
      { to: 'credit', label: 'Record Credit Note' },
    ],
    supplier_received: [{ to: 'credit', label: 'Record Credit Note' }],
    credited: [{ to: 'settle', label: 'Settle' }],
    settled: [{ to: 'closed', label: 'Close' }],
  };
  const steps = next[ret.status] ?? [];
  const cancellable = ['draft', 'approved', 'dispatched', 'supplier_received'].includes(ret.status);
  const field = (key: keyof typeof form) => ({ value: form[key], onChange: (event: { target: { value: string } }) => setForm({ ...form, [key]: event.target.value }) });

  return (
    <>
      <PageHeader
        title={`Supplier Return ${ret.number}`}
        crumbs={[{ label: 'Supplier Returns', to: '/supplier-returns' }]}
        description={
          <>
            <SupplierReturnStatusBadge status={ret.status} /> · {ret.supplier.name} · bill <Link to={`/purchases/${ret.purchaseId}`}>{ret.purchaseNumber}</Link> · {dayLabel(ret.returnDate)}
          </>
        }
        actions={
          <>
            {steps.map((step, index) => (
              <Button key={step.to} variant={index === 0 ? 'primary' : 'secondary'} icon={step.to === 'dispatched' ? TruckIcon : CheckCircleIcon} onClick={() => setOpen(step.to)}>
                {step.label}
              </Button>
            ))}
            {ret.status === 'draft' && (
              <Button icon={PencilSimpleIcon} onClick={onEdit}>
                Edit
              </Button>
            )}
          </>
        }
      />
      <Card style={{ marginBottom: 'var(--space-5)' }}>
        <div className="card__body stack">
          <Steps steps={SUPPLIER_RETURN_STEPS} labels={SUPPLIER_RETURN_STATUS} current={ret.status === 'cancelled' ? 'draft' : ret.status} stopped={ret.status === 'cancelled' ? SUPPLIER_RETURN_STATUS.cancelled : undefined} />
          {(cancellable || ret.status === 'draft') && (
            <div className="row" style={{ gap: 'var(--space-2)' }}>
              {cancellable && (
                <Button size="sm" variant="danger-plain" onClick={() => setOpen('cancelled')}>
                  Cancel Return
                </Button>
              )}
              {ret.status === 'draft' && (
                <Button size="sm" variant="danger-plain" icon={TrashIcon} onClick={() => setOpen('delete')}>
                  Delete Draft
                </Button>
              )}
            </div>
          )}
        </div>
      </Card>
      <div className="editor">
        <div className="stack">
          <Card aria-labelledby="items-title" className="table-card">
            <CardHeader id="items-title" title="Goods going back" description={SUPPLIER_REASONS[ret.reason] + (ret.reasonNote ? `: ${ret.reasonNote}` : '')} />
            <div className="table-scroll">
              <table className="table">
                <caption className="visually-hidden">Goods going back</caption>
                <thead>
                  <tr>
                    <th scope="col">Item</th>
                    <th scope="col" className="is-num">
                      Qty
                    </th>
                    <th scope="col">From</th>
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
                          {item.name}
                        </div>
                        <div className="cell-sub mono">{item.code}</div>
                      </td>
                      <td className="is-num">
                        {formatNumber(item.qty)} {UNITS[item.unit]}
                      </td>
                      <td>{BUCKET_LABEL[item.bucket]}</td>
                      <td className="is-num">
                        <strong>{formatMoney(r2(item.taxable + item.tax))}</strong>
                        <div className="cell-sub">
                          {formatMoney(item.taxable)} + {item.gstRate}% GST
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <Card aria-labelledby="sr-history-title">
            <CardHeader id="sr-history-title" title="History" />
            <ol className="timeline" aria-label="History">
              {[...(ret.events ?? [])].reverse().map((event) => (
                <li key={event.id} className="timeline__item">
                  <span className="timeline__dot" data-tone={event.to ? SUPPLIER_RETURN_STATUS[event.to].tone : 'neutral'} aria-hidden />
                  <span>
                    <strong>{event.to && event.from !== event.to ? SUPPLIER_RETURN_STATUS[event.to].label : event.kind === 'created' ? 'Drafted' : event.kind === 'edited' ? 'Changed' : 'Note'}</strong>
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
          <Card aria-labelledby="sr-money-title">
            <CardHeader id="sr-money-title" title="Value and credit" />
            <div className="card__body">
              <dl className="kv kv--compact kv--split" style={{ margin: 0 }}>
                <dt>Taxable</dt>
                <dd className="num">{formatMoney(ret.taxable)}</dd>
                <dt>{ret.interstate ? 'IGST' : 'CGST + SGST'}</dt>
                <dd className="num">{formatMoney(ret.tax)}</dd>
                <dt style={{ fontWeight: 600, color: 'var(--text)' }}>Total</dt>
                <dd className="num" style={{ fontWeight: 700 }}>
                  {formatMoney(ret.total)}
                </dd>
                {ret.creditNoteNumber && (
                  <>
                    <dt>Credit note {ret.creditNoteNumber}</dt>
                    <dd className="num">{formatMoney(ret.creditNoteAmount ?? 0)}</dd>
                  </>
                )}
                {ret.settlement && (
                  <>
                    <dt>Settled</dt>
                    <dd>{ret.settlement === 'adjust' ? 'Against what you owe them' : `Refund ${formatMoney(ret.refundAmount ?? 0)}`}</dd>
                  </>
                )}
                {ret.challan && (
                  <>
                    <dt>Challan</dt>
                    <dd>{ret.challan}</dd>
                  </>
                )}
                {ret.transport && (
                  <>
                    <dt>Sent by</dt>
                    <dd>{ret.transport}</dd>
                  </>
                )}
              </dl>
            </div>
          </Card>
          {ret.attachments.length > 0 && (
            <Card aria-labelledby="sr-files-title">
              <CardHeader id="sr-files-title" title="Photos & documents" />
              <div className="card__body">
                <AttachmentList files={ret.attachments} />
              </div>
            </Card>
          )}
        </div>
      </div>

      <Drawer
        open={open === 'approved' || open === 'supplier_received' || open === 'closed' || open === 'cancelled'}
        title={open === 'cancelled' ? `Cancel ${ret.number}?` : open === 'closed' ? `Close ${ret.number}?` : open === 'approved' ? `Approve ${ret.number}?` : 'Supplier received the goods?'}
        description={open === 'cancelled' && ['dispatched', 'supplier_received'].includes(ret.status) ? 'The goods go back into the stock they left.' : undefined}
        onClose={() => setOpen(null)}
        onSubmit={() =>
          open &&
          void act('/status', { to: open, note: form.note.trim() }, open === 'cancelled' ? 'Cancelled supplier return' : `Supplier return: ${SUPPLIER_RETURN_STATUS[open as SupplierReturnStatus].label}`, 'Saved.')
        }
        footer={
          <>
            <Button onClick={() => setOpen(null)}>Back</Button>
            <Button type="submit" variant={open === 'cancelled' ? 'danger' : 'primary'} loading={busy}>
              {open === 'cancelled' ? 'Cancel Return' : 'Confirm'}
            </Button>
          </>
        }
      >
        <TextAreaField label={open === 'cancelled' ? 'Why it’s cancelled' : 'Note (optional)'} required={open === 'cancelled'} rows={3} maxLength={500} {...field('note')} />
      </Drawer>
      <Drawer
        open={open === 'dispatched'}
        title="Dispatch the goods?"
        description="They leave stock now, from the stock each was chosen from."
        onClose={() => setOpen(null)}
        onSubmit={() => void act('/status', { to: 'dispatched', challan: form.challan.trim(), transport: form.transport.trim(), note: form.note.trim() }, 'Dispatched supplier return', 'Dispatched: the goods left stock.')}
        footer={
          <>
            <Button onClick={() => setOpen(null)}>Back</Button>
            <Button type="submit" variant="primary" loading={busy} icon={TruckIcon}>
              Mark Dispatched
            </Button>
          </>
        }
      >
        <div className="stack">
          <TextField label="Challan / reference" maxLength={60} {...field('challan')} />
          <TextField label="Sent by" maxLength={100} placeholder="e.g. VRL Logistics, LR 4471" {...field('transport')} />
          <TextField label="Note" maxLength={500} {...field('note')} />
        </div>
      </Drawer>
      <Drawer
        open={open === 'credit'}
        title="The supplier’s credit note"
        description={`It lowers what you owe ${ret.supplier.name}, and your input tax credit by its GST.`}
        onClose={() => setOpen(null)}
        onSubmit={() =>
          void act('/credit-note', { number: form.number.trim(), date: form.date, amount: parseMoney(form.amount), tax: parseMoney(form.tax) }, `Recorded supplier credit note ${form.number.trim()}`, 'Credit note recorded.')
        }
        footer={
          <>
            <Button onClick={() => setOpen(null)}>Back</Button>
            <Button type="submit" variant="primary" loading={busy}>
              Record Credit Note
            </Button>
          </>
        }
      >
        <div className="stack">
          <TextField label="Their credit note number" required maxLength={50} {...field('number')} />
          <TextField label="Date" type="date" max={localDay()} {...field('date')} />
          <TextField label="Amount credited" prefix="₹" inputMode="decimal" hint={`The goods were ${formatMoney(ret.total)} with GST.`} {...field('amount')} />
          <TextField label="GST in it" prefix="₹" inputMode="decimal" {...field('tax')} />
        </div>
      </Drawer>
      <Drawer
        open={open === 'settle'}
        title="How was it settled?"
        onClose={() => setOpen(null)}
        onSubmit={() =>
          void act(
            '/settle',
            form.settlement === 'adjust' ? { settlement: 'adjust', reference: form.reference.trim() } : { settlement: 'refund', amount: parseMoney(form.amount), method: form.method, reference: form.reference.trim(), date: form.date },
            form.settlement === 'adjust' ? 'Settled supplier return against the account' : `Supplier refunded ${form.amount}`,
            'Settled.',
          )
        }
        footer={
          <>
            <Button onClick={() => setOpen(null)}>Back</Button>
            <Button type="submit" variant="primary" loading={busy}>
              Settle
            </Button>
          </>
        }
      >
        <div className="stack">
          <Segmented<'adjust' | 'refund'>
            label="Settled by"
            value={form.settlement}
            onChange={(settlement) => setForm({ ...form, settlement, amount: String(ret.creditNoteAmount ?? ret.total) })}
            options={[
              { value: 'adjust', label: 'Against what we owe them' },
              { value: 'refund', label: 'They refunded money' },
            ]}
          />
          {form.settlement === 'refund' && (
            <>
              <TextField label="Amount refunded" prefix="₹" inputMode="decimal" {...field('amount')} />
              <SelectField
                label="How"
                options={[
                  { value: 'cash', label: 'Cash' },
                  { value: 'upi', label: 'UPI' },
                  { value: 'bank', label: 'Bank transfer' },
                  { value: 'cheque', label: 'Cheque' },
                ]}
                {...field('method')}
              />
              <TextField label="Received on" type="date" max={localDay()} {...field('date')} />
            </>
          )}
          <TextField label="Reference" maxLength={100} {...field('reference')} />
        </div>
      </Drawer>
      <ConfirmDialog open={open === 'delete'} title="Delete this draft?" body="Nothing has moved, so nothing else changes." confirmLabel="Delete Draft" destructive onCancel={() => setOpen(null)} onConfirm={() => void act('', {}, 'Deleted a supplier return draft', 'Draft deleted.')} />
    </>
  );
}
