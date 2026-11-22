import { ArrowUUpLeftIcon, ArrowsLeftRightIcon, MagnifyingGlassIcon, TrashIcon, WarningCircleIcon } from '@phosphor-icons/react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';

import { Button, IconButton } from '@/components/Button';
import { Card, CardHeader } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { SelectField, Segmented, TextAreaField, TextField } from '@/components/Field';
import { ItemPicker } from '@/components/ItemPicker';
import { PageHeader } from '@/components/PageHeader';
import { AttachButton, AttachmentList } from '@/components/ReturnParts';
import { useToast } from '@/components/useToast';
import { dayLabel, localDay } from '@/data/payments';
import { parseMoney } from '@/data/purchases';
import { CONDITIONS, RETURN_REASONS, RETURNS_CHANGED, canDo, priceReplacement, priceReturned } from '@/data/returns';
import { readSession } from '@/data/session';
import { GST_RATES, UNITS, stockRows, type StockRow } from '@/data/stock';
import type { ReturnCondition, ReturnKind, ReturnReason, ReturnSource, ReturnableOrder, SalesReturn, StockUnit } from '@/data/types';
import { useData } from '@/data/useData';
import { useReturns } from '@/hooks/useReturns';
import { ApiError, api } from '@/lib/api';
import { formatINR, formatNumber } from '@/lib/format';

type Line = ReturnSource['lines'][number];
type Pick = { qty: string; condition: ReturnCondition | ''; rate: string };
type Swap = { key: string; productId: string; option: string; title: string; code: string; unit: StockUnit; qty: string; rate: string; discountPct: string; gstRate: string };
type Draft = { kind: ReturnKind; returnDate: string; reason: ReturnReason | ''; reasonNote: string; picks: Record<string, Pick>; swaps: Swap[]; charges: string; chargesNote: string; attachments: string[]; notes: string };

const lineKey = (line: { source: string; position?: number; sourcePosition?: number }) => `${line.source}:${line.position ?? line.sourcePosition}`;
const qtyOf = (text: string) => (/^\d+(\.\d{1,3})?$/.test(text.trim()) ? Number(text.trim()) : text.trim() ? NaN : 0);
const blank = (kind: ReturnKind): Draft => ({ kind, returnDate: localDay(), reason: '', reasonNote: '', picks: {}, swaps: [], charges: '', chargesNote: '', attachments: [], notes: '' });

/** A new return or replacement (/returns/new), or one still waiting for a decision (/returns/:id/edit). */
export default function ReturnEditorPage() {
  const { id } = useParams();
  const { returns, settings, error } = useReturns();
  const existing = id ? returns?.find((ret) => ret.id === id) : undefined;
  if (id && !returns)
    return (
      <>
        <PageHeader title="Edit Return" crumbs={[{ label: 'Customer Returns', to: '/returns/list' }]} />
        <Card>
          <EmptyState icon={ArrowUUpLeftIcon} title={error ? 'Couldn’t load the return' : 'Loading…'}>
            {error}
          </EmptyState>
        </Card>
      </>
    );
  if (id && !existing)
    return (
      <>
        <PageHeader title="Return not found" crumbs={[{ label: 'Customer Returns', to: '/returns/list' }]} />
        <Card>
          <EmptyState icon={ArrowUUpLeftIcon} title="This return doesn’t exist" />
        </Card>
      </>
    );
  return <Editor key={id ?? 'new'} existing={existing} allowReplacements={settings?.allowReplacements ?? true} mayCreate={settings ? canDo(settings, readSession()?.role, 'create') : true} />;
}

function Editor({ existing, allowReplacements, mayCreate }: { existing?: SalesReturn; allowReplacements: boolean; mayCreate: boolean }) {
  const navigate = useNavigate();
  const toast = useToast();
  const { db } = useData();
  const [params, setParams] = useSearchParams();
  const orderId = existing?.orderId ?? params.get('orderId');
  const [draft, setDraft] = useState<Draft>(() => {
    if (!existing) return blank(params.get('kind') === 'replacement' && allowReplacements ? 'replacement' : 'refund');
    return {
      kind: existing.kind,
      returnDate: existing.returnDate,
      reason: existing.reason,
      reasonNote: existing.reasonNote ?? '',
      picks: Object.fromEntries(existing.items.map((item) => [lineKey(item), { qty: String(item.qty), condition: item.condition, rate: String(item.rate) }])),
      swaps: (existing.replacementItems ?? []).map((item, index) => ({
        key: `${item.productId}\u0000${item.option}\u0000${index}`,
        productId: item.productId,
        option: item.option,
        title: item.name,
        code: item.description,
        unit: item.unit,
        qty: String(item.qty),
        rate: String(item.rate),
        discountPct: String(item.discountPct),
        gstRate: String(item.gstRate),
      })),
      charges: existing.charges ? String(existing.charges) : '',
      chargesNote: existing.chargesNote ?? '',
      attachments: existing.attachments,
      notes: existing.notes ?? '',
    };
  });
  const [source, setSource] = useState<{ orderId: string; data: ReturnSource } | null>(null);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<ApiError | null>(null);

  useEffect(() => {
    if (!orderId) return;
    let active = true;
    api<ReturnSource>(`/returns/orders/${orderId}${existing ? `?returnId=${existing.id}` : ''}`).then(
      (data) => active && setSource({ orderId, data }),
      (problem: unknown) => active && setSourceError(problem instanceof Error ? problem.message : 'Couldn’t load the order.'),
    );
    return () => {
      active = false;
    };
  }, [orderId, existing]);

  const data = source && source.orderId === orderId ? source.data : null;
  const invoiced = Boolean(data?.invoice);
  const rows = useMemo(() => stockRows(db.products, db.stock), [db.products, db.stock]);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const setPick = (key: string, patch: Partial<Pick>) =>
    setDraft((current) => ({ ...current, picks: { ...current.picks, [key]: { ...{ qty: '', condition: '', rate: '' }, ...current.picks[key], ...patch } } }));
  const setSwap = (key: string, patch: Partial<Swap>) => setDraft((current) => ({ ...current, swaps: current.swaps.map((swap) => (swap.key === key ? { ...swap, ...patch } : swap)) }));

  // ---------- Figures, as the server will work them out ----------
  const picked = (data?.lines ?? [])
    .map((line) => {
      const pick = draft.picks[lineKey(line)];
      const qty = pick ? qtyOf(pick.qty) : 0;
      const rate = line.source === 'order' && pick?.rate.trim() ? parseMoney(pick.rate) : line.rate;
      return { line, pick, qty, rate, value: Number.isNaN(qty) || qty <= 0 || Number.isNaN(rate) ? null : priceReturned(line, Math.min(qty, line.returnable), rate) };
    })
    .filter((row) => row.pick && row.pick.qty.trim() !== '');
  const returnValue = Math.round(picked.reduce((total, row) => total + (row.value?.amount ?? 0), 0));
  const swapPriced = priceReplacement(
    draft.swaps.map((swap) => ({ qty: qtyOf(swap.qty) || 0, rate: parseMoney(swap.rate) || 0, discountPct: Math.min(100, Math.max(0, parseMoney(swap.discountPct) || 0)), gstRate: Number(swap.gstRate) || 0 })),
    invoiced,
    Boolean(data?.invoice?.interstate),
  );
  const replacementValue = draft.kind === 'replacement' ? swapPriced.total : 0;
  const charges = draft.charges.trim() ? Number(draft.charges.replace(/[,\s₹]/g, '')) : 0;
  const settle = returnValue - (Number.isInteger(charges) ? charges : 0) - replacementValue;
  const late = data?.order.lastDay && draft.returnDate > data.order.lastDay;
  const notEligible = picked.some((row) => !row.line.eligible);

  const errors: Record<string, string | null> = {
    items: picked.some((row) => row.qty > 0) ? null : 'Choose what is coming back and how many.',
    reason: draft.reason ? null : 'Choose the reason.',
    reasonNote: draft.reason === 'other' && !draft.reasonNote.trim() ? 'Say what the reason is.' : null,
    returnDate: !/^\d{4}-\d{2}-\d{2}$/.test(draft.returnDate) ? 'Pick the return date.' : draft.returnDate > localDay() ? 'The date can’t be in the future.' : null,
    charges: !Number.isInteger(charges) || charges < 0 ? 'Enter whole rupees.' : charges > returnValue ? `Up to ${formatINR(returnValue)}, the goods coming back.` : null,
    chargesNote: charges > 0 && !draft.chargesNote.trim() ? 'Say what the charges are for.' : null,
    swaps: draft.kind === 'replacement' && !draft.swaps.length ? 'Add the goods given in exchange.' : null,
    ...Object.fromEntries(
      picked.flatMap(({ line, pick, qty, rate }) => [
        [`qty-${lineKey(line)}`, Number.isNaN(qty) ? 'Use a number, up to 3 decimals.' : qty > line.returnable ? `Up to ${formatNumber(line.returnable)}.` : null],
        [`condition-${lineKey(line)}`, qty > 0 && !pick!.condition ? 'Choose its condition.' : null],
        [`rate-${lineKey(line)}`, Number.isNaN(rate) || rate < 0 ? 'Enter the price per unit.' : null],
      ]),
    ),
    ...Object.fromEntries(
      draft.swaps.flatMap((swap) => [
        [`swapQty-${swap.key}`, !(qtyOf(swap.qty) > 0) ? 'Enter how many.' : null],
        [`swapRate-${swap.key}`, Number.isNaN(parseMoney(swap.rate, null)) ? 'Enter the rate.' : null],
      ]),
    ),
  };
  const firstError = Object.entries(errors).find(([, message]) => message);
  const shown = (key: string) => (touched ? errors[key] : null) ?? (failure?.field === key ? failure.message : null);

  const addSwap = (row: StockRow) =>
    setDraft((current) => ({
      ...current,
      swaps: [
        ...current.swaps,
        {
          key: `${row.key}\u0000${Date.now()}`,
          productId: row.productId,
          option: row.option,
          title: row.title,
          code: row.code,
          unit: row.stock?.unit ?? 'pcs',
          qty: '1',
          // Priced the way the order was billed: before GST from Stock when invoiced, at MRP otherwise.
          rate: String((invoiced ? (row.stock?.sellingPrice ?? row.mrp) : (row.mrp ?? row.stock?.sellingPrice)) ?? 0),
          discountPct: '0',
          gstRate: String(row.stock?.gstRate ?? 18),
        },
      ],
    }));

  const save = async () => {
    setTouched(true);
    setFailure(null);
    if (firstError) {
      toast({ tone: 'error', message: firstError[1]! });
      return;
    }
    const body = {
      kind: draft.kind,
      orderId: Number(orderId),
      returnDate: draft.returnDate,
      reason: draft.reason,
      reasonNote: draft.reasonNote.trim(),
      items: picked
        .filter((row) => row.qty > 0)
        .map(({ line, pick, qty, rate }) => ({ source: line.source, sourcePosition: line.position, qty, condition: pick!.condition, ...(line.source === 'order' && rate !== line.rate ? { rate } : {}) })),
      replacementItems:
        draft.kind === 'replacement'
          ? draft.swaps.map((swap) => ({ productId: swap.productId, option: swap.option, qty: qtyOf(swap.qty), rate: parseMoney(swap.rate), discountPct: parseMoney(swap.discountPct) || 0, gstRate: Number(swap.gstRate) }))
          : [],
      charges: charges || 0,
      chargesNote: draft.chargesNote.trim(),
      attachments: draft.attachments,
      notes: draft.notes.trim(),
      ...(existing ? { version: existing.version } : {}),
    };
    setSaving(true);
    try {
      const answer = await api<{ returns: SalesReturn[] }>(existing ? `/returns/${existing.id}` : '/returns', existing ? 'PUT' : 'POST', body);
      const ret = answer.returns[0]!;
      await api('/activity', 'POST', {
        area: 'returns',
        summary: `${existing ? 'Changed' : 'Recorded'} ${ret.kind === 'replacement' ? 'replacement' : 'return'} ${ret.number} from ${ret.customerName} (${data?.order.number}), ${formatINR(ret.returnValue)}`,
        to: `/returns/${ret.id}`,
      }).catch(() => null);
      window.dispatchEvent(new Event(RETURNS_CHANGED));
      toast({ message: `${ret.number} ${existing ? 'saved' : ret.status === 'approved' ? 'recorded and approved' : 'recorded: waiting for approval'}.` });
      navigate(`/returns/${ret.id}`, { replace: Boolean(existing) });
    } catch (problem) {
      const apiError = problem instanceof ApiError ? problem : new ApiError('Something went wrong.');
      setFailure(apiError);
      toast({ tone: 'error', message: apiError.message });
    } finally {
      setSaving(false);
    }
  };

  const title = existing ? `Edit ${existing.number}` : draft.kind === 'replacement' ? 'New Replacement' : 'New Return';
  if (!mayCreate)
    return (
      <>
        <PageHeader title={title} crumbs={[{ label: 'Customer Returns', to: '/returns/list' }]} />
        <Card>
          <EmptyState icon={ArrowUUpLeftIcon} title="Your role can’t record returns">
            An Owner can allow it under Return Settings.
          </EmptyState>
        </Card>
      </>
    );

  return (
    <>
      <PageHeader
        title={title}
        crumbs={[{ label: draft.kind === 'replacement' ? 'Product Replacements' : 'Customer Returns', to: draft.kind === 'replacement' ? '/returns/replacements' : '/returns/list' }]}
        description="From a delivered order. Only what was sold, less what has come back already, can be returned; prices and GST come from the bill."
      />
      {!orderId ? (
        <OrderFinder onPick={(order) => setParams({ ...(draft.kind === 'replacement' ? { kind: 'replacement' } : {}), orderId: order.id }, { replace: true })} />
      ) : !data ? (
        <Card>
          <EmptyState icon={ArrowUUpLeftIcon} title={sourceError ? 'Couldn’t load the order' : 'Loading the order…'}>
            {sourceError}
          </EmptyState>
        </Card>
      ) : (
        <div className="editor">
          <div className="stack">
            <Card aria-labelledby="order-title">
              <CardHeader
                id="order-title"
                title={`${data.order.number} · ${data.order.customer}`}
                description={[
                  data.order.deliveredAt ? `Delivered ${dayLabel(localDay(new Date(data.order.deliveredAt)))}` : 'Delivered',
                  data.invoice ? `Tax invoice ${data.invoice.number}: prices before GST, GST given back as billed` : 'No tax invoice here: prices as billed',
                  data.order.lastDay ? `Return period ends ${dayLabel(data.order.lastDay)}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                action={
                  !existing && (
                    <Button size="sm" variant="plain" onClick={() => setParams(draft.kind === 'replacement' ? { kind: 'replacement' } : {}, { replace: true })}>
                      Change Order
                    </Button>
                  )
                }
              />
              {allowReplacements && (
                <div className="card__body" style={{ paddingTop: 0 }}>
                  <Segmented<ReturnKind>
                    label="The customer wants"
                    value={draft.kind}
                    onChange={(kind) => set('kind', kind)}
                    options={[
                      { value: 'refund', label: 'Money back' },
                      { value: 'replacement', label: 'Other goods' },
                    ]}
                  />
                </div>
              )}
              <div className="table-scroll">
                <table className="table bill-lines">
                  <caption className="visually-hidden">What was sold, and what comes back</caption>
                  <thead>
                    <tr>
                      <th scope="col">Item</th>
                      <th scope="col" className="is-num">
                        Sold
                      </th>
                      <th scope="col">{invoiced ? 'Rate (before GST)' : 'Price billed'}</th>
                      <th scope="col">Coming back</th>
                      <th scope="col">Condition</th>
                      <th scope="col" className="is-num">
                        Value
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.lines.map((line: Line) => {
                      const key = lineKey(line);
                      const pick = draft.picks[key];
                      const row = picked.find((one) => lineKey(one.line) === key);
                      const error = shown(`qty-${key}`) ?? shown(`condition-${key}`) ?? shown(`rate-${key}`);
                      return (
                        <tr key={key} aria-disabled={line.returnable <= 0 || undefined}>
                          <td>
                            <div className="cell-title" style={{ whiteSpace: 'normal' }}>
                              {line.description}
                            </div>
                            <div className="cell-sub">{line.name}</div>
                            {!line.eligible && <div className="cell-sub money-late">Not a returnable category</div>}
                            {error && (
                              <p className="field__error" role="alert">
                                {error}
                              </p>
                            )}
                          </td>
                          <td className="is-num" style={{ whiteSpace: 'nowrap' }}>
                            {formatNumber(line.qty)} {UNITS[line.unit]}
                            {line.returned > 0 && <div className="cell-sub">{formatNumber(line.returned)} back already</div>}
                          </td>
                          <td>
                            {line.source === 'order' ? (
                              <input
                                className="input"
                                aria-label={`Price per unit of ${line.description}`}
                                inputMode="decimal"
                                value={pick?.rate || String(line.rate)}
                                onChange={(event) => setPick(key, { rate: event.target.value })}
                                style={{ width: 104 }}
                              />
                            ) : (
                              <span className="num">
                                {formatINR(line.rate)}
                                <div className="cell-sub">+ {line.gstRate}% GST</div>
                              </span>
                            )}
                          </td>
                          <td>
                            {line.returnable > 0 ? (
                              <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                                <input
                                  className="input"
                                  aria-label={`How many ${line.description} come back, up to ${line.returnable}`}
                                  inputMode="decimal"
                                  placeholder="0"
                                  value={pick?.qty ?? ''}
                                  onChange={(event) => setPick(key, { qty: event.target.value })}
                                  style={{ width: 76 }}
                                />
                                <Button size="sm" variant="plain" onClick={() => setPick(key, { qty: String(line.returnable) })}>
                                  All {formatNumber(line.returnable)}
                                </Button>
                              </div>
                            ) : (
                              <span className="muted">Returned in full</span>
                            )}
                          </td>
                          <td>
                            {line.returnable > 0 && (
                              <select
                                className="select"
                                aria-label={`Condition of ${line.description}`}
                                value={pick?.condition ?? ''}
                                onChange={(event) => setPick(key, { condition: event.target.value as ReturnCondition })}
                                style={{ minWidth: 150 }}
                              >
                                <option value="">Choose…</option>
                                {(Object.keys(CONDITIONS) as ReturnCondition[]).map((condition) => (
                                  <option key={condition} value={condition}>
                                    {CONDITIONS[condition]}
                                  </option>
                                ))}
                              </select>
                            )}
                          </td>
                          <td className="is-num">
                            {row?.value ? (
                              <>
                                <strong>{formatINR(row.value.amount)}</strong>
                                {row.value.tax > 0 && <div className="cell-sub">incl. {formatINR(row.value.tax)} GST</div>}
                              </>
                            ) : (
                              <span className="muted">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {shown('items') && (
                <p className="card__body field__error" role="alert">
                  {shown('items')}
                </p>
              )}
            </Card>

            {draft.kind === 'replacement' && (
              <Card aria-labelledby="swap-title" className="table-card">
                <CardHeader
                  id="swap-title"
                  title="Goods given in exchange"
                  description={invoiced ? 'Rate before GST; GST is added as on a tax invoice, and a tax invoice for these is drafted when they go out.' : 'At the price you bill; MRP to start with.'}
                />
                <div className="card__body" style={{ paddingTop: 0 }}>
                  <ItemPicker id="swap-items" rows={rows} onPick={addSwap} placeholder="Add a replacement item: name, code, SKU, or scan a barcode" />
                  {shown('swaps') && (
                    <p className="field__error" role="alert">
                      {shown('swaps')}
                    </p>
                  )}
                </div>
                {draft.swaps.length > 0 && (
                  <div className="table-scroll">
                    <table className="table bill-lines">
                      <caption className="visually-hidden">Replacement goods</caption>
                      <thead>
                        <tr>
                          <th scope="col">Item</th>
                          <th scope="col">Qty</th>
                          <th scope="col">Rate (₹)</th>
                          <th scope="col">Disc. %</th>
                          {invoiced && <th scope="col">GST</th>}
                          <th scope="col" className="is-num">
                            Amount
                          </th>
                          <th scope="col">
                            <span className="visually-hidden">Remove</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {draft.swaps.map((swap, index) => (
                          <tr key={swap.key}>
                            <td>
                              <div className="cell-title" style={{ whiteSpace: 'normal' }}>
                                {swap.title}
                              </div>
                              <div className="cell-sub mono">{swap.code}</div>
                              {(shown(`swapQty-${swap.key}`) || shown(`swapRate-${swap.key}`)) && (
                                <p className="field__error" role="alert">
                                  {shown(`swapQty-${swap.key}`) ?? shown(`swapRate-${swap.key}`)}
                                </p>
                              )}
                            </td>
                            <td>
                              <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                                <input className="input" aria-label={`Quantity of ${swap.title}`} inputMode="decimal" value={swap.qty} onChange={(event) => setSwap(swap.key, { qty: event.target.value })} style={{ width: 72 }} />
                                <span className="muted">{UNITS[swap.unit]}</span>
                              </div>
                            </td>
                            <td>
                              <input className="input" aria-label={`Rate of ${swap.title}`} inputMode="decimal" value={swap.rate} onChange={(event) => setSwap(swap.key, { rate: event.target.value })} style={{ width: 100 }} />
                            </td>
                            <td>
                              <input className="input" aria-label={`Discount on ${swap.title}`} inputMode="decimal" value={swap.discountPct} onChange={(event) => setSwap(swap.key, { discountPct: event.target.value })} style={{ width: 64 }} />
                            </td>
                            {invoiced && (
                              <td>
                                <select className="select" aria-label={`GST rate of ${swap.title}`} value={swap.gstRate} onChange={(event) => setSwap(swap.key, { gstRate: event.target.value })} style={{ width: 84 }}>
                                  {GST_RATES.map((rate) => (
                                    <option key={rate} value={String(rate)}>
                                      {rate}%
                                    </option>
                                  ))}
                                </select>
                              </td>
                            )}
                            <td className="is-num">
                              <strong>{formatINR(swapPriced.lines[index]!.amount)}</strong>
                              {swapPriced.lines[index]!.tax > 0 && <div className="cell-sub">incl. {formatINR(swapPriced.lines[index]!.tax)} GST</div>}
                            </td>
                            <td>
                              <IconButton icon={TrashIcon} label={`Remove ${swap.title}`} onClick={() => set('swaps', draft.swaps.filter((one) => one.key !== swap.key))} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            )}

            <Card aria-labelledby="why-title">
              <CardHeader id="why-title" title="Why it’s coming back" />
              <div className="card__body form-grid">
                <SelectField
                  label="Reason"
                  required
                  value={draft.reason}
                  onChange={(event) => set('reason', event.target.value as ReturnReason)}
                  error={shown('reason')}
                  options={[{ value: '', label: 'Choose the reason…' }, ...(Object.keys(RETURN_REASONS) as ReturnReason[]).map((reason) => ({ value: reason, label: RETURN_REASONS[reason] }))]}
                />
                <TextField label="Return date" type="date" max={localDay()} value={draft.returnDate} onChange={(event) => set('returnDate', event.target.value)} error={shown('returnDate')} />
                <TextAreaField
                  className="span-2"
                  label={draft.reason === 'other' ? 'What happened' : 'Details'}
                  required={draft.reason === 'other'}
                  value={draft.reasonNote}
                  onChange={(event) => set('reasonNote', event.target.value)}
                  error={shown('reasonNote')}
                  rows={2}
                  maxLength={500}
                  placeholder="e.g. Two handles had scratches on the plate"
                />
                <TextField label="Charges deducted (₹)" inputMode="numeric" value={draft.charges} onChange={(event) => set('charges', event.target.value)} error={shown('charges')} hint="Optional: a restocking or other agreed charge." />
                <TextField label="For" value={draft.chargesNote} onChange={(event) => set('chargesNote', event.target.value)} error={shown('chargesNote')} maxLength={200} placeholder="e.g. Restocking, opened box" />
                <div className="span-2 stack" style={{ gap: 'var(--space-2)' }}>
                  <span className="field__label">Photos and documents</span>
                  <AttachmentList files={draft.attachments} onRemove={(url) => set('attachments', draft.attachments.filter((one) => one !== url))} />
                  <div>
                    <AttachButton onAdd={(urls) => set('attachments', [...draft.attachments, ...urls].slice(0, 20))} disabled={draft.attachments.length >= 20} />
                  </div>
                </div>
                <TextAreaField className="span-2" label="Internal notes" value={draft.notes} onChange={(event) => set('notes', event.target.value)} rows={2} maxLength={2000} hint="Only staff see them." />
              </div>
            </Card>
          </div>

          <div className="stack editor__aside">
            <Card aria-labelledby="settle-title">
              <CardHeader id="settle-title" title="Settlement" />
              <div className="card__body stack">
                <dl className="kv kv--compact kv--split" style={{ margin: 0 }}>
                  <dt>Goods coming back</dt>
                  <dd className="num">{formatINR(returnValue)}</dd>
                  {charges > 0 && (
                    <>
                      <dt>Charges</dt>
                      <dd className="num">− {formatINR(charges)}</dd>
                    </>
                  )}
                  {draft.kind === 'replacement' && (
                    <>
                      <dt>Goods given</dt>
                      <dd className="num">− {formatINR(replacementValue)}</dd>
                    </>
                  )}
                  <dt style={{ fontWeight: 600, color: 'var(--text)' }}>{settle > 0 ? 'Refund to the customer' : settle < 0 ? 'The customer pays' : 'Even exchange'}</dt>
                  <dd className="num" style={{ fontWeight: 700, fontSize: 'var(--text-lg)' }}>
                    {formatINR(Math.abs(settle))}
                  </dd>
                </dl>
                {(late || notEligible) && (
                  <p className="notice notice--warning" style={{ margin: 0 }}>
                    <WarningCircleIcon size={16} weight="bold" aria-hidden />
                    <span>
                      {late && `After the return period (it ended ${dayLabel(data.order.lastDay!)}). `}
                      {notEligible && 'Includes an item from a category not marked returnable. '}
                      It can still be recorded; whoever approves sees why it’s flagged.
                    </span>
                  </p>
                )}
                {failure && !failure.field && (
                  <p className="notice notice--warning" role="alert" style={{ margin: 0 }}>
                    {failure.message}
                  </p>
                )}
                <Button variant="primary" block loading={saving} onClick={save} icon={draft.kind === 'replacement' ? ArrowsLeftRightIcon : ArrowUUpLeftIcon}>
                  {existing ? 'Save Changes' : draft.kind === 'replacement' ? 'Record Replacement' : 'Record Return'}
                </Button>
                <p className="field__hint" style={{ margin: 0 }}>
                  Nothing moves yet: stock changes when the goods come in, money when it’s paid.
                </p>
              </div>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}

/** Finds a delivered order to return from: by its number, its tax invoice's number, the customer, or their phone. */
function OrderFinder({ onPick }: { onPick: (order: ReturnableOrder) => void }) {
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<{ query: string; orders: ReturnableOrder[] } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const needle = query.trim();

  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      api<ReturnableOrder[]>(`/returns/orders?q=${encodeURIComponent(needle)}`).then(
        (orders) => active && setFound({ query: needle, orders }),
        (problem: unknown) => active && setFailure(problem instanceof Error ? problem.message : 'Couldn’t search orders.'),
      );
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [needle]);

  const orders = found?.orders ?? [];
  return (
    <Card aria-labelledby="find-title">
      <CardHeader id="find-title" title="Which order is it from?" description="Delivered orders only. Search by order or tax invoice number, the customer’s name or phone." />
      <div className="card__body stack">
        <div className="search" role="search">
          <MagnifyingGlassIcon size={16} aria-hidden />
          <input
            type="search"
            className="input"
            aria-label="Search delivered orders"
            placeholder="e.g. VSC-0059, VSC-26-27-412, Sadguru, 98220…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            autoFocus
          />
        </div>
        {failure && (
          <p className="notice notice--warning" role="alert">
            {failure}
          </p>
        )}
        {found && !orders.length ? (
          <p className="muted">{needle ? `No delivered order matches “${needle}”.` : 'No delivered orders yet.'}</p>
        ) : (
          <ul className="item-picker__list" aria-label={needle ? 'Matching orders' : 'Recent delivered orders'} style={{ position: 'static' }}>
            {orders.map((order) => (
              <li key={order.id}>
                <button type="button" className="item-picker__option" onClick={() => onPick(order)}>
                  <span style={{ minWidth: 0 }}>
                    <span className="cell-title" style={{ display: 'block' }}>
                      {order.customer}
                    </span>
                    <span className="cell-sub num">
                      {order.number}
                      {order.invoiceNumber ? ` · ${order.invoiceNumber}` : ''}
                      {order.phone ? ` · ${order.phone}` : ''}
                    </span>
                  </span>
                  <span className="cell-sub num" style={{ flexShrink: 0, textAlign: 'right' }}>
                    {formatINR(order.bill)}
                    <br />
                    {order.deliveredAt ? `Delivered ${dayLabel(localDay(new Date(order.deliveredAt)))}` : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="field__hint" style={{ margin: 0 }}>
          Can’t find it? Only delivered orders can have returns. <Link to="/orders">Open Orders</Link>.
        </p>
      </div>
    </Card>
  );
}
