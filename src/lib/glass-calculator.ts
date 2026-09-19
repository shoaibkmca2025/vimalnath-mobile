export type MaterialItem = { label: string; value: string };

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

/** "1+0 Sliding System" → "1+0". Used to look up the confirmed per-system formulas below. */
function systemKey(name: string): string {
  const match = name.match(/\d+\s*\+\s*\d+/);
  return match ? match[0].replace(/\s+/g, '') : '';
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
};

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
      materials: bracket.materials(cuttingWidth, cuttingHeight),
    },
  };
}
