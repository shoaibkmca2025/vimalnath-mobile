export type Piece = { length: number; qty: number };
export type BarStock = { length: number; qty?: number };
export type Bar = { length: number; used: number; pieces: number[] };

export type BarPlan = {
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

export function summarizePlan(bars: Bar[], kerf: number): BarPlan {
  const totalMaterial = bars.reduce((sum, bar) => sum + bar.length, 0);
  const used = bars.reduce((sum, bar) => sum + bar.used, 0);
  return {
    bars,
    kerf,
    totalMaterial,
    waste: Math.max(0, totalMaterial - used),
    utilization: totalMaterial ? (used / totalMaterial) * 100 : 0,
    cuts: bars.reduce((sum, bar) => sum + bar.pieces.length, 0),
  };
}

export type PlanRequest = { pieces: Piece[]; stock: BarStock[]; kerf: number };

export function planBars({ pieces, stock, kerf }: PlanRequest): { plan: BarPlan } | { error: string } {
  const validPieces = pieces.filter((piece) => piece.length > 0 && piece.qty > 0);
  const validStock = stock.filter((entry) => entry.length > 0 && (entry.qty === undefined || entry.qty > 0));
  if (!validPieces.length) return { error: 'Add at least one piece length first.' };
  if (!validStock.length) return { error: 'Add at least one standard bar length.' };
  const longestStock = Math.max(...validStock.map((entry) => entry.length));
  if (validPieces.some((piece) => piece.length > longestStock)) return { error: 'A piece cannot be longer than the longest standard bar.' };
  try {
    const bars = calculateBars(validPieces, validStock, kerf);
    return { plan: summarizePlan(bars, kerf) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not fit the pieces into the available stock.' };
  }
}
