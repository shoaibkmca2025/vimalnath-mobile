import { BellIcon, CaretRightIcon, CheckCircleIcon, PaperPlaneTiltIcon } from '@phosphor-icons/react';
import { useEffect, useId, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router';

import { OrderStatusBadge } from '@/components/Badge';
import { CATEGORY_LABEL, fetchInbox, readInbox, sinceLabel, type InboxItem } from '@/data/inbox';
import type { Order } from '@/data/types';

/** VSC-0042 → 42, so the list runs VSC-0001, VSC-0002 … */
const orderNumber = (order: Order) => Number(order.number.replace(/\D/g, '')) || 0;

type Tab = 'notifications' | 'orders';

/**
 * The bell in the top-right corner. Its red count is this person's unread notifications (new orders, payments, stock
 * alerts, approvals, announcements…); the panel lists the newest, each opening what it's about, beside the orders not
 * delivered yet (each leaves once it's delivered or cancelled) and new replies to order requests.
 */
export function NotificationBell({ orders, linkTo, requestUpdates = 0, unread = 0 }: { orders: Order[]; linkTo: (order: Order) => string; requestUpdates?: number; unread?: number }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('notifications');
  const [items, setItems] = useState<InboxItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const panelId = useId();
  const root = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const total = orders.length;
  const sorted = [...orders].sort((a, b) => orderNumber(a) - orderNumber(b));

  // A new page closes it.
  const [path, setPath] = useState(location.pathname + location.search);
  if (path !== location.pathname + location.search) {
    setPath(location.pathname + location.search);
    setOpen(false);
  }

  // The newest notifications, fetched each time the panel opens (and when the count changes while it's open).
  useEffect(() => {
    if (!open) return;
    let active = true;
    fetchInbox({ limit: 8 }).then(
      (page) => {
        if (!active) return;
        setItems(page.notifications);
        setFailed(false);
      },
      () => active && setFailed(true),
    );
    return () => {
      active = false;
    };
  }, [open, unread]);

  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLElement>('.bell-panel [role="tab"][aria-selected="true"]')?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        root.current?.querySelector<HTMLElement>('.bell')?.focus();
      }
    };
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onPointer);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);

  const openItem = (item: InboxItem) => {
    if (!item.read) void readInbox([item.id]).catch(() => {});
    setOpen(false);
  };

  return (
    <div className="bell-wrap" ref={root}>
      <button
        type="button"
        className="bell"
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications, nothing unread'}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        <BellIcon size={18} weight={unread ? 'fill' : 'regular'} aria-hidden />
        {unread > 0 && (
          <span className="alert-badge num" aria-hidden>
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="bell-panel" id={panelId} role="region" aria-label="Notifications">
          <div className="bell-tabs" role="tablist" aria-label="Show">
            <button type="button" role="tab" aria-selected={tab === 'notifications'} className="bell-tab" onClick={() => setTab('notifications')}>
              Notifications
              {unread > 0 && <span className="bell-panel__count num">{unread}</span>}
            </button>
            <button type="button" role="tab" aria-selected={tab === 'orders'} className="bell-tab" onClick={() => setTab('orders')}>
              Not delivered
              {total > 0 && <span className="bell-panel__count bell-panel__count--plain num">{total}</span>}
            </button>
          </div>

          {tab === 'notifications' ? (
            <>
              {failed ? (
                <p className="bell-panel__empty">Couldn’t load notifications.</p>
              ) : items === null ? (
                <p className="bell-panel__empty">Loading…</p>
              ) : items.length === 0 ? (
                <p className="bell-panel__empty">
                  <CheckCircleIcon size={18} aria-hidden /> Nothing yet. New orders, payments and alerts appear here.
                </p>
              ) : (
                <ul className="bell-panel__list">
                  {items.map((item) => (
                    <li key={item.id}>
                      <Link to={item.data.to ?? '/inbox'} className={`bell-panel__item${item.read ? '' : ' is-unread'}`} onClick={() => openItem(item)}>
                        <span className={item.read ? 'bell-panel__dot bell-panel__dot--read' : 'bell-panel__dot'} aria-hidden />
                        <span className="bell-panel__text">
                          <span className="bell-panel__label">
                            {!item.read && <span className="visually-hidden">Unread: </span>}
                            {item.title}
                          </span>
                          <span className="bell-panel__detail">
                            {CATEGORY_LABEL[item.category]} · {sinceLabel(item.createdAt)}
                          </span>
                        </span>
                        <CaretRightIcon size={14} aria-hidden />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              <div className="bell-panel__foot">
                {unread > 0 && (
                  <button type="button" className="btn btn--plain btn--sm" onClick={() => void readInbox().then(() => setItems((current) => current?.map((item) => ({ ...item, read: true })) ?? null))}>
                    Mark all read
                  </button>
                )}
                <Link to="/inbox" className="btn btn--secondary btn--sm" onClick={() => setOpen(false)}>
                  See all
                </Link>
              </div>
            </>
          ) : (
            <>
              <ul className="bell-panel__list">
                {requestUpdates > 0 && (
                  <li>
                    <Link to="/order-requests" className="bell-panel__item" onClick={() => setOpen(false)}>
                      <PaperPlaneTiltIcon size={16} className="bell-panel__icon" aria-hidden />
                      <span className="bell-panel__text">
                        <span className="bell-panel__label">
                          {requestUpdates === 1 ? '1 new reply' : `${requestUpdates} new replies`} to order requests
                        </span>
                      </span>
                      <CaretRightIcon size={14} aria-hidden />
                    </Link>
                  </li>
                )}
                {sorted.map((order) => (
                  <li key={order.id}>
                    <Link to={linkTo(order)} className="bell-panel__item" onClick={() => setOpen(false)}>
                      <span className="bell-panel__dot" aria-hidden />
                      <span className="bell-panel__text">
                        <span className="bell-panel__label num">{order.number}</span>
                        <span className="bell-panel__detail">{order.customer}</span>
                      </span>
                      <OrderStatusBadge status={order.status} />
                      <CaretRightIcon size={14} aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
              {total === 0 && requestUpdates === 0 && (
                <p className="bell-panel__empty">
                  <CheckCircleIcon size={18} aria-hidden /> Every order is delivered.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
