import { CheckIcon, FileArrowUpIcon, PencilSimpleIcon, PlusIcon, ProhibitIcon, ReceiptIcon, TrashIcon, XIcon } from '@phosphor-icons/react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Badge } from '@/components/Badge';
import { Button, IconButton } from '@/components/Button';
import { Card, CardHeader } from '@/components/Card';
import { DataTable, type Column } from '@/components/DataTable';
import { ConfirmDialog } from '@/components/Dialog';
import { Drawer } from '@/components/Drawer';
import { EmptyState } from '@/components/EmptyState';
import { SearchInput, Segmented, SelectField, TextField } from '@/components/Field';
import { GstRange } from '@/components/GstRange';
import { PageHeader } from '@/components/PageHeader';
import { Stat } from '@/components/Stat';
import { useToast } from '@/components/useToast';
import { EXPENSE_CATEGORY, EXPENSE_STATUS, byCategory, type Expense, type ExpenseCategory } from '@/data/accounts';
import { inRange, initialRange, periodLabel, resolveRange } from '@/data/gst';
import { MONEY_METHODS, PAYMENT_METHODS, dayLabel, localDay } from '@/data/payments';
import { formatMoney, parseMoney } from '@/data/purchases';
import { readSession } from '@/data/session';
import { api } from '@/lib/api';
import { downloadCsv } from '@/lib/csv';
import { plural } from '@/lib/format';
import { upload } from '@/lib/upload';

type Draft = { spentOn: string; category: ExpenseCategory; description: string; paidTo: string; amount: string; gst: string; gstin: string; method: Expense['method']; reference: string; attachment: string | null };
const blank = (): Draft => ({ spentOn: localDay(), category: 'rent', description: '', paidTo: '', amount: '', gst: '', gstin: '', method: 'cash', reference: '', attachment: null });
const draftOf = (expense: Expense): Draft => ({ ...expense, amount: String(expense.amount), gst: expense.gst ? String(expense.gst) : '' });
type Show = 'all' | Expense['status'];
const CATEGORIES = Object.entries(EXPENSE_CATEGORY).map(([value, label]) => ({ value, label }));

/** The shop's running costs. The Owner's count at once; the Accountant's wait for the Owner's approval. */
export default function ExpensesPage() {
  const toast = useToast();
  const owner = readSession()?.role === 'owner';
  const [expenses, setExpenses] = useState<Expense[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState(() => initialRange('month'));
  const [show, setShow] = useState<Show>('all');
  const [category, setCategory] = useState<'' | ExpenseCategory>('');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<{ id: string | null; draft: Draft } | null>(null);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [deciding, setDeciding] = useState<{ expense: Expense; action: 'reject' | 'cancel'; reason: string } | null>(null);
  const [removing, setRemoving] = useState<Expense | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    api<Expense[]>('/expenses').then(
      (rows) => {
        setExpenses(rows);
        setError(null);
      },
      (problem: unknown) => setError(problem instanceof Error ? problem.message : 'Couldn’t load expenses.'),
    );
  }, []);
  useEffect(load, [load]);

  const period = resolveRange(range);
  const inPeriod = (expenses ?? []).filter((expense) => inRange(expense.spentOn, period));
  const counts: Record<Show, number> = { all: inPeriod.length, pending: 0, approved: 0, rejected: 0, cancelled: 0 };
  for (const expense of inPeriod) counts[expense.status] += 1;
  const needle = query.trim().toLowerCase();
  const rows = inPeriod.filter(
    (expense) =>
      (show === 'all' || expense.status === show) &&
      (!category || expense.category === category) &&
      (!needle || [expense.number, expense.description, expense.paidTo, expense.reference, expense.gstin].some((text) => text.toLowerCase().includes(needle))),
  );
  const approved = inPeriod.filter((expense) => expense.status === 'approved');
  const pending = inPeriod.filter((expense) => expense.status === 'pending');
  const sum = (list: Expense[], pick: (expense: Expense) => number = (expense) => expense.amount) => list.reduce((total, expense) => total + pick(expense), 0);
  const categories = byCategory(approved);
  const monthTotals = new Map<string, number>();
  for (const expense of approved) monthTotals.set(expense.spentOn.slice(0, 7), (monthTotals.get(expense.spentOn.slice(0, 7)) ?? 0) + expense.amount);
  const months = [...monthTotals].sort(([a], [b]) => b.localeCompare(a));

  const run = async (path: string, method: 'POST' | 'PUT' | 'DELETE', body: unknown, done: string) => {
    try {
      await api(path, method, body);
      toast({ message: done });
      load();
      return true;
    } catch (problem) {
      toast({ tone: 'error', message: problem instanceof Error ? problem.message : 'That didn’t work. Please try again.' });
      return false;
    }
  };

  const save = async () => {
    if (!editing) return;
    const { draft, id } = editing;
    const amount = parseMoney(draft.amount, null);
    const gst = parseMoney(draft.gst);
    if (amount === null || Number.isNaN(amount) || amount <= 0) return void toast({ tone: 'error', message: 'Enter the amount paid, in rupees and paise.' });
    if (Number.isNaN(gst) || gst < 0) return void toast({ tone: 'error', message: 'Enter the GST in rupees and paise, or leave it empty.' });
    setSaving(true);
    const body = { ...draft, description: draft.description.trim(), paidTo: draft.paidTo.trim(), gstin: draft.gstin.trim(), reference: draft.reference.trim(), amount, gst };
    const ok = await run(id ? `/expenses/${id}` : '/expenses', id ? 'PUT' : 'POST', body, owner ? 'Expense saved.' : 'Expense saved. It counts once the Owner approves it.');
    setSaving(false);
    if (ok) setEditing(null);
  };

  const columns: Column<Expense>[] = [
    {
      key: 'expense',
      header: 'Expense',
      sortValue: (expense) => expense.number,
      cell: (expense) => (
        <>
          <span className="cell-title">{expense.description}</span>
          <div className="cell-sub">
            <span className="num">{expense.number}</span> · {EXPENSE_CATEGORY[expense.category]}
            {expense.attachment && (
              <>
                {' · '}
                <a href={expense.attachment} target="_blank" rel="noreferrer">
                  Bill
                </a>
              </>
            )}
          </div>
        </>
      ),
    },
    { key: 'day', header: 'Paid on', sortValue: (expense) => expense.spentOn, cell: (expense) => <span className="num">{dayLabel(expense.spentOn)}</span> },
    {
      key: 'paidTo',
      header: 'Paid to',
      sortValue: (expense) => expense.paidTo,
      cell: (expense) => (
        <>
          {expense.paidTo || '—'}
          <div className="cell-sub">
            {PAYMENT_METHODS[expense.method]}
            {expense.reference ? ` · ${expense.reference}` : ''}
          </div>
        </>
      ),
    },
    {
      key: 'amount',
      header: 'Amount',
      align: 'num',
      sortValue: (expense) => expense.amount,
      cell: (expense) => (
        <>
          <span className="num">{formatMoney(expense.amount)}</span>
          {expense.gst > 0 && <div className="cell-sub num">GST {formatMoney(expense.gst)}</div>}
        </>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      sortValue: (expense) => expense.status,
      cell: (expense) => (
        <>
          <Badge tone={EXPENSE_STATUS[expense.status].tone}>{EXPENSE_STATUS[expense.status].label}</Badge>
          <div className="cell-sub">{expense.reason ? `${expense.reason} · ${expense.decidedBy}` : expense.status === 'pending' ? `By ${expense.createdBy}` : (expense.decidedBy ?? expense.createdBy)}</div>
        </>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      hideHeader: true,
      align: 'actions',
      cell: (expense) => (
        <div className="row-wrap" style={{ justifyContent: 'flex-end', gap: 'var(--space-1)' }}>
          {owner && expense.status === 'pending' && (
            <>
              <IconButton icon={CheckIcon} label={`Approve ${expense.number}`} onClick={() => run(`/expenses/${expense.id}/approve`, 'POST', undefined, `${expense.number} approved.`)} />
              <IconButton icon={XIcon} tone="danger" label={`Reject ${expense.number}`} onClick={() => setDeciding({ expense, action: 'reject', reason: '' })} />
            </>
          )}
          {(expense.status === 'pending' || expense.status === 'rejected') && (
            <>
              <IconButton icon={PencilSimpleIcon} label={`Edit ${expense.number}`} onClick={() => setEditing({ id: expense.id, draft: draftOf(expense) })} />
              <IconButton icon={TrashIcon} tone="danger" label={`Delete ${expense.number}`} onClick={() => setRemoving(expense)} />
            </>
          )}
          {owner && expense.status === 'approved' && <IconButton icon={ProhibitIcon} tone="danger" label={`Cancel ${expense.number}`} onClick={() => setDeciding({ expense, action: 'cancel', reason: '' })} />}
        </div>
      ),
    },
  ];

  const draft = editing?.draft;
  const setDraft = (change: Partial<Draft>) => setEditing((current) => current && { ...current, draft: { ...current.draft, ...change } });

  return (
    <>
      <PageHeader
        title="Expenses"
        description={owner ? 'The shop’s running costs. Yours count at once; the Accountant’s wait for your approval.' : 'The shop’s running costs. Yours count once the Owner approves them.'}
        actions={
          <>
            <Button
              disabled={!rows.length}
              onClick={() =>
                downloadCsv(
                  `vimalnath-expenses-${period.from}-to-${period.to}`,
                  ['Number', 'Paid on', 'Category', 'Description', 'Paid to', 'Method', 'Reference', 'Amount', 'GST', 'Seller GSTIN', 'Status', 'Entered by', 'Decided by', 'Reason'],
                  rows.map((expense) => [expense.number, expense.spentOn, EXPENSE_CATEGORY[expense.category], expense.description, expense.paidTo, PAYMENT_METHODS[expense.method], expense.reference, expense.amount, expense.gst, expense.gstin, EXPENSE_STATUS[expense.status].label, expense.createdBy, expense.decidedBy ?? '', expense.reason]),
                )
              }
            >
              Export CSV
            </Button>
            <Button variant="primary" icon={PlusIcon} onClick={() => setEditing({ id: null, draft: blank() })}>
              Add Expense
            </Button>
          </>
        }
      />

      <div className="stack-lg">
        <div className="row-wrap" style={{ alignItems: 'flex-end', gap: 'var(--space-3)' }}>
          <GstRange value={range} onChange={setRange} />
          <SelectField label="Category" value={category} onChange={(event) => setCategory(event.target.value as '' | ExpenseCategory)} options={[{ value: '', label: 'All categories' }, ...CATEGORIES]} />
        </div>

        <div className="stats">
          <Stat label={`Spent, ${period.label}`} icon={ReceiptIcon} value={formatMoney(sum(approved))} foot={plural(approved.length, 'approved expense')} />
          <Stat label="Waiting for approval" icon={ReceiptIcon} value={formatMoney(sum(pending))} foot={plural(pending.length, 'expense')} />
          <Stat label="GST in approved bills" icon={ReceiptIcon} value={formatMoney(sum(approved, (expense) => expense.gst))} />
          <Stat label="Largest category" icon={ReceiptIcon} value={categories[0] ? EXPENSE_CATEGORY[categories[0].category] : '—'} foot={categories[0] ? formatMoney(categories[0].amount) : undefined} />
        </div>

        {approved.length > 0 && (
          <div className="grid-2">
            <Card>
              <CardHeader title="By category" description={`Approved, ${period.label}.`} />
              <table className="table">
                <caption className="visually-hidden">Expenses by category</caption>
                <tbody>
                  {categories.map((row) => (
                    <tr key={row.category}>
                      <th scope="row">{EXPENSE_CATEGORY[row.category]}</th>
                      <td className="is-num">{formatMoney(row.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
            <Card>
              <CardHeader title="By month" description={`Approved, ${period.label}.`} />
              <table className="table">
                <caption className="visually-hidden">Expenses by month</caption>
                <tbody>
                  {months.map(([month, amount]) => (
                    <tr key={month}>
                      <th scope="row">{periodLabel(month)}</th>
                      <td className="is-num">{formatMoney(Math.round(amount * 100) / 100)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>
        )}

        <div>
          <div className="toolbar">
            <Segmented<Show>
              label="Show"
              value={show}
              onChange={setShow}
              options={[
                { value: 'all', label: 'All', count: counts.all },
                { value: 'pending', label: 'Waiting', count: counts.pending },
                { value: 'approved', label: 'Approved', count: counts.approved },
                { value: 'rejected', label: 'Rejected', count: counts.rejected },
                { value: 'cancelled', label: 'Cancelled', count: counts.cancelled },
              ]}
            />
            <SearchInput label="Search expenses" value={query} onChange={setQuery} placeholder="Number, what for, paid to, reference" />
          </div>
          <Card className="table-card">
            {!expenses ? (
              <EmptyState icon={ReceiptIcon} title={error ? 'Couldn’t load expenses' : 'Loading…'}>
                {error}
              </EmptyState>
            ) : (
              <DataTable
                caption="Expenses"
                rows={rows}
                columns={columns}
                getRowId={(expense) => expense.id}
                initialSort={{ key: 'day', direction: 'desc' }}
                resetKey={`${show}${category}${needle}${period.from}${period.to}`}
                empty={
                  <EmptyState icon={ReceiptIcon} title="No expenses here">
                    Add rent, electricity, salaries and other costs as they’re paid.
                  </EmptyState>
                }
              />
            )}
          </Card>
        </div>
      </div>

      <Drawer
        open={Boolean(editing)}
        title={editing?.id ? 'Edit Expense' : 'Add Expense'}
        description={owner ? undefined : 'It counts once the Owner approves it.'}
        dirty={Boolean(draft && (draft.description || draft.amount))}
        onClose={() => setEditing(null)}
        onSubmit={save}
        footer={
          <>
            <Button onClick={() => setEditing(null)}>Cancel</Button>
            <Button type="submit" variant="primary" loading={saving}>
              Save Expense
            </Button>
          </>
        }
      >
        {draft && (
          <div className="stack">
            <div className="form-grid">
              <TextField label="Paid on" type="date" max={localDay()} value={draft.spentOn} onChange={(event) => setDraft({ spentOn: event.target.value })} required />
              <SelectField label="Category" value={draft.category} onChange={(event) => setDraft({ category: event.target.value as ExpenseCategory })} options={CATEGORIES} required />
              <TextField className="span-2" label="What for" value={draft.description} onChange={(event) => setDraft({ description: event.target.value })} maxLength={300} placeholder="Shop rent for November" required />
              <TextField label="Paid to" value={draft.paidTo} onChange={(event) => setDraft({ paidTo: event.target.value })} maxLength={150} />
              <SelectField label="Paid by" value={draft.method} onChange={(event) => setDraft({ method: event.target.value as Expense['method'] })} options={MONEY_METHODS.map((method) => ({ value: method, label: PAYMENT_METHODS[method] }))} />
              <TextField label="Amount paid" prefix="₹" inputMode="decimal" value={draft.amount} onChange={(event) => setDraft({ amount: event.target.value })} placeholder="0" autoComplete="off" required hint="GST included." />
              <TextField label="GST in it" prefix="₹" inputMode="decimal" value={draft.gst} onChange={(event) => setDraft({ gst: event.target.value })} placeholder="0" autoComplete="off" hint="From a GST bill; empty if none." />
              <TextField label="Seller’s GSTIN" value={draft.gstin} onChange={(event) => setDraft({ gstin: event.target.value.toUpperCase() })} maxLength={15} />
              <TextField label="Reference" value={draft.reference} onChange={(event) => setDraft({ reference: event.target.value })} maxLength={60} hint="Bill, cheque or UTR number." />
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
                    setDraft({ attachment: url });
                  } catch (problem) {
                    toast({ tone: 'error', message: problem instanceof Error ? problem.message : 'That file couldn’t be uploaded.' });
                  } finally {
                    setProgress(null);
                    event.target.value = '';
                  }
                }}
              />
              <Button size="sm" icon={FileArrowUpIcon} onClick={() => fileInput.current?.click()} loading={progress !== null} loadingLabel={`Uploading ${Math.round((progress ?? 0) * 100)}%`}>
                {draft.attachment ? 'Replace Bill' : 'Attach Bill or Receipt'}
              </Button>
              {draft.attachment && (
                <a href={draft.attachment} target="_blank" rel="noreferrer">
                  View
                </a>
              )}
            </div>
          </div>
        )}
      </Drawer>

      <Drawer
        open={Boolean(deciding)}
        title={deciding?.action === 'reject' ? `Reject ${deciding.expense.number}?` : `Cancel ${deciding?.expense.number ?? ''}?`}
        description={deciding?.action === 'reject' ? 'The Accountant sees why, and can fix it and send it again.' : 'It comes out of the books and stays listed as cancelled.'}
        onClose={() => setDeciding(null)}
        onSubmit={async () => {
          if (!deciding) return;
          if (!deciding.reason.trim()) return void toast({ tone: 'error', message: 'Give a reason.' });
          const { expense, action } = deciding;
          if (await run(`/expenses/${expense.id}/${action}`, 'POST', { reason: deciding.reason.trim() }, `${expense.number} ${action === 'reject' ? 'rejected' : 'cancelled'}.`)) setDeciding(null);
        }}
        footer={
          <>
            <Button onClick={() => setDeciding(null)}>Back</Button>
            <Button type="submit" variant="danger">
              {deciding?.action === 'reject' ? 'Reject Expense' : 'Cancel Expense'}
            </Button>
          </>
        }
      >
        {deciding && <TextField label="Reason" value={deciding.reason} onChange={(event) => setDeciding({ ...deciding, reason: event.target.value })} maxLength={300} required autoFocus />}
      </Drawer>

      <ConfirmDialog
        open={Boolean(removing)}
        title={`Delete ${removing?.number ?? ''}?`}
        body={removing ? `${removing.description}, ${formatMoney(removing.amount)}. It hasn’t been approved, so nothing in the books changes.` : ''}
        confirmLabel="Delete"
        destructive
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          const expense = removing;
          setRemoving(null);
          if (expense) void run(`/expenses/${expense.id}`, 'DELETE', undefined, `${expense.number} deleted.`);
        }}
      />
    </>
  );
}
