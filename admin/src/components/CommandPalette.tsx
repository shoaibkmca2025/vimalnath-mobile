import { MagnifyingGlassIcon, PackageIcon, ReceiptIcon, UserIcon, type Icon } from '@phosphor-icons/react';
import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router';

import { OrderStatusBadge } from '@/components/Badge';
import { useModal, usePresence } from '@/hooks/useModal';
import { customersFromOrders } from '@/data/orders';
import { productTitle } from '@/data/products';
import { useData } from '@/data/useData';
import type { OrderStatus } from '@/data/types';
import { formatINR, formatRelativeDay } from '@/lib/format';

export type PaletteDestination = { to: string; label: string; icon: Icon; group: string };

type Result = { id: string; to: string; title: string; meta?: string; icon: Icon; group: string; status?: OrderStatus };

const PER_GROUP = 6;

/** Jump to any page, order, customer or product by typing. Opened from the top bar or with ⌘K / Ctrl+K. */
export function CommandPalette({ open, onClose, destinations }: { open: boolean; onClose: () => void; destinations: PaletteDestination[] }) {
  const { mounted, state } = usePresence(open);
  const ref = useRef<HTMLDivElement>(null);
  useModal(ref, open, onClose);
  if (!mounted) return null;
  return createPortal(
    <>
      <div className="overlay-scrim" data-state={state} style={{ zIndex: 'var(--z-dialog)' }} onClick={onClose} aria-hidden />
      <div className="dialog-layer dialog-layer--top">
        <div ref={ref} className="dialog palette" data-state={state} role="dialog" aria-modal="true" aria-label="Search the admin">
          <PaletteBody onClose={onClose} destinations={destinations} />
        </div>
      </div>
    </>,
    document.body,
  );
}

function PaletteBody({ onClose, destinations }: { onClose: () => void; destinations: PaletteDestination[] }) {
  const { db } = useData();
  const navigate = useNavigate();
  const listId = useId();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  const customers = useMemo(() => customersFromOrders(db.orders), [db.orders]);

  const results = useMemo<Result[]>(() => {
    const needle = query.trim().toLowerCase();
    const digits = needle.replace(/\D/g, '');
    const pages = destinations
      .filter((page) => !needle || `${page.label} ${page.group}`.toLowerCase().includes(needle))
      .map((page) => ({ id: `page-${page.to}`, to: page.to, title: page.label, meta: page.group, icon: page.icon, group: 'Pages' }));
    if (!needle) return pages;

    const orders = db.orders
      .filter((order) => order.number.toLowerCase().includes(needle) || order.customer.toLowerCase().includes(needle) || (digits.length >= 4 && (order.phone ?? '').replace(/\D/g, '').includes(digits)))
      .slice(0, PER_GROUP)
      .map((order) => ({
        id: `order-${order.id}`,
        to: `/orders/${order.id}`,
        title: `${order.number} · ${order.customer}`,
        meta: `${formatRelativeDay(order.createdAt)} · ${formatINR(order.total)}`,
        icon: ReceiptIcon,
        group: 'Orders',
        status: order.status,
      }));
    const people = customers
      .filter((customer) => customer.name.toLowerCase().includes(needle) || (digits.length >= 4 && (customer.phone ?? '').replace(/\D/g, '').includes(digits)))
      .slice(0, PER_GROUP)
      .map((customer) => ({ id: `customer-${customer.key}`, to: `/customers/${customer.key}`, title: customer.name, meta: customer.phone ?? 'No phone', icon: UserIcon, group: 'Customers' }));
    const products = db.products
      .filter((product) => product.code.toLowerCase().includes(needle) || productTitle(product).toLowerCase().includes(needle))
      .slice(0, PER_GROUP)
      .map((product) => ({ id: `product-${product.id}`, to: `/products/${product.id}`, title: productTitle(product), meta: product.code, icon: PackageIcon, group: 'Products' }));
    return [...pages.slice(0, 4), ...orders, ...people, ...products];
  }, [query, destinations, db.orders, db.products, customers]);

  const [lastQuery, setLastQuery] = useState(query);
  if (lastQuery !== query) {
    setLastQuery(query);
    setActive(0);
  }

  const go = (result: Result | undefined) => {
    if (!result) return;
    onClose();
    navigate(result.to);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((current) => (results.length ? (current + step + results.length) % results.length : 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      go(results[active]);
    }
  };

  const activeId = results[active] ? `${listId}-${results[active].id}` : undefined;

  return (
    <>
      <div className="palette__search">
        <MagnifyingGlassIcon size={18} aria-hidden />
        <input
          className="palette__input"
          data-autofocus
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={activeId}
          aria-autocomplete="list"
          aria-label="Search pages, orders, customers and products"
          placeholder="Search pages, orders, customers, products…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
          autoComplete="off"
          spellCheck={false}
        />
        <kbd className="kbd">Esc</kbd>
      </div>
      <ul className="palette__list" id={listId} role="listbox" aria-label="Results">
        {results.map((result, index) => {
          const ResultIcon = result.icon;
          const newGroup = index === 0 || results[index - 1]!.group !== result.group;
          return (
            <li key={result.id} role="presentation">
              {newGroup && (
                <p className="palette__group" aria-hidden>
                  {result.group}
                </p>
              )}
              <div
                id={`${listId}-${result.id}`}
                role="option"
                aria-selected={index === active}
                className="palette__item"
                onPointerMove={() => setActive(index)}
                onClick={() => go(result)}
              >
                <ResultIcon size={18} aria-hidden />
                <span className="palette__title">{result.title}</span>
                {result.status && <OrderStatusBadge status={result.status} />}
                {result.meta && <span className="palette__meta">{result.meta}</span>}
              </div>
            </li>
          );
        })}
        {!results.length && <li className="palette__empty">Nothing matches “{query}”.</li>}
      </ul>
    </>
  );
}
