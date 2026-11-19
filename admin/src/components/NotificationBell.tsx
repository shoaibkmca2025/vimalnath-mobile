import { BellIcon, CaretRightIcon, CheckCircleIcon, PaperPlaneTiltIcon } from '@phosphor-icons/react';
import { useEffect, useId, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router';

import { OrderStatusBadge } from '@/components/Badge';
import type { Order } from '@/data/types';

/** VSC-0042 → 42, so the list runs VSC-0001, VSC-0002 … */
const orderNumber = (order: Order) => Number(order.number.replace(/\D/g, '')) || 0;

/**
 * The bell in the top-right corner: a red count of orders not delivered yet, and the list of them, each opening its
 * order. An order leaves the list (and the count) once it's delivered or cancelled. New replies to order requests
 * show as one line at the top.
 */
export function NotificationBell({ orders, linkTo, requestUpdates = 0 }: { orders: Order[]; linkTo: (order: Order) => string; requestUpdates?: number }) {
  const [open, setOpen] = useState(false);
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

  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLElement>('.bell-panel a')?.focus();
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

  return (
    <div className="bell-wrap" ref={root}>
      <button
        type="button"
        className="bell"
        aria-label={total ? `Notifications, ${total} ${total === 1 ? 'order' : 'orders'} not delivered yet` : 'Notifications, every order delivered'}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        <BellIcon size={18} weight={total ? 'fill' : 'regular'} aria-hidden />
        {total > 0 && (
          <span className="alert-badge num" aria-hidden>
            {total > 99 ? '99+' : total}
          </span>
        )}
      </button>

      {open && (
        <div className="bell-panel" id={panelId} role="region" aria-label="Orders not delivered yet">
          <p className="bell-panel__title">
            Not delivered yet
            {total > 0 && <span className="bell-panel__count num">{total}</span>}
          </p>
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
        </div>
      )}
    </div>
  );
}
