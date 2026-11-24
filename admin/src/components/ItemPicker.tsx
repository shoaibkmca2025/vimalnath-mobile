import { MagnifyingGlassIcon } from '@phosphor-icons/react';
import { useState, type KeyboardEvent } from 'react';

import { UNITS, formatQty, type StockRow } from '@/data/stock';

/** Search the catalogue by name, code, SKU or a scanned barcode, and pick an item; Enter takes an exact match. */
export function ItemPicker({ id, rows, onPick, placeholder = 'Add an item: name, code, SKU, or scan a barcode' }: { id: string; rows: StockRow[]; onPick: (row: StockRow) => void; placeholder?: string }) {
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const exact = needle ? rows.find((row) => [row.stock?.barcode, row.stock?.sku, row.code].some((text) => text && text.toLowerCase() === needle)) : undefined;
  const matches =
    needle.length >= 2
      ? rows.filter((row) => [row.title, row.code, row.stock?.sku, row.stock?.barcode, row.stock?.brand].some((text) => text?.toLowerCase().includes(needle))).slice(0, 8)
      : [];
  const pick = (row: StockRow) => {
    onPick(row);
    setQuery('');
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const choice = exact ?? (matches.length === 1 ? matches[0] : undefined);
    if (choice) pick(choice);
  };

  return (
    <div className="item-picker">
      <div className="search" role="search">
        <MagnifyingGlassIcon size={16} aria-hidden />
        <input
          id={id}
          type="search"
          className="input"
          aria-label="Add an item"
          placeholder={placeholder}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      {needle.length >= 2 && (
        <ul className="item-picker__list" aria-label="Matching items">
          {matches.length ? (
            matches.map((row) => (
              <li key={row.key}>
                <button type="button" className="item-picker__option" onClick={() => pick(row)}>
                  <span style={{ minWidth: 0 }}>
                    <span className="cell-title" style={{ display: 'block', whiteSpace: 'normal' }}>
                      {row.title}
                    </span>
                    <span className="cell-sub mono">{[row.code, row.stock?.sku].filter(Boolean).join(' · ')}</span>
                  </span>
                  <span className="cell-sub num" style={{ flexShrink: 0 }}>
                    {row.stock ? `${formatQty(row.stock.quantity)} ${UNITS[row.stock.unit]} in stock` : 'Not counted yet'}
                  </span>
                </button>
              </li>
            ))
          ) : (
            <li className="muted" style={{ padding: 'var(--space-3)' }}>
              No item matches “{query.trim()}”.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
