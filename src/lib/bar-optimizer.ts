export type Piece = { length: number; qty: number };
export type Bar = { length: number; used: number; pieces: number[] };

export type BarPlan = {
  bars: Bar[];
  barLengths: number[];
  kerf: number;
  totalMaterial: number;
  waste: number;
  utilization: number;
  cuts: number;
};

/**
 * First-fit decreasing: place the longest pieces first, each into the first open bar that still
 * has room. A new bar picks the shortest available stock length that fits the piece, to minimize
 * waste. Cutting loss (kerf) is charged between neighbouring pieces on the same bar.
 */
export function calculateBars(pieces: Piece[], barLengths: number[], kerf: number): Bar[] {
  const lengths = pieces
    .flatMap((piece) => Array.from({ length: piece.qty }, () => piece.length))
    .sort((a, b) => b - a);
  const stockLengths = [...barLengths].sort((a, b) => a - b);
  const bars: Bar[] = [];
  for (const length of lengths) {
    // Every open bar already holds a piece, so adding another always costs one kerf.
    const bar = bars.find((candidate) => candidate.used + kerf + length <= candidate.length);
    if (bar) {
      bar.used += kerf + length;
      bar.pieces.push(length);
    } else {
      const stock = stockLengths.find((candidate) => length <= candidate)!;
      bars.push({ length: stock, used: length, pieces: [length] });
    }
  }
  return bars;
}

export function summarizePlan(bars: Bar[], barLengths: number[], kerf: number): BarPlan {
  const totalMaterial = bars.reduce((sum, bar) => sum + bar.length, 0);
  const used = bars.reduce((sum, bar) => sum + bar.used, 0);
  return {
    bars,
    barLengths,
    kerf,
    totalMaterial,
    waste: Math.max(0, totalMaterial - used),
    utilization: totalMaterial ? (used / totalMaterial) * 100 : 0,
    cuts: bars.reduce((sum, bar) => sum + bar.pieces.length, 0),
  };
}

export type PlanRequest = { lengths: number[]; barLengths: number[]; kerf: number };

export function planBars({ lengths, barLengths, kerf }: PlanRequest): { plan: BarPlan } | { error: string } {
  const valid = lengths.filter((length) => length > 0);
  const validStock = barLengths.filter((length) => length > 0);
  if (!valid.length) return { error: 'Add at least one piece length first.' };
  if (!validStock.length) return { error: 'Add at least one standard bar length.' };
  const longestStock = Math.max(...validStock);
  if (valid.some((length) => length > longestStock)) return { error: 'A piece cannot be longer than the longest standard bar.' };
  const bars = calculateBars(
    valid.map((length) => ({ length, qty: 1 })),
    validStock,
    kerf,
  );
  return { plan: summarizePlan(bars, validStock, kerf) };
}
