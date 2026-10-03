import type { LengthUnit } from '@/lib/length-units';

/** Lengths are whole millimetres, or whole sixteenths of an inch when the plan's unit is inches. */
export type Piece = { length: number; qty: number };
export type BarStock = { length: number; qty?: number };
export type Bar = { length: number; used: number; pieces: number[] };

export type BarPlan = {
  /** Missing on plans saved before inches were supported, which are all millimetres. */
  unit?: LengthUnit;
  bars: Bar[];
  kerf: number;
  totalMaterial: number;
  waste: number;
  utilization: number;
  cuts: number;
};

/**
 * Best-fit decreasing: place the longest pieces first, each into the open bar that leaves the
 * least room once it's added (minimizing wastage), falling back to a new bar only when no open
 * bar has room. A new bar picks the shortest available stock length that fits the piece and still
 * has quantity left (a stock entry with no quantity is treated as unlimited). Cutting loss (kerf)
 * is charged between neighbouring pieces on the same bar.
 */
export function calculateBars(pieces: Piece[], stock: BarStock[], kerf: number): Bar[] {
  const lengths = pieces
    .flatMap((piece) => Array.from({ length: piece.qty }, () => piece.length))
    .sort((a, b) => b - a);

  // null means unlimited; entries that share a length pool their quantity together.
  const remaining = new Map<number, number | null>();
  for (const entry of stock) {
    const cap = entry.qty && entry.qty > 0 ? entry.qty : null;
    const current = remaining.get(entry.length);
    if (current === undefined) remaining.set(entry.length, cap);
    else remaining.set(entry.length, current === null || cap === null ? null : current + cap);
  }
  const sortedStock = [...remaining.keys()].sort((a, b) => a - b);

  // Small jobs (e.g. one window's verticals) are solved exactly; the heuristic below can pick a
  // poor mix of stock lengths, like four 2450 mm bars where two 3000 mm bars would do.
  if (lengths.length <= EXACT_MAX_PIECES && sortedStock.length <= EXACT_MAX_STOCK_LENGTHS) {
    const exact = exactBars(lengths, sortedStock, remaining, kerf);
    if (exact) return exact;
  }

  const bars: Bar[] = [];
  for (const length of lengths) {
    // Every open bar already holds a piece, so adding another always costs one kerf.
    let bestBar: Bar | null = null;
    let bestLeftover = Infinity;
    for (const candidate of bars) {
      const leftover = candidate.length - (candidate.used + kerf + length);
      if (leftover >= 0 && leftover < bestLeftover) {
        bestBar = candidate;
        bestLeftover = leftover;
      }
    }
    if (bestBar) {
      bestBar.used += kerf + length;
      bestBar.pieces.push(length);
      continue;
    }
    const chosen = sortedStock.find((candidate) => length <= candidate && remaining.get(candidate) !== 0);
    if (chosen === undefined) throw new Error(`Not enough standard bar stock left for a ${length} mm piece.`);
    const left = remaining.get(chosen)!;
    if (left !== null) remaining.set(chosen, left - 1);
    bars.push({ length: chosen, used: length, pieces: [length] });
  }
  return bars;
}

const EXACT_MAX_PIECES = 12;
const EXACT_MAX_STOCK_LENGTHS = 3;

/**
 * Tries every mix of stock bars in order of total length (then fewest bars) and returns the first
 * mix the pieces can actually be packed into, i.e. the one with the least material bought.
 * `lengths` must be sorted longest first. Returns null if no mix within the stock limits works.
 */
function exactBars(lengths: number[], stockLengths: number[], caps: Map<number, number | null>, kerf: number): Bar[] | null {
  const n = lengths.length;
  const combos: number[][] = [];
  const build = (index: number, counts: number[], barsSoFar: number) => {
    if (index === stockLengths.length) {
      if (barsSoFar > 0) combos.push([...counts]);
      return;
    }
    const cap = caps.get(stockLengths[index]);
    const max = Math.min(n - barsSoFar, cap ?? Infinity);
    for (let count = 0; count <= max; count++) {
      counts.push(count);
      build(index + 1, counts, barsSoFar + count);
      counts.pop();
    }
  };
  build(0, [], 0);

  const total = (counts: number[]) => counts.reduce((sum, count, i) => sum + count * stockLengths[i], 0);
  const barCount = (counts: number[]) => counts.reduce((sum, count) => sum + count, 0);
  combos.sort((a, b) => total(a) - total(b) || barCount(a) - barCount(b));

  const pieceTotal = lengths.reduce((sum, length) => sum + length, 0);
  for (const counts of combos) {
    if (total(counts) < pieceTotal) continue;
    const bars: Bar[] = counts
      .flatMap((count, i) => Array.from({ length: count }, () => stockLengths[i]))
      .sort((a, b) => b - a)
      .map((length) => ({ length, used: 0, pieces: [] }));
    if (lengths[0] > bars[0].length) continue;
    if (packInto(lengths, 0, bars, kerf)) return bars.filter((bar) => bar.pieces.length > 0);
  }
  return null;
}

/** Depth-first placement of lengths[index…] into the given bars; mutates the bars on success. */
function packInto(lengths: number[], index: number, bars: Bar[], kerf: number): boolean {
  if (index === lengths.length) return true;
  const length = lengths[index];
  const tried = new Set<string>();
  for (const bar of bars) {
    const extra = bar.pieces.length ? kerf + length : length;
    if (bar.used + extra > bar.length) continue;
    // Bars in the same state are interchangeable; trying one of them is enough.
    const state = `${bar.length}:${bar.used}`;
    if (tried.has(state)) continue;
    tried.add(state);
    bar.used += extra;
    bar.pieces.push(length);
    if (packInto(lengths, index + 1, bars, kerf)) return true;
    bar.pieces.pop();
    bar.used -= extra;
  }
  return false;
}

export function summarizePlan(bars: Bar[], kerf: number, unit: LengthUnit = 'mm'): BarPlan {
  const totalMaterial = bars.reduce((sum, bar) => sum + bar.length, 0);
  const used = bars.reduce((sum, bar) => sum + bar.used, 0);
  return {
    unit,
    bars,
    kerf,
    totalMaterial,
    waste: Math.max(0, totalMaterial - used),
    utilization: totalMaterial ? (used / totalMaterial) * 100 : 0,
    cuts: bars.reduce((sum, bar) => sum + bar.pieces.length, 0),
  };
}

export type PlanRequest = { pieces: Piece[]; stock: BarStock[]; kerf: number; unit?: LengthUnit };

export function planBars({ pieces, stock, kerf, unit = 'mm' }: PlanRequest): { plan: BarPlan } | { error: string } {
  const validPieces = pieces.filter((piece) => piece.length > 0 && piece.qty > 0);
  const validStock = stock.filter((entry) => entry.length > 0 && (entry.qty === undefined || entry.qty > 0));
  if (!validPieces.length) return { error: 'Add at least one piece length first.' };
  if (!validStock.length) return { error: 'Add at least one standard bar length.' };
  const longestStock = Math.max(...validStock.map((entry) => entry.length));
  if (validPieces.some((piece) => piece.length > longestStock)) return { error: 'A piece cannot be longer than the longest standard bar.' };
  try {
    const bars = calculateBars(validPieces, validStock, kerf);
    return { plan: summarizePlan(bars, kerf, unit) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not fit the pieces into the available stock.' };
  }
}
