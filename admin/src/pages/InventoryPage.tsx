import { ArrowCounterClockwiseIcon, ChatCircleTextIcon, NoteIcon, PackageIcon, PhoneIcon, PrinterIcon, TruckIcon, WarehouseIcon } from '@phosphor-icons/react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';

import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { SearchInput, Segmented, TextAreaField } from '@/components/Field';
import { PageHeader } from '@/components/PageHeader';
import { useToast } from '@/components/useToast';
import { INVENTORY_LABEL, INVENTORY_STAGES, ORDER_STATUS, itemCount, whatsappLink, type InventoryStage } from '@/data/orders';
import { readSession } from '@/data/session';
import { useData } from '@/data/useData';
import type { Order, OrderStatus } from '@/data/types';
import { formatDateTime, formatNumber, formatRelativeTime, plural, relativePhrase } from '@/lib/format';

type Tab = InventoryStage | 'delivered';
const TABS: Tab[] = [...INVENTORY_STAGES, 'delivered'];
const TAB_LABEL: Record<Tab, string> = { ...INVENTORY_LABEL, delivered: 'Delivered' };
/** What happened when the order reached this tab, e.g. “Confirmed 2 hours ago”. */
const REACHED: Record<Tab, string> = { confirmed: 'Confirmed', packed: 'Packed', dispatched: 'Dispatched', delivered: 'Delivered' };
const EMPTY: Record<Tab, string> = {
  confirmed: 'Nothing to pack. Orders appear here as soon as they’re confirmed, in the admin or by the customer in the app.',
  packed: 'No packed orders waiting to go out.',
  dispatched: 'No orders on the way.',
  delivered: 'No delivered orders yet.',
};

/** When the order reached its current status: the last time it was set. */
const since = (order: Order) => order.history.findLast((event) => event.status === order.status)?.at ?? order.createdAt;

/**
 * The inventory team's panel: confirmed orders to pack (Pending), packed orders to dispatch, and what's on the way.
 * Every change is saved as the order's status, so the office sees it in Orders, and the customer in their app.
 */
export default function InventoryPage() {
  const { db, update } = useData();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const [printing, setPrinting] = useState<string | null>(null);
  const tab: Tab = (TABS as string[]).includes(params.get('stage') ?? '') ? (params.get('stage') as Tab) : 'confirmed';
  const office = readSession()?.role !== 'inventory';

  const counts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const order of db.orders) map[order.status] = (map[order.status] ?? 0) + 1;
    return map;
  }, [db.orders]);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const digits = needle.replace(/\D/g, '');
    const shown = db.orders.filter(
      (order) =>
        order.status === tab &&
        (!needle ||
          [order.number, order.customer, order.notes ?? '', ...order.lines.flatMap((line) => [line.code, line.name, line.optionCode ?? ''])].some((field) => field.toLowerCase().includes(needle)) ||
          (digits.length >= 4 && (order.phone ?? '').replace(/\D/g, '').includes(digits))),
    );
    // Oldest first while there's work to do, so nothing waits behind newer orders; newest first once it's gone out.
    const work = tab === 'confirmed' || tab === 'packed';
    return shown.sort((a, b) => (work ? since(a).localeCompare(since(b)) : since(b).localeCompare(since(a))));
  }, [db.orders, tab, query]);

  // Print only the chosen order's packing slip.
  useEffect(() => {
    if (!printing) return;
    const done = () => setPrinting(null);
    window.addEventListener('afterprint', done, { once: true });
    window.print();
    return () => window.removeEventListener('afterprint', done);
  }, [printing]);

  const move = async (order: Order, to: OrderStatus) => {
    const from = order.status;
    const at = new Date().toISOString();
    const by = readSession()?.name ?? 'Inventory';
    const label = (status: OrderStatus) => ((INVENTORY_LABEL as Record<string, string>)[status] ?? ORDER_STATUS[status].label).toLowerCase();
    const ok = await update(
      'orders',
      (orders) => orders.map((item) => (item.id === order.id ? { ...item, status: to, history: [...item.history, { status: to, at, by }] } : item)),
      { area: 'orders', summary: `Marked ${order.number} ${label(to)}`, to: `/orders/${order.id}` },
    );
    if (!ok) return;
    toast({
      message: `${order.number} marked ${label(to)}.`,
      action: {
        label: 'Undo',
        onAction: () =>
          update('orders', (orders) => orders.map((item) => (item.id === order.id ? { ...item, status: from, history: [...item.history, { status: from, at: new Date().toISOString(), by }] } : item)), {
            area: 'orders',
            summary: `Undid: ${order.number} back to ${label(from)}`,
            to: `/orders/${order.id}`,
          }),
      },
    });
  };

  const saveNote = async (order: Order, text: string) => {
    const ok = await update(
      'orders',
      (orders) => orders.map((item) => (item.id === order.id ? { ...item, inventoryNote: text ? { text, at: new Date().toISOString(), by: readSession()?.name ?? 'Inventory' } : undefined } : item)),
      { area: 'orders', summary: text ? `Updated the inventory note on ${order.number}` : `Removed the inventory note on ${order.number}`, to: `/orders/${order.id}` },
    );
    if (ok) toast({ message: text ? 'Inventory note saved.' : 'Inventory note removed.' });
    return ok;
  };

  const pendingItems = db.orders.filter((order) => order.status === 'confirmed').reduce((sum, order) => sum + itemCount(order), 0);

  return (
    <>
      <PageHeader
        title="Inventory"
        description="Confirmed orders to pack and dispatch. Every change shows in Orders straight away, and in the customer’s app after it syncs."
      />

      <div className="toolbar no-print">
        <Segmented<Tab>
          label="Show orders that are"
          value={tab}
          onChange={(value) => setParams(value === 'confirmed' ? {} : { stage: value }, { replace: true })}
          options={TABS.map((value) => ({ value, label: TAB_LABEL[value], count: counts[value] ?? 0 }))}
        />
        <SearchInput label="Search orders" placeholder="Order, customer, phone or product code" value={query} onChange={setQuery} />
      </div>

      <p className="filter-summary muted no-print" aria-live="polite">
        {plural(rows.length, 'order')}
        {tab === 'confirmed' && rows.length > 0 && ` · ${plural(pendingItems, 'item')} to pack, oldest first`}
      </p>

      {rows.length === 0 ? (
        <Card>
          <EmptyState icon={WarehouseIcon} title={query ? 'No orders match' : `No ${TAB_LABEL[tab].toLowerCase()} orders`}>
            {query ? 'Try a different search.' : EMPTY[tab]}
          </EmptyState>
        </Card>
      ) : (
        <ul className="inventory-list" aria-label={`${TAB_LABEL[tab]} orders`}>
          {rows.map((order) => (
            <li key={order.id} data-print-hidden={printing !== null && printing !== order.id}>
              <InventoryCard order={order} office={office} onMove={(to) => move(order, to)} onSaveNote={(text) => saveNote(order, text)} onPrint={() => setPrinting(order.id)} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function InventoryCard({ order, office, onMove, onSaveNote, onPrint }: { order: Order; office: boolean; onMove: (to: OrderStatus) => void; onSaveNote: (text: string) => Promise<boolean>; onPrint: () => void }) {
  const [draft, setDraft] = useState(order.inventoryNote?.text ?? '');
  const [saved, setSaved] = useState(order.inventoryNote?.text ?? '');
  // Someone else changed the note (the list refreshes every minute): show theirs unless this one is being edited.
  const current = order.inventoryNote?.text ?? '';
  if (current !== saved) {
    setSaved(current);
    if (draft === saved) setDraft(current);
  }
  const dirty = draft.trim() !== current;
  const stage = order.status as Tab;
  const items = itemCount(order);
  const titleId = `inventory-${order.id}`;

  return (
    <Card className="inventory-card" aria-labelledby={titleId}>
      <header className="inventory-card__head">
        <div style={{ minWidth: 0 }}>
          <h2 className="inventory-card__title" id={titleId}>
            {office ? (
              <Link to={`/orders/${order.id}`} className="num">
                {order.number}
              </Link>
            ) : (
              <span className="num">{order.number}</span>
            )}
            <span className="inventory-card__customer">{order.customer}</span>
          </h2>
          <p className="cell-sub" style={{ whiteSpace: 'normal' }}>
            {plural(items, 'item')} · {plural(order.lines.length, 'line')} · {REACHED[stage]} {relativePhrase(formatRelativeTime(since(order)))}
            <span className="print-only-inline"> · {formatDateTime(since(order))}</span>
          </p>
        </div>
        <Badge tone={stage === 'confirmed' ? 'warning' : stage === 'delivered' ? 'success' : 'info'} icon={stage === 'confirmed' ? WarehouseIcon : stage === 'packed' ? PackageIcon : TruckIcon}>
          {TAB_LABEL[stage]}
        </Badge>
      </header>

      <div className="table-scroll">
        <table className="table table--packing">
          <caption className="visually-hidden">Items to pack for order {order.number}</caption>
          <thead>
            <tr>
              <th scope="col">Code</th>
              <th scope="col">Product</th>
              <th scope="col" className="is-num">
                Qty
              </th>
            </tr>
          </thead>
          <tbody>
            {order.lines.map((line, index) => (
              <tr key={`${line.productId}-${index}`}>
                <td className="mono">{line.optionCode ?? line.code}</td>
                <td>
                  {line.name}
                  {line.option && <div className="cell-sub" style={{ whiteSpace: 'normal' }}>{line.option}</div>}
                  {line.note && (
                    <div className="line-note">
                      <NoteIcon size={14} aria-hidden /> {line.note}
                    </div>
                  )}
                </td>
                <td className="is-num inventory-qty">{formatNumber(line.qty)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="inventory-card__body">
        <dl className="kv kv--compact">
          <dt>Deliver to</dt>
          <dd>{order.notes ?? <span className="muted">No delivery notes</span>}</dd>
          <dt>Phone</dt>
          <dd>
            {order.phone ? (
              <span className="row-wrap" style={{ gap: 'var(--space-2)' }}>
                <span className="num">{order.phone}</span>
                <a className="btn btn--secondary btn--sm no-print" href={`tel:${order.phone.replace(/\s/g, '')}`}>
                  <PhoneIcon size={14} weight="bold" aria-hidden /> Call
                </a>
                <a className="btn btn--secondary btn--sm no-print" href={whatsappLink(order.phone)} target="_blank" rel="noreferrer">
                  <ChatCircleTextIcon size={14} weight="bold" aria-hidden /> WhatsApp
                </a>
              </span>
            ) : (
              <span className="muted">Not given</span>
            )}
          </dd>
        </dl>

        <div className="no-print">
          <TextAreaField
            label="Inventory note"
            hint={order.inventoryNote ? `Last edited by ${order.inventoryNote.by}, ${formatDateTime(order.inventoryNote.at)}. The office sees it; the customer doesn’t.` : 'Stock, packing or transport details. The office sees it; the customer doesn’t.'}
            rows={2}
            value={draft}
            maxLength={2000}
            placeholder="e.g. 2 hinges short · VRL Logistics, LR 4471"
            onChange={(event) => setDraft(event.target.value)}
          />
          {dirty && (
            <div className="row" style={{ justifyContent: 'flex-end', marginTop: 'var(--space-2)' }}>
              <Button size="sm" onClick={() => setDraft(current)}>
                Discard
              </Button>
              <Button size="sm" variant="primary" onClick={() => onSaveNote(draft.trim())}>
                Save Note
              </Button>
            </div>
          )}
        </div>
        {order.inventoryNote && <p className="print-only-block">Note: {order.inventoryNote.text}</p>}
      </div>

      <footer className="inventory-card__actions no-print">
        <Button size="sm" variant="plain" icon={PrinterIcon} onClick={onPrint}>
          Print Slip
        </Button>
        <span style={{ flex: 1 }} />
        {stage === 'packed' && (
          <Button size="sm" icon={ArrowCounterClockwiseIcon} onClick={() => onMove('confirmed')}>
            Back to Pending
          </Button>
        )}
        {stage === 'dispatched' && (
          <Button size="sm" icon={ArrowCounterClockwiseIcon} onClick={() => onMove('packed')}>
            Back to Packed
          </Button>
        )}
        {stage === 'confirmed' && (
          <Button size="sm" icon={TruckIcon} onClick={() => onMove('dispatched')}>
            Mark Dispatched
          </Button>
        )}
        {stage === 'confirmed' && (
          <Button size="sm" variant="primary" icon={PackageIcon} onClick={() => onMove('packed')}>
            Mark Packed
          </Button>
        )}
        {stage === 'packed' && (
          <Button size="sm" variant="primary" icon={TruckIcon} onClick={() => onMove('dispatched')}>
            Mark Dispatched
          </Button>
        )}
      </footer>
    </Card>
  );
}
