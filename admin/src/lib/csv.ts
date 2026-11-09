type Cell = string | number | undefined | null;

// Excel runs a cell starting with = + - or @ as a formula, and customer names are typed in the app.
// A plain phone number ("+91 90000 10231") is left as it is.
const FORMULA = /^[=@\t\r]|^[+-](?![\d\s]+$)/;

const escape = (value: Cell) => {
  const raw = value === undefined || value === null ? '' : String(value);
  const text = typeof value === 'string' && FORMULA.test(raw) ? `'${raw}` : raw;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/** Saves rows as a CSV that opens in Excel with Indian rupee symbols intact (UTF-8 with a BOM). */
export function downloadCsv(fileName: string, header: string[], rows: Cell[][]) {
  const text = [header, ...rows].map((row) => row.map(escape).join(',')).join('\r\n');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob(['﻿', text], { type: 'text/csv;charset=utf-8' }));
  link.download = `${fileName}-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}
