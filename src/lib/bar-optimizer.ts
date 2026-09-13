export type Piece = { length: number; qty: number };
export type Bar = { used: number; pieces: number[] };

export type BarPlan = {
  bars: Bar[];
  barLength: number;
  kerf: number;
  totalMaterial: number;
  waste: number;
  utilization: number;
  cuts: number;
};

/**
 * First-fit decreasing: place the longest pieces first, each into the first bar that still
 * has room. Cutting loss (kerf) is charged between neighbouring pieces on the same bar.
 */
export function calculateBars(pieces: Piece[], barLength: number, kerf: number): Bar[] {
  const lengths = pieces
    .flatMap((piece) => Array.from({ length: piece.qty }, () => piece.length))
    .sort((a, b) => b - a);
  const bars: Bar[] = [];
  for (const length of lengths) {
    // Every open bar already holds a piece, so adding another always costs one kerf.
    const bar = bars.find((candidate) => candidate.used + kerf + length <= barLength);
    if (bar) {
      bar.used += kerf + length;
      bar.pieces.push(length);
    } else {
      bars.push({ used: length, pieces: [length] });
    }
  }
  return bars;
}

export function summarizePlan(bars: Bar[], barLength: number, kerf: number): BarPlan {
  const totalMaterial = bars.length * barLength;
  const used = bars.reduce((sum, bar) => sum + bar.used, 0);
  return {
    bars,
    barLength,
    kerf,
    totalMaterial,
    waste: Math.max(0, totalMaterial - used),
    utilization: totalMaterial ? (used / totalMaterial) * 100 : 0,
    cuts: bars.reduce((sum, bar) => sum + bar.pieces.length, 0),
  };
}

export type PlanRequest = { lengths: number[]; barLength: number; kerf: number };

export function planBars({ lengths, barLength, kerf }: PlanRequest): { plan: BarPlan } | { error: string } {
  const valid = lengths.filter((length) => length > 0);
  if (!valid.length || !(barLength > 0)) return { error: 'Add at least one piece length first.' };
  if (valid.some((length) => length > barLength)) return { error: 'A piece cannot be longer than the standard bar.' };
  const bars = calculateBars(valid.map((length) => ({ length, qty: 1 })), barLength, kerf);
  return { plan: summarizePlan(bars, barLength, kerf) };
}
