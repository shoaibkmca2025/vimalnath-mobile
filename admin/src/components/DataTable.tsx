import { CaretDownIcon, CaretLeftIcon, CaretRightIcon, CaretUpDownIcon, CaretUpIcon } from '@phosphor-icons/react';
import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';

import { IconButton } from '@/components/Button';
import { formatNumber } from '@/lib/format';

export type Column<T> = {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** Makes the column sortable. */
  sortValue?: (row: T) => string | number;
  align?: 'num' | 'actions';
  /** Keeps the header for screen readers but hides it visually (e.g. an actions column). */
  hideHeader?: boolean;
};

type Sort = { key: string; direction: 'asc' | 'desc' };

type Props<T> = {
  caption: string;
  rows: T[];
  columns: Column<T>[];
  getRowId: (row: T) => string;
  /** Mouse convenience; keyboard users reach the same place through the link in the row's title cell. */
  onRowClick?: (row: T) => void;
  selectable?: boolean;
  selected?: Set<string>;
  onSelectedChange?: (selected: Set<string>) => void;
  /** Actions for the selected rows, shown in a bar above the table. */
  bulkActions?: (ids: string[]) => ReactNode;
  initialSort?: Sort;
  pageSize?: number;
  /** Change it when the search or filters change to go back to page 1; edits to rows keep the page. */
  resetKey?: string;
  empty: ReactNode;
};

export function DataTable<T>({ caption, rows, columns, getRowId, onRowClick, selectable, selected, onSelectedChange, bulkActions, initialSort, pageSize = 25, resetKey, empty }: Props<T>) {
  const [sort, setSort] = useState<Sort | undefined>(initialSort);
  const [page, setPage] = useState(0);
  const headerCheckbox = useRef<HTMLInputElement>(null);

  const sorted = useMemo(() => {
    const column = columns.find((item) => item.key === sort?.key);
    if (!sort || !column?.sortValue) return rows;
    const value = column.sortValue;
    const factor = sort.direction === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const x = value(a);
      const y = value(b);
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true })) * factor;
    });
  }, [rows, columns, sort]);

  const [lastResetKey, setLastResetKey] = useState(resetKey);
  if (resetKey !== lastResetKey) {
    setLastResetKey(resetKey);
    setPage(0);
  }

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const current = Math.min(page, pageCount - 1);
  const visible = sorted.slice(current * pageSize, current * pageSize + pageSize);
  const visibleIds = visible.map(getRowId);
  const selectedOnPage = selected ? visibleIds.filter((id) => selected.has(id)).length : 0;

  useEffect(() => {
    if (headerCheckbox.current) headerCheckbox.current.indeterminate = selectedOnPage > 0 && selectedOnPage < visibleIds.length;
  }, [selectedOnPage, visibleIds.length]);

  const toggleSort = (key: string) =>
    setSort((previous) => (previous?.key === key ? { key, direction: previous.direction === 'asc' ? 'desc' : 'asc' } : { key, direction: 'asc' }));

  const setRow = (id: string, on: boolean) => {
    if (!selected || !onSelectedChange) return;
    const next = new Set(selected);
    if (on) next.add(id);
    else next.delete(id);
    onSelectedChange(next);
  };

  const setPageRows = (on: boolean) => {
    if (!selected || !onSelectedChange) return;
    const next = new Set(selected);
    for (const id of visibleIds) {
      if (on) next.add(id);
      else next.delete(id);
    }
    onSelectedChange(next);
  };

  const onClickRow = (event: MouseEvent, row: T) => {
    if (!onRowClick) return;
    // Let links, buttons and checkboxes inside the row do their own thing.
    if ((event.target as HTMLElement).closest('a, button, input, select, label, textarea')) return;
    onRowClick(row);
  };

  if (!rows.length) return <>{empty}</>;

  const selectedIds = selected ? [...selected] : [];

  return (
    <>
      {selectable && selectedIds.length > 0 && bulkActions && (
        <div className="bulk-bar" role="region" aria-label="Bulk actions">
          <span>{formatNumber(selectedIds.length)} selected</span>
          <span className="spacer" />
          {bulkActions(selectedIds)}
        </div>
      )}
      <div className="table-scroll">
        <table className="table">
          <caption className="visually-hidden">{caption}</caption>
          <thead>
            <tr>
              {selectable && (
                <th className="is-check" scope="col">
                  <input
                    ref={headerCheckbox}
                    type="checkbox"
                    className="checkbox"
                    aria-label="Select all rows on this page"
                    checked={visibleIds.length > 0 && selectedOnPage === visibleIds.length}
                    onChange={(event) => setPageRows(event.target.checked)}
                  />
                </th>
              )}
              {columns.map((column) => {
                const active = sort?.key === column.key;
                const SortIcon = !active ? CaretUpDownIcon : sort.direction === 'asc' ? CaretUpIcon : CaretDownIcon;
                return (
                  <th
                    key={column.key}
                    scope="col"
                    className={column.align === 'num' ? 'is-num' : column.align === 'actions' ? 'is-actions' : undefined}
                    aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : undefined}
                  >
                    {column.hideHeader ? (
                      <span className="visually-hidden">{column.header}</span>
                    ) : column.sortValue ? (
                      <button type="button" className="sort-btn" onClick={() => toggleSort(column.key)}>
                        {column.header}
                        <SortIcon size={12} weight="bold" aria-hidden />
                      </button>
                    ) : (
                      column.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => {
              const id = getRowId(row);
              const isSelected = selected?.has(id) ?? false;
              return (
                <tr key={id} data-clickable={onRowClick ? 'true' : undefined} aria-selected={selectable ? isSelected : undefined} onClick={(event) => onClickRow(event, row)}>
                  {selectable && (
                    <td className="is-check">
                      <input type="checkbox" className="checkbox" aria-label={`Select row ${id}`} checked={isSelected} onChange={(event) => setRow(id, event.target.checked)} />
                    </td>
                  )}
                  {columns.map((column) => (
                    <td key={column.key} className={column.align === 'num' ? 'is-num' : column.align === 'actions' ? 'is-actions' : undefined}>
                      {column.cell(row)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {pageCount > 1 && (
        <nav className="pagination" aria-label={`${caption} pages`}>
          <span className="num">
            {formatNumber(current * pageSize + 1)}–{formatNumber(Math.min(sorted.length, (current + 1) * pageSize))} of {formatNumber(sorted.length)}
          </span>
          <span className="row">
            <IconButton icon={CaretLeftIcon} label="Previous page" disabled={current === 0} onClick={() => setPage(current - 1)} />
            <span className="num" aria-live="polite">
              Page {current + 1} of {pageCount}
            </span>
            <IconButton icon={CaretRightIcon} label="Next page" disabled={current >= pageCount - 1} onClick={() => setPage(current + 1)} />
          </span>
        </nav>
      )}
    </>
  );
}
