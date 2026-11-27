import { PencilSimpleIcon, PercentIcon, PlusIcon, TrashIcon } from '@phosphor-icons/react';
import { useEffect, useMemo, useState } from 'react';

import { Badge } from '@/components/Badge';
import { Button, IconButton } from '@/components/Button';
import { Card, CardHeader } from '@/components/Card';
import { ConfirmDialog } from '@/components/Dialog';
import { Drawer } from '@/components/Drawer';
import { EmptyState } from '@/components/EmptyState';
import { Segmented, SelectField, Switch, TextField } from '@/components/Field';
import { ItemPicker } from '@/components/ItemPicker';
import { PageHeader } from '@/components/PageHeader';
import { useToast } from '@/components/useToast';
import { DISCOUNT_LEVEL, DISCOUNT_TYPE, rangeOf } from '@/data/billing';
import { dayLabel, localDay } from '@/data/payments';
import { parseMoney } from '@/data/purchases';
import { readSession } from '@/data/session';
import { stockRows } from '@/data/stock';
import type { DiscountLevel, DiscountRule, DiscountSetup } from '@/data/types';
import { useData } from '@/data/useData';
import { ApiError, api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';

type Target = { scope: DiscountRule['scope']; categoryId: string | null; productId: string | null; option: string; label: string };
type StaffLevel = { id: number; name: string; role: string; active: boolean; level: Exclude<DiscountLevel, 'owner'>; limitPct: number | null };

const ROLE_LABEL: Record<string, string> = { sales: 'Sales', accountant: 'Accountant', catalogue: 'Catalogue', inventory: 'Inventory' };

/** When a rule applies, in words. */
const datesOf = (rule: DiscountRule) => (rule.startsOn && rule.endsOn ? `${dayLabel(rule.startsOn)} to ${dayLabel(rule.endsOn)}` : rule.startsOn ? `From ${dayLabel(rule.startsOn)}` : rule.endsOn ? `Until ${dayLabel(rule.endsOn)}` : 'Always');
const staffOf = (rule: DiscountRule) => (rule.requiresApproval ? 'Above the suggested needs approval' : rule.type === 'amount' ? (rule.staffMaxAmount !== null ? `Up to ₹${rule.staffMaxAmount}` : 'Up to the maximum') : rule.staffMaxPct !== null ? `Up to ${rule.staffMaxPct}%` : 'Up to the maximum');

/**
 * Discount Management: the lowest and highest discount allowed on each category (and, as overrides, on single products),
 * what staff may give without approval, and who may approve. Bills are checked against these as they're made and again
 * on the server before finalizing.
 */
export default function DiscountsPage() {
  const toast = useToast();
  const { db } = useData();
  const owner = readSession()?.role === 'owner';
  const [setup, setSetup] = useState<DiscountSetup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ target: Target; rule?: DiscountRule } | null>(null);
  const [removing, setRemoving] = useState<DiscountRule | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    api<DiscountSetup>('/discounts/rules').then(
      (loaded) => active && setSetup(loaded),
      (problem: unknown) => active && setError(problem instanceof Error ? problem.message : 'Couldn’t load the rules.'),
    );
    return () => {
      active = false;
    };
  }, [attempt]);
  const pickRows = useMemo(() => stockRows(db.products, db.stock), [db.products, db.stock]);

  if (!setup)
    return (
      <>
        <PageHeader title="Discount Management" crumbs={[{ label: 'Billing', to: '/billing' }]} />
        <Card>
          <EmptyState icon={PercentIcon} title={error ? 'Couldn’t load the rules' : 'Loading…'}>
            {error}
          </EmptyState>
        </Card>
      </>
    );

  const canEdit = setup.me.level === 'owner' || setup.me.level === 'admin';
  const today = localDay();
  const fallback = setup.rules.find((rule) => rule.scope === 'default');
  const productRules = setup.rules.filter((rule) => rule.scope === 'product');
  const live = (rule: DiscountRule) => (!rule.startsOn || rule.startsOn <= today) && (!rule.endsOn || rule.endsOn >= today);

  const toggleProducts = async (on: boolean) => {
    try {
      await api('/discounts/settings', 'PUT', { productRules: on });
      setSetup({ ...setup, productRules: on });
      toast({ message: on ? 'Product overrides are on.' : 'Product overrides are off: only category rules apply.' });
    } catch (problem) {
      toast({ tone: 'error', message: problem instanceof Error ? problem.message : 'Couldn’t change it.' });
    }
  };
  const remove = async () => {
    const rule = removing;
    setRemoving(null);
    if (!rule) return;
    try {
      await api(`/discounts/rules/${rule.id}`, 'DELETE');
      await api('/activity', 'POST', { area: 'settings', summary: `Removed the discount rule for ${rule.label}`, to: '/billing/discounts' }).catch(() => null);
      setAttempt((count) => count + 1);
      toast({ message: `${rule.label} now follows ${rule.scope === 'product' ? 'its category' : 'the default policy'}.` });
    } catch (problem) {
      toast({ tone: 'error', message: problem instanceof Error ? problem.message : 'Couldn’t remove it.' });
    }
  };

  const RuleCells = ({ rule }: { rule?: DiscountRule }) =>
    rule ? (
      <>
        <td>
          <Badge tone={!rule.enabled ? 'neutral' : live(rule) ? 'success' : 'warning'}>{!rule.enabled ? 'No discount' : live(rule) ? 'On' : 'Not in its dates'}</Badge>
        </td>
        <td>
          {rule.enabled ? rangeOf(rule) : '—'}
          <div className="cell-sub">{DISCOUNT_TYPE[rule.type]}</div>
        </td>
        <td>{rule.enabled ? (rule.type === 'amount' ? `₹${rule.defaultAmount}` : `${rule.defaultPct}%`) : '—'}</td>
        <td>{rule.enabled ? staffOf(rule) : '—'}</td>
        <td>{datesOf(rule)}</td>
      </>
    ) : (
      <td colSpan={5} className="muted">
        Follows the default policy{fallback ? ` (${rangeOf(fallback)})` : ''}
      </td>
    );

  return (
    <>
      <PageHeader
        title="Discount Management"
        crumbs={[{ label: 'Billing', to: '/billing' }]}
        description="The lowest and highest discount on each category. Bills check every line against its rule (product override, then category, then the default policy); discounts are taken before GST."
      />
      <div className="stack-lg">
        {!canEdit && (
          <p className="notice notice--info" style={{ margin: 0 }}>
            You can give discounts within these rules{setup.me.level === 'manager' && setup.me.limitPct !== null ? `, up to ${setup.me.limitPct}% yourself` : ''}. An Owner or discount admin changes them.
          </p>
        )}
        <Card aria-labelledby="default-title">
          <CardHeader
            id="default-title"
            title="Default policy"
            description="For any item whose category has no rule of its own."
            action={
              canEdit &&
              fallback && (
                <Button size="sm" icon={PencilSimpleIcon} onClick={() => setEditing({ target: { scope: 'default', categoryId: null, productId: null, option: '', label: 'Default policy' }, rule: fallback })}>
                  Edit
                </Button>
              )
            }
          />
          {fallback && (
            <div className="card__body">
              <dl className="kv kv--compact">
                <dt>Range</dt>
                <dd>{rangeOf(fallback)}</dd>
                <dt>Suggested</dt>
                <dd>{fallback.type === 'amount' ? `₹${fallback.defaultAmount}` : `${fallback.defaultPct}%`}</dd>
                <dt>Billing staff</dt>
                <dd>{staffOf(fallback)}</dd>
                <dt>Changed</dt>
                <dd>
                  {formatDateTime(fallback.updatedAt)}
                  {fallback.updatedBy && ` by ${fallback.updatedBy}`}
                </dd>
              </dl>
            </div>
          )}
        </Card>

        <Card aria-labelledby="category-title" className="table-card">
          <CardHeader id="category-title" title="Category-wise discounts" description="Set a range for each category. Lines outside it can’t be saved or finalized." />
          <div className="table-scroll">
            <table className="table">
              <caption className="visually-hidden">Category-wise discount rules</caption>
              <thead>
                <tr>
                  <th scope="col">Category</th>
                  <th scope="col">Status</th>
                  <th scope="col">Allowed</th>
                  <th scope="col">Suggested</th>
                  <th scope="col">Billing staff</th>
                  <th scope="col">Dates</th>
                  <th scope="col">
                    <span className="visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {setup.categories.map((category) => {
                  const rule = setup.rules.find((one) => one.scope === 'category' && one.categoryId === category.id);
                  return (
                    <tr key={category.id}>
                      <th scope="row" className="cell-title">
                        {category.label}
                        {rule?.note && <div className="cell-sub">{rule.note}</div>}
                      </th>
                      <RuleCells rule={rule} />
                      <td className="is-actions">
                        {canEdit && (
                          <span className="row" style={{ gap: 4, flexWrap: 'nowrap', justifyContent: 'flex-end' }}>
                            <Button size="sm" variant={rule ? 'secondary' : 'plain'} icon={rule ? PencilSimpleIcon : PlusIcon} onClick={() => setEditing({ target: { scope: 'category', categoryId: category.id, productId: null, option: '', label: category.label }, rule })}>
                              {rule ? 'Edit' : 'Set Rule'}
                            </Button>
                            {rule && <IconButton icon={TrashIcon} tone="danger" label={`Remove the rule for ${category.label}`} onClick={() => setRemoving(rule)} />}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        <Card aria-labelledby="product-title" className="table-card">
          <CardHeader id="product-title" title="Product overrides" description="A product (or one of its options) with its own range, ahead of its category’s." />
          <div className="card__body stack" style={{ paddingTop: 0 }}>
            <Switch
              label="Use product overrides"
              description={setup.productRules ? 'On: a product’s own rule comes first.' : 'Off: every product follows its category’s rule; the overrides below are kept but not used.'}
              checked={setup.productRules}
              disabled={!canEdit}
              onChange={(on) => void toggleProducts(on)}
            />
            {canEdit && (
              <ItemPicker
                id="override-product"
                rows={pickRows}
                placeholder="Add an override: search a product"
                onPick={(row) => setEditing({ target: { scope: 'product', categoryId: null, productId: row.productId, option: row.option, label: row.title }, rule: productRules.find((rule) => rule.productId === row.productId && rule.option === row.option) })}
              />
            )}
          </div>
          {productRules.length > 0 && (
            <div className="table-scroll">
              <table className="table">
                <caption className="visually-hidden">Product overrides</caption>
                <thead>
                  <tr>
                    <th scope="col">Product</th>
                    <th scope="col">Status</th>
                    <th scope="col">Allowed</th>
                    <th scope="col">Suggested</th>
                    <th scope="col">Billing staff</th>
                    <th scope="col">Dates</th>
                    <th scope="col">
                      <span className="visually-hidden">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {productRules.map((rule) => (
                    <tr key={rule.id} className={setup.productRules ? undefined : 'is-muted'}>
                      <th scope="row" className="cell-title">
                        {rule.label}
                        {rule.note && <div className="cell-sub">{rule.note}</div>}
                      </th>
                      <RuleCells rule={rule} />
                      <td className="is-actions">
                        {canEdit && (
                          <span className="row" style={{ gap: 4, flexWrap: 'nowrap', justifyContent: 'flex-end' }}>
                            <Button size="sm" icon={PencilSimpleIcon} onClick={() => setEditing({ target: { scope: 'product', categoryId: null, productId: rule.productId, option: rule.option, label: rule.label }, rule })}>
                              Edit
                            </Button>
                            <IconButton icon={TrashIcon} tone="danger" label={`Remove the override for ${rule.label}`} onClick={() => setRemoving(rule)} />
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {owner && <StaffLevels />}
      </div>

      <RuleDrawer
        editing={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          setAttempt((count) => count + 1);
        }}
      />
      <ConfirmDialog
        open={removing !== null}
        title={`Remove the rule for ${removing?.label}?`}
        body={`It then follows ${removing?.scope === 'product' ? 'its category’s rule' : 'the default policy'}. Bills already finalized keep the rule they were made under.`}
        confirmLabel="Remove Rule"
        destructive
        onCancel={() => setRemoving(null)}
        onConfirm={() => void remove()}
      />
    </>
  );
}

type RuleDraft = {
  enabled: boolean;
  type: DiscountRule['type'];
  minPct: string;
  maxPct: string;
  defaultPct: string;
  minAmount: string;
  maxAmount: string;
  defaultAmount: string;
  staffMaxPct: string;
  staffMaxAmount: string;
  requiresApproval: boolean;
  startsOn: string;
  endsOn: string;
  note: string;
};
const text = (value: number | null | undefined) => (value === null || value === undefined ? '' : String(value));
const ruleDraft = (rule?: DiscountRule): RuleDraft => ({
  enabled: rule?.enabled ?? true,
  type: rule?.type ?? 'percentage',
  minPct: text(rule?.minPct ?? 0),
  maxPct: text(rule?.maxPct ?? 10),
  defaultPct: text(rule?.defaultPct ?? 0),
  minAmount: text(rule?.minAmount ?? 0),
  maxAmount: text(rule?.maxAmount),
  defaultAmount: text(rule?.defaultAmount ?? 0),
  staffMaxPct: text(rule?.staffMaxPct),
  staffMaxAmount: text(rule?.staffMaxAmount),
  requiresApproval: rule?.requiresApproval ?? false,
  startsOn: rule?.startsOn ?? '',
  endsOn: rule?.endsOn ?? '',
  note: rule?.note ?? '',
});

function RuleDrawer({ editing, onClose, onSaved }: { editing: { target: Target; rule?: DiscountRule } | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [draft, setDraft] = useState<RuleDraft>(ruleDraft());
  const [failure, setFailure] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState<typeof editing>(null);
  if (editing !== shown) {
    setShown(editing);
    if (editing) {
      setDraft(ruleDraft(editing.rule));
      setFailure(null);
    }
  }
  const set = <K extends keyof RuleDraft>(key: K, value: RuleDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const fieldError = (key: string) => (failure?.field === key ? failure.message : null);
  const num = (value: string, fallback: number) => (value.trim() === '' ? fallback : parseMoney(value));
  const optional = (value: string) => (value.trim() === '' ? null : parseMoney(value));
  const target = editing?.target;
  const percent = draft.type !== 'amount';
  const rupees = draft.type !== 'percentage';

  const save = async () => {
    if (!target) return;
    const body = {
      scope: target.scope,
      categoryId: target.categoryId,
      productId: target.productId,
      option: target.option,
      enabled: draft.enabled,
      type: draft.type,
      minPct: num(draft.minPct, 0),
      maxPct: num(draft.maxPct, 100),
      defaultPct: num(draft.defaultPct, 0),
      minAmount: num(draft.minAmount, 0),
      maxAmount: optional(draft.maxAmount),
      defaultAmount: num(draft.defaultAmount, 0),
      staffMaxPct: optional(draft.staffMaxPct),
      staffMaxAmount: optional(draft.staffMaxAmount),
      requiresApproval: draft.requiresApproval,
      startsOn: draft.startsOn || null,
      endsOn: draft.endsOn || null,
      note: draft.note.trim(),
    };
    const bad = Object.entries(body).find(([, value]) => typeof value === 'number' && Number.isNaN(value));
    if (bad) return setFailure(new ApiError('Enter a number.', bad[0]));
    setBusy(true);
    setFailure(null);
    try {
      await api('/discounts/rules', 'PUT', body);
      await api('/activity', 'POST', { area: 'settings', summary: `${editing?.rule ? 'Changed' : 'Set'} the discount rule for ${target.label}`, to: '/billing/discounts' }).catch(() => null);
      toast({ message: `Discount rule for ${target.label} saved.` });
      onSaved();
    } catch (problem) {
      setFailure(problem instanceof ApiError ? problem : new ApiError('Couldn’t save it.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      open={editing !== null}
      title={target ? `Discount rule: ${target.label}` : 'Discount rule'}
      description={target?.scope === 'product' ? 'Comes before the category’s rule while product overrides are on.' : target?.scope === 'default' ? 'For items whose category has no rule.' : 'For every product in this category without its own override.'}
      dirty={JSON.stringify(draft) !== JSON.stringify(ruleDraft(editing?.rule))}
      onClose={onClose}
      onSubmit={() => void save()}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={busy}>
            Save Rule
          </Button>
        </>
      }
    >
      <div className="stack">
        <Switch label="Discounts allowed" description={draft.enabled ? 'Within the range below.' : 'No discount at all on these items (bill discounts included).'} checked={draft.enabled} onChange={(on) => set('enabled', on)} />
        {draft.enabled && (
          <>
            <div className="field">
              <span className="field__label">Discount type</span>
              <Segmented<DiscountRule['type']>
                label="Discount type"
                value={draft.type}
                onChange={(value) => set('type', value)}
                options={[
                  { value: 'percentage', label: 'Percentage' },
                  { value: 'amount', label: 'Fixed ₹' },
                  { value: 'both', label: 'Either' },
                ]}
              />
              <p className="field__hint">{draft.type === 'amount' ? 'Rupees off each unit, before GST.' : draft.type === 'both' ? 'A % or ₹ off: the whole discount is checked as a % of the line.' : 'A % off the line, before GST.'}</p>
            </div>
            {percent && (
              <div className="form-grid form-grid--3">
                <TextField label="Minimum" suffix="%" inputMode="decimal" value={draft.minPct} onChange={(event) => set('minPct', event.target.value)} error={fieldError('minPct')} />
                <TextField label="Maximum" suffix="%" inputMode="decimal" value={draft.maxPct} onChange={(event) => set('maxPct', event.target.value)} error={fieldError('maxPct')} />
                <TextField label="Suggested" suffix="%" inputMode="decimal" value={draft.defaultPct} onChange={(event) => set('defaultPct', event.target.value)} error={fieldError('defaultPct')} hint="New lines start with it." />
              </div>
            )}
            {draft.type === 'amount' && (
              <div className="form-grid form-grid--3">
                <TextField label="Minimum" prefix="₹" inputMode="decimal" value={draft.minAmount} onChange={(event) => set('minAmount', event.target.value)} error={fieldError('minAmount')} />
                <TextField label="Maximum" prefix="₹" inputMode="decimal" value={draft.maxAmount} onChange={(event) => set('maxAmount', event.target.value)} error={fieldError('maxAmount')} hint="Empty: no limit." />
                <TextField label="Suggested" prefix="₹" inputMode="decimal" value={draft.defaultAmount} onChange={(event) => set('defaultAmount', event.target.value)} error={fieldError('defaultAmount')} />
              </div>
            )}
            <div className="form-grid">
              {percent ? (
                <TextField label="Billing staff may give up to" suffix="%" inputMode="decimal" value={draft.staffMaxPct} onChange={(event) => set('staffMaxPct', event.target.value)} error={fieldError('staffMaxPct')} hint="Empty: up to the maximum. More needs approval." />
              ) : (
                <TextField label="Billing staff may give up to" prefix="₹" inputMode="decimal" value={draft.staffMaxAmount} onChange={(event) => set('staffMaxAmount', event.target.value)} error={fieldError('staffMaxAmount')} hint="Per unit. Empty: up to the maximum." />
              )}
              {rupees && percent && <p className="field__hint" style={{ alignSelf: 'end' }}>A ₹ discount counts as the % it makes of the line.</p>}
            </div>
            <Switch
              label="Billing staff need approval above the suggested discount"
              description="Stricter than the staff limit: anything above the suggested discount waits for an Owner or discount admin."
              checked={draft.requiresApproval}
              onChange={(on) => set('requiresApproval', on)}
            />
          </>
        )}
        <div className="form-grid">
          <TextField label="Starts" type="date" value={draft.startsOn} onChange={(event) => set('startsOn', event.target.value)} hint="Empty: from now." />
          <TextField label="Ends" type="date" min={draft.startsOn || undefined} value={draft.endsOn} onChange={(event) => set('endsOn', event.target.value)} error={fieldError('endsOn')} hint="Empty: no end." />
        </div>
        <TextField label="Note" value={draft.note} onChange={(event) => set('note', event.target.value)} maxLength={300} placeholder="e.g. Diwali offer" />
        {failure && !failure.field && (
          <p className="notice notice--warning" role="alert" style={{ margin: 0 }}>
            {failure.message}
          </p>
        )}
      </div>
    </Drawer>
  );
}

/** Who may give how much: discount admins approve; managers give up to their own limit; billing staff up to each rule's. */
function StaffLevels() {
  const toast = useToast();
  const [staff, setStaff] = useState<StaffLevel[] | null>(null);
  const [editing, setEditing] = useState<StaffLevel | null>(null);
  const [level, setLevel] = useState<StaffLevel['level']>('staff');
  const [limit, setLimit] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ApiError | null>(null);
  useEffect(() => {
    let active = true;
    api<StaffLevel[]>('/discounts/staff').then(
      (loaded) => active && setStaff(loaded),
      () => active && setStaff([]),
    );
    return () => {
      active = false;
    };
  }, []);
  const open = (member: StaffLevel) => {
    setEditing(member);
    setLevel(member.level);
    setLimit(text(member.limitPct));
    setFailure(null);
  };
  const save = async () => {
    if (!editing) return;
    const limitPct = level === 'manager' && limit.trim() ? parseMoney(limit) : null;
    if (Number.isNaN(limitPct)) return setFailure(new ApiError('Enter a percentage.', 'limitPct'));
    setBusy(true);
    try {
      const saved = await api<{ id: number; level: StaffLevel['level']; limitPct: number | null }>(`/discounts/staff/${editing.id}`, 'PUT', { level, limitPct });
      setStaff((current) => (current ?? []).map((member) => (member.id === saved.id ? { ...member, level: saved.level, limitPct: saved.limitPct } : member)));
      await api('/activity', 'POST', { area: 'settings', summary: `Made ${editing.name} ${DISCOUNT_LEVEL[saved.level].label.toLowerCase()} for discounts`, to: '/billing/discounts' }).catch(() => null);
      toast({ message: `${editing.name}: ${DISCOUNT_LEVEL[saved.level].label}.` });
      setEditing(null);
    } catch (problem) {
      setFailure(problem instanceof ApiError ? problem : new ApiError('Couldn’t save it.'));
    } finally {
      setBusy(false);
    }
  };
  const billers = (staff ?? []).filter((member) => member.role === 'sales' || member.role === 'accountant');
  return (
    <Card aria-labelledby="levels-title">
      <CardHeader id="levels-title" title="Who may give discounts" description="Owners give any discount within a rule and approve requests. Set each staff member’s level here." />
      {staff === null ? (
        <div className="card__body muted">Loading…</div>
      ) : billers.length ? (
        <ul className="list">
          {billers.map((member) => (
            <li key={member.id} className="list-row">
              <div style={{ flex: 1, minWidth: 0 }}>
                <span className="list-row__title">
                  {member.name}
                  {!member.active && <span className="muted"> (inactive)</span>}
                </span>
                <div className="cell-sub">
                  {ROLE_LABEL[member.role] ?? member.role} · {DISCOUNT_LEVEL[member.level].label}
                  {member.level === 'manager' && member.limitPct !== null && `, up to ${member.limitPct}%`}
                </div>
              </div>
              <Button size="sm" icon={PencilSimpleIcon} onClick={() => open(member)}>
                Change
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="card__body muted">No Sales or Accountant staff yet. Add them under Staff.</div>
      )}
      <Drawer
        open={editing !== null}
        title={editing ? `${editing.name}’s discounts` : 'Discounts'}
        description="Applies from their next bill."
        dirty={editing !== null && (level !== editing.level || limit !== text(editing.limitPct))}
        onClose={() => setEditing(null)}
        onSubmit={() => void save()}
        footer={
          <>
            <Button onClick={() => setEditing(null)}>Cancel</Button>
            <Button type="submit" variant="primary" loading={busy}>
              Save
            </Button>
          </>
        }
      >
        <div className="stack">
          <SelectField
            label="Level"
            value={level}
            onChange={(event) => setLevel(event.target.value as StaffLevel['level'])}
            options={(['admin', 'manager', 'staff'] as const).map((value) => ({ value, label: DISCOUNT_LEVEL[value].label }))}
            hint={DISCOUNT_LEVEL[level].description}
          />
          {level === 'manager' && (
            <TextField label="Their own limit" suffix="%" inputMode="decimal" value={limit} onChange={(event) => setLimit(event.target.value)} error={failure?.field === 'limitPct' ? failure.message : null} hint="Never above a rule’s maximum. Empty: each rule’s staff limit." />
          )}
          {failure && !failure.field && <p className="field__error">{failure.message}</p>}
        </div>
      </Drawer>
    </Card>
  );
}
