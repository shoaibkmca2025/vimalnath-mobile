import { calculateBars } from '@/lib/bar-optimizer';

/** `note` carries extra detail shown under the label, e.g. the cut pieces behind a bar count. */
export type MaterialItem = { label: string; value: string; note?: string };

export type GlassPlanResult = {
  openingWidth: number;
  openingHeight: number;
  cuttingWidth: number;
  cuttingHeight: number;
  glassWidth: number;
  glassHeight: number;
  glassQuantity: number;
  materials: MaterialItem[];
};

export type SizeRange = { minWidth: number; maxWidth: number; minHeight: number; maxHeight: number };

// Placeholder shop-floor defaults for systems without a confirmed formula below.
const CUTTING_ALLOWANCE_MM = 20;

/** "2+1 Sliding System" → 3 panels. Falls back to 1 if the name doesn't carry a count. */
export function parsePanelCount(name: string): number {
  const matches = name.match(/\d+/g);
  if (!matches) return 1;
  const total = matches.reduce((sum, value) => sum + Number(value), 0);
  return total > 0 ? total : 1;
}

/**
 * "1+0 Sliding System" → "1+0", "2+0 Synchro Sliding System" → "synchro:2+0". Used to look up the
 * confirmed per-system formulas below; synchro systems get their own keys so a telescopic formula
 * never applies to the synchro system with the same panel count.
 */
function systemKey(name: string): string {
  const match = name.match(/\d+\s*\+\s*\d+/);
  if (!match) return '';
  const key = match[0].replace(/\s+/g, '');
  return /synchro/i.test(name) ? `synchro:${key}` : key;
}

type CuttingSizeFormula = {
  width: (openingWidth: number, openingHeight: number) => number;
  height: (openingWidth: number, openingHeight: number) => number;
};

/**
 * A material list keyed to the finished cutting size (not the opening size). Brackets are checked
 * in order; the first whose cutting-width and cutting-height range the result satisfies wins.
 */
type MaterialBracket = {
  minWidth: number;
  maxWidth: number;
  minHeight: number;
  maxHeight: number;
  materials: (cuttingWidth: number, cuttingHeight: number) => MaterialItem[];
};

type SystemFormula = {
  range: SizeRange;
  cuttingSize: CuttingSizeFormula;
  glassQuantity: number;
  materialBrackets: MaterialBracket[];
  /**
   * Profile pieces to cut: verticals at the cutting height, horizontals at the cutting width. When
   * set, the Vertical and Horizontal rows are worked out by the bar optimizer from PROFILE_BARS_MM
   * instead of the bracket's fixed counts.
   */
  profilePieces?: { vertical: number; horizontal: number };
};

// Standard vertical / horizontal profile bar lengths in stock.
const PROFILE_BARS_MM = [2450, 3000];

/** "1 (2450 mm) + 1 (3000 mm)" — how many bars of each stock length to take for these pieces. */
function optimizedProfile(label: string, pieceLength: number, pieceCount: number): MaterialItem {
  const bars = calculateBars([{ length: pieceLength, qty: pieceCount }], PROFILE_BARS_MM.map((length) => ({ length })), 0);
  const counts = new Map<number, number>();
  for (const bar of bars) counts.set(bar.length, (counts.get(bar.length) ?? 0) + 1);
  const value = [...counts.entries()]
    .sort(([a], [b]) => a - b)
    .map(([length, count]) => `${count} (${length} mm)`)
    .join(' + ');
  return { label, value, note: `${pieceCount} pcs × ${pieceLength} mm` };
}

// Formulas confirmed by Vimalnath, keyed by system ("1+0", "2+0", …). Any system not listed here
// falls back to the CUTTING_ALLOWANCE_MM placeholder below until its formula is confirmed.
const SYSTEM_FORMULAS: Record<string, SystemFormula> = {
  '1+0': {
    range: { minWidth: 600, maxWidth: 1200, minHeight: 1800, maxHeight: 3000 },
    cuttingSize: {
      width: (openingWidth) => openingWidth + 16,
      height: (_openingWidth, openingHeight) => openingHeight - 93,
    },
    glassQuantity: 1,
    profilePieces: { vertical: 2, horizontal: 2 },
    materialBrackets: [
      {
        // Cutting size 600–1200 mm wide, 1800–2400 mm tall
        minWidth: 600,
        maxWidth: 1200,
        minHeight: 1800,
        maxHeight: 2400,
        materials: () => [
          { label: 'Vertical', value: '2 (2.5 m)' },
          { label: 'Horizontal', value: '1 (2.5 m)' },
          { label: 'Sliding Handle / Latch Handle', value: '1+1' },
          { label: '0+1 Kit', value: '1' },
          { label: 'Gasket', value: '(8mm)' },
          { label: 'Connector', value: '4 nos' },
          { label: 'Middle', value: 'According to design' },
          { label: 'D. Connector', value: 'According to design' },
        ],
      },
      {
        // Cutting size 600–1200 mm wide, 2400–3000 mm tall
        minWidth: 600,
        maxWidth: 1200,
        minHeight: 2400,
        maxHeight: 3000,
        materials: () => [
          { label: 'Vertical', value: '2 (3 m)' },
          { label: 'Horizontal', value: '1 (2.5 m)' },
          { label: 'Sliding Handle / Latch Handle', value: '1+1' },
          { label: '0+1 Kit', value: '1' },
          { label: 'Gasket', value: '3 (8mm)' },
          { label: 'Connector', value: '4 nos' },
          { label: 'Middle', value: 'According to design' },
          { label: 'D. Connector', value: 'According to design' },
        ],
      },
    ],
  },
  '1+1': {
    range: { minWidth: 1200, maxWidth: 2400, minHeight: 1800, maxHeight: 3000 },
    cuttingSize: {
      width: (openingWidth) => (openingWidth + 16) / 2,
      height: (_openingWidth, openingHeight) => openingHeight - 93,
    },
    glassQuantity: 2,
    profilePieces: { vertical: 4, horizontal: 4 },
    materialBrackets: [
      {
        // Cutting size 600–1200 mm wide, 1800–2400 mm tall
        minWidth: 600,
        maxWidth: 1200,
        minHeight: 1800,
        maxHeight: 2400,
        materials: () => [
          { label: 'Vertical', value: '4 (2.5 m)' },
          { label: 'Horizontal', value: '2 (2.5 m)' },
          { label: 'Sliding Track', value: '2 (2.5 m)' },
          { label: 'Sliding Handle / Latch Handle', value: '1+1' },
          { label: '1+1 Kit', value: '1' },
          { label: 'Gasket', value: '6 (8mm)' },
          { label: 'Connector', value: '8 nos' },
          { label: 'Middle', value: 'According to design' },
          { label: 'D. Connector', value: 'According to design' },
        ],
      },
      {
        // Cutting size 600–1200 mm wide, 2400–3000 mm tall
        minWidth: 600,
        maxWidth: 1200,
        minHeight: 2400,
        maxHeight: 3000,
        materials: () => [
          { label: 'Vertical', value: '4 (3 m)' },
          { label: 'Horizontal', value: '2 (2.5 m)' },
          { label: 'Sliding Track', value: '2 (2.5 m)' },
          { label: 'Sliding Handle / Latch Handle', value: '1+1' },
          { label: '1+1 Kit', value: '1' },
          { label: 'Gasket', value: '6 (8mm)' },
          { label: 'Connector', value: '8 nos' },
          { label: 'Middle', value: 'According to design' },
          { label: 'D. Connector', value: 'According to design' },
        ],
      },
    ],
  },
  '2+0': {
    range: { minWidth: 600, maxWidth: 1200, minHeight: 1800, maxHeight: 3000 },
    cuttingSize: {
      width: (openingWidth) => openingWidth + 16 + 16,
      height: (_openingWidth, openingHeight) => openingHeight - 93,
    },
    glassQuantity: 1,
    profilePieces: { vertical: 4, horizontal: 4 },
    materialBrackets: [
      {
        // Cutting size 600–1200 mm wide, 1800–2400 mm tall
        minWidth: 600,
        maxWidth: 1200,
        minHeight: 1800,
        maxHeight: 2400,
        materials: () => [
          { label: 'Vertical', value: '4 (2.5 m)' },
          { label: 'Horizontal', value: '2 (2.5 m)' },
          { label: 'Sliding Handle / Latch Handle', value: '1+1' },
          { label: '2+0 Kit', value: '1' },
          { label: 'Gasket', value: '6 (8mm)' },
          { label: 'Connector', value: '8 nos' },
          { label: 'Middle', value: 'According to design' },
          { label: 'D. Connector', value: 'According to design' },
        ],
      },
      {
        // Cutting size 600–1200 mm wide, 2400–3000 mm tall
        minWidth: 600,
        maxWidth: 1200,
        minHeight: 2400,
        maxHeight: 3000,
        materials: () => [
          { label: 'Vertical', value: '4 (3 m)' },
          { label: 'Horizontal', value: '2 (2.5 m)' },
          { label: 'Sliding Handle / Latch Handle', value: '1+1' },
          { label: '2+0 Kit', value: '1' },
          { label: 'Gasket', value: '6 (8mm)' },
          { label: 'Connector', value: '8 nos' },
          { label: 'Middle', value: 'According to design' },
          { label: 'D. Connector', value: 'According to design' },
        ],
      },
    ],
  },
};

export function getSystemRange(systemName: string): SizeRange | null {
  return SYSTEM_FORMULAS[systemKey(systemName)]?.range ?? null;
}

function fallbackPlan(width: number, height: number, panelCount: number): GlassPlanResult {
  const glassWidth = Math.max(0, width - CUTTING_ALLOWANCE_MM);
  const glassHeight = Math.max(0, height - CUTTING_ALLOWANCE_MM);
  const cuttingWidth = Math.round(glassWidth / panelCount);
  const cuttingHeight = glassHeight;
  const aluminiumProfileM = ((cuttingWidth + cuttingHeight) * 2 * panelCount) / 1000;
  return {
    openingWidth: width,
    openingHeight: height,
    cuttingWidth,
    cuttingHeight,
    glassWidth,
    glassHeight,
    glassQuantity: panelCount,
    materials: [
      { label: 'Toughened Glass (10 mm)', value: `${panelCount} pc${panelCount > 1 ? 's' : ''}` },
      { label: 'Aluminium Profile', value: `${aluminiumProfileM.toFixed(1)} m` },
      { label: 'Gasket / Sealant', value: '1 set' },
      { label: 'Accessories (Handle, etc.)', value: '1 set' },
    ],
  };
}

export function computeGlassPlan(
  systemName: string,
  width: number,
  height: number,
  panelCount: number,
): { result: GlassPlanResult } | { error: string } {
  const formula = SYSTEM_FORMULAS[systemKey(systemName)];
  if (!formula) return { result: fallbackPlan(width, height, panelCount) };

  const { range } = formula;
  if (width < range.minWidth || width > range.maxWidth || height < range.minHeight || height > range.maxHeight) {
    return {
      error: `Width must be ${range.minWidth}–${range.maxWidth} mm and height ${range.minHeight}–${range.maxHeight} mm for this system.`,
    };
  }

  const cuttingWidth = Math.round(formula.cuttingSize.width(width, height));
  const cuttingHeight = Math.round(formula.cuttingSize.height(width, height));
  const glassWidth = cuttingWidth - 21;
  const glassHeight = cuttingHeight - 21;

  // Match on the finished cutting size; if it falls just outside every bracket's width range,
  // still pick the bracket for the right height rather than showing no material list at all.
  const bracket =
    formula.materialBrackets.find(
      (candidate) => cuttingWidth >= candidate.minWidth && cuttingWidth <= candidate.maxWidth && cuttingHeight >= candidate.minHeight && cuttingHeight <= candidate.maxHeight,
    ) ??
    formula.materialBrackets.find((candidate) => cuttingHeight <= candidate.maxHeight) ??
    formula.materialBrackets[formula.materialBrackets.length - 1];

  return {
    result: {
      openingWidth: width,
      openingHeight: height,
      cuttingWidth,
      cuttingHeight,
      glassWidth,
      glassHeight,
      glassQuantity: formula.glassQuantity,
      materials: withOptimizedProfiles(bracket.materials(cuttingWidth, cuttingHeight), formula, cuttingWidth, cuttingHeight),
    },
  };
}

function withOptimizedProfiles(materials: MaterialItem[], formula: SystemFormula, cuttingWidth: number, cuttingHeight: number): MaterialItem[] {
  const pieces = formula.profilePieces;
  if (!pieces) return materials;
  return materials.map((item) => {
    if (item.label === 'Vertical') return optimizedProfile('Vertical', cuttingHeight, pieces.vertical);
    if (item.label === 'Horizontal') return optimizedProfile('Horizontal', cuttingWidth, pieces.horizontal);
    return item;
  });
}
