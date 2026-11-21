import { BankIcon, FileArrowUpIcon, PlusIcon, TrashIcon } from '@phosphor-icons/react';
import { useRef, useState } from 'react';

import { Button, IconButton } from '@/components/Button';
import { Card } from '@/components/Card';
import { ConfirmDialog } from '@/components/Dialog';
import { Drawer } from '@/components/Drawer';
import { EmptyState } from '@/components/EmptyState';
import { TextField } from '@/components/Field';
import { PageHeader } from '@/components/PageHeader';
import { useToast } from '@/components/useToast';
import { periodLabel } from '@/data/gst';
import { dayLabel, localDay } from '@/data/payments';
import { formatMoney, parseMoney } from '@/data/purchases';
import type { GstPayment } from '@/data/types';
import { useGst } from '@/hooks/useGst';
import { api } from '@/lib/api';
import { downloadCsv } from '@/lib/csv';
import { upload } from '@/lib/upload';

const HEADS = ['cgst', 'sgst', 'igst', 'cess', 'interest', 'penalty'] as const;
const LABEL: Record<(typeof HEADS)[number], string> = { cgst: 'CGST', sgst: 'SGST', igst: 'IGST', cess: 'Cess', interest: 'Interest', penalty: 'Penalty' };
type Draft = Record<(typeof HEADS)[number] | 'period' | 'paidOn' | 'challan' | 'cpin' | 'cin' | 'note', string> & { attachment: string | null };
const blank = (): Draft => ({ period: localDay().slice(0, 7), paidOn: localDay(), challan: '', cpin: '', cin: '', note: '', attachment: null, cgst: '', sgst: '', igst: '', cess: '', interest: '', penalty: '' });
const sumOf = (payment: Pick<GstPayment, (typeof HEADS)[number]>) => HEADS.reduce((total, head) => total + payment[head], 0);

/** GST paid to the government, entered from each challan. Recorded by staff, never assumed. */
export default function GstPaymentsPage() {
  const toast = useToast();
  const { data, error, reload } = useGst();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Draft>(blank);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<GstPayment | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const amounts = Object.fromEntries(HEADS.map((head) => [head, parseMoney(draft[head])])) as Record<(typeof HEADS)[number], number>;
  const bad = HEADS.find((head) => Number.isNaN(amounts[head]) || amounts[head] < 0);

  const save = async () => {
    if (bad) return void toast({ tone: 'error', message: `Enter ${LABEL[bad]} in rupees and paise.` });
    if (!HEADS.some((head) => amounts[head] > 0)) return void toast({ tone: 'error', message: 'Enter what was paid under at least one head.' });
    setSaving(true);
    try {
      await api('/gst/payments', 'POST', { period: draft.period, paidOn: draft.paidOn, challan: draft.challan.trim(), cpin: draft.cpin.trim(), cin: draft.cin.trim(), note: draft.note.trim(), attachment: draft.attachment, ...amounts });
      await api('/activity', 'POST', { area: 'settings', summary: `Recorded GST paid for ${periodLabel(draft.period)}: ${formatMoney(sumOf(amounts))}${draft.challan ? ` (challan ${draft.challan})` : ''}`, to: '/gst/payments' }).catch(() => null);
      toast({ message: 'GST payment recorded.' });
      setAdding(false);
      reload();
    } catch (problem) {
      toast({ tone: 'error', message: problem instanceof Error ? problem.message : 'Couldn’t save it.' });
    } finally {
      setSaving(false);
    }
  };

  const remove = async (payment: GstPayment) => {
    setRemoving(null);
    try {
      await api(`/gst/payments/${payment.id}`, 'DELETE');
      await api('/activity', 'POST', { area: 'settings', summary: `Removed a GST payment for ${periodLabel(payment.period)} (${formatMoney(sumOf(payment))})`, to: '/gst/payments' }).catch(() => null);
      toast({ message: 'Payment removed.' });
      reload();
    } catch (problem) {
      toast({ tone: 'error', message: problem instanceof Error ? problem.message : 'Couldn’t remove it.' });
    }
  };

  const payments = data?.payments ?? [];

  return (
    <>
      <PageHeader
        title="GST Payments"
        description="GST paid to the government, as entered from each challan. The GST Dashboard sets them against what’s payable for the month."
        actions={
          <>
            <Button
              disabled={!payments.length}
              onClick={() =>
                downloadCsv(
                  'vimalnath-gst-payments',
                  ['Month', 'Paid on', 'Challan', 'CPIN', 'CIN', ...HEADS.map((head) => LABEL[head]), 'Total', 'Note', 'Recorded by'],
                  payments.map((payment) => [payment.period, payment.paidOn, payment.challan, payment.cpin, payment.cin, ...HEADS.map((head) => payment[head]), sumOf(payment), payment.note, payment.by]),
                )
              }
            >
              Export CSV
            </Button>
            <Button
              variant="primary"
              icon={PlusIcon}
              onClick={() => {
                setDraft(blank());
                setAdding(true);
              }}
            >
              Record Payment
            </Button>
          </>
        }
      />
      <Card className="table-card">
        {!data ? (
          <EmptyState icon={BankIcon} title={error ? 'Couldn’t load payments' : 'Loading…'}>
            {error}
          </EmptyState>
        ) : payments.length ? (
          <div className="table-scroll">
            <table className="table">
              <caption className="visually-hidden">GST payments</caption>
              <thead>
                <tr>
                  <th scope="col">Month</th>
                  <th scope="col">Paid on</th>
                  <th scope="col">Challan</th>
                  {HEADS.map((head) => (
                    <th key={head} scope="col" className="is-num">
                      {LABEL[head]}
                    </th>
                  ))}
                  <th scope="col" className="is-num">
                    Total
                  </th>
                  <th scope="col">
                    <span className="visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {payments.map((payment) => (
                  <tr key={payment.id}>
                    <td>{periodLabel(payment.period)}</td>
                    <td className="num">{dayLabel(payment.paidOn)}</td>
                    <td>
                      <span className="mono">{payment.challan || payment.cpin || '—'}</span>
                      {payment.cin && <div className="cell-sub mono">CIN {payment.cin}</div>}
                      {payment.attachment && (
                        <div className="cell-sub">
                          <a href={payment.attachment} target="_blank" rel="noreferrer">
                            View challan
                          </a>
                        </div>
                      )}
                    </td>
                    {HEADS.map((head) => (
                      <td key={head} className="is-num">
                        {payment[head] ? formatMoney(payment[head]) : '—'}
                      </td>
                    ))}
                    <td className="is-num" style={{ fontWeight: 600 }}>
                      {formatMoney(sumOf(payment))}
                    </td>
                    <td>
                      <IconButton icon={TrashIcon} tone="danger" label={`Remove the payment for ${periodLabel(payment.period)}`} onClick={() => setRemoving(payment)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon={BankIcon} title="No GST payments recorded">
            Record each challan once it’s paid on the GST portal.
          </EmptyState>
        )}
      </Card>

      <Drawer
        open={adding}
        title="Record GST Payment"
        description="From the challan, once paid on the GST portal."
        dirty={HEADS.some((head) => draft[head])}
        onClose={() => setAdding(false)}
        onSubmit={save}
        footer={
          <>
            <Button onClick={() => setAdding(false)}>Cancel</Button>
            <Button type="submit" variant="primary" loading={saving}>
              Record Payment
            </Button>
          </>
        }
      >
        <div className="stack">
          <div className="form-grid">
            <TextField label="For the month" type="month" value={draft.period} onChange={(event) => setDraft({ ...draft, period: event.target.value })} required />
            <TextField label="Paid on" type="date" max={localDay()} value={draft.paidOn} onChange={(event) => setDraft({ ...draft, paidOn: event.target.value })} required />
            <TextField label="Challan number" value={draft.challan} onChange={(event) => setDraft({ ...draft, challan: event.target.value })} maxLength={40} />
            <TextField label="CPIN" value={draft.cpin} onChange={(event) => setDraft({ ...draft, cpin: event.target.value })} maxLength={20} inputMode="numeric" />
            <TextField className="span-2" label="CIN" value={draft.cin} onChange={(event) => setDraft({ ...draft, cin: event.target.value })} maxLength={30} hint="From the bank, once the payment goes through." />
            {HEADS.map((head) => (
              <TextField key={head} label={LABEL[head]} prefix="₹" inputMode="decimal" value={draft[head]} onChange={(event) => setDraft({ ...draft, [head]: event.target.value })} placeholder="0" autoComplete="off" />
            ))}
            <TextField className="span-2" label="Note" value={draft.note} onChange={(event) => setDraft({ ...draft, note: event.target.value })} maxLength={300} />
          </div>
          <div className="row-wrap" style={{ alignItems: 'center' }}>
            <input
              ref={fileInput}
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/webp"
              className="visually-hidden"
              tabIndex={-1}
              aria-hidden
              onChange={async (event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                setProgress(0);
                try {
                  const url = await upload(file, setProgress);
                  setDraft((current) => ({ ...current, attachment: url }));
                } catch (problem) {
                  toast({ tone: 'error', message: problem instanceof Error ? problem.message : 'That file couldn’t be uploaded.' });
                } finally {
                  setProgress(null);
                  event.target.value = '';
                }
              }}
            />
            <Button size="sm" icon={FileArrowUpIcon} onClick={() => fileInput.current?.click()} loading={progress !== null} loadingLabel={`Uploading ${Math.round((progress ?? 0) * 100)}%`}>
              {draft.attachment ? 'Replace Challan Copy' : 'Attach Challan Copy'}
            </Button>
            {draft.attachment && (
              <a href={draft.attachment} target="_blank" rel="noreferrer">
                View
              </a>
            )}
          </div>
          <p className="field__hint" style={{ margin: 0 }}>
            Total {formatMoney(HEADS.reduce((total, head) => total + (Number.isNaN(amounts[head]) ? 0 : amounts[head]), 0))}
          </p>
        </div>
      </Drawer>
      <ConfirmDialog
        open={Boolean(removing)}
        title="Remove this GST payment?"
        body={removing ? `${periodLabel(removing.period)}, ${formatMoney(sumOf(removing))}. Only if it was entered by mistake: the payment itself stays made on the portal.` : ''}
        confirmLabel="Remove"
        destructive
        onCancel={() => setRemoving(null)}
        onConfirm={() => removing && remove(removing)}
      />
    </>
  );
}
