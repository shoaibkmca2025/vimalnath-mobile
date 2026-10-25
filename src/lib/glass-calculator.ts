import { calculateBars } from '@/lib/bar-optimizer';
import { formatFeetRoundedUp } from '@/lib/format';

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
  materials: (cuttingWidth: number, cuttingHeight: number, openingWidth: number) => MaterialItem[];
};

type SystemFormula = {
  range: SizeRange;
  cuttingSize: CuttingSizeFormula;
  glassQuantity: number;
  materialBrackets: MaterialBracket[];
};

const OVERLAP_MM = 16;
const HEIGHT_DEDUCTION_MM = 92;
const MIN_HEIGHT_MM = 1800;
const MAX_HEIGHT_MM = 2998;
/** Verticals come in 2.5 m up to this cutting height, 3 m above it. */
const SHORT_VERTICAL_MAX_MM = 2489;

/** Horizontal profile bars in stock, with the names they go by. */
const HORIZONTAL_STOCK = [
  { mm: 2498, name: '2.5 m' },
  { mm: 2998, name: '3 m' },
];
/** Every glass panel takes a top and a bottom horizontal, cut at the cutting width. */
const HORIZONTALS_PER_PANEL = 2;

/**
 * The Horizontal row: 'bars' is one 2.5 m bar per panel; 'optimized' cuts the horizontals from the
 * stock lengths with the bar optimizer, e.g. "3 nos (2.5 m)" for six 1016 mm pieces.
 */
type HorizontalRule = 'bars' | 'optimized';

function horizontalItem(rule: HorizontalRule, panels: number, cuttingWidth: number): MaterialItem {
  if (rule === 'bars') return { label: 'Horizontal', value: `${panels} nos (2.5 m)` };
  const pieces = HORIZONTALS_PER_PANEL * panels;
  const bars = calculateBars([{ length: cuttingWidth, qty: pieces }], HORIZONTAL_STOCK.map((stock) => ({ length: stock.mm })), 0);
  const counts = new Map<number, number>();
  for (const bar of bars) counts.set(bar.length, (counts.get(bar.length) ?? 0) + 1);
  const value = [...counts.entries()]
    .sort(([a], [b]) => b - a)
    .map(([length, count]) => `${count} nos (${HORIZONTAL_STOCK.find((stock) => stock.mm === length)?.name ?? `${length} mm`})`)
    .join(' + ');
  return { label: 'Horizontal', value, note: `${pieces} pcs × ${cuttingWidth} mm (top and bottom of each glass)` };
}

/** Extra track beyond the opening and one parked panel, for systems whose panels all slide away. */
const TRACK_PARKING_EXTRA_MM = 200;

/**
 * How the Top Track row is worked out:
 * - 'panels': one 2.5 m track per panel;
 * - 'opening': one track as long as the opening width (systems with a fixed panel, e.g. 2+1);
 * - 'parking': the opening width + one cutting width + 200 mm, so the panels can slide clear of the
 *   opening (systems where every panel slides, e.g. 2+0).
 */
type TrackRule = 'panels' | 'opening' | 'parking';

function trackItem(rule: TrackRule, panels: number, openingWidth: number, cuttingWidth: number): MaterialItem {
  if (rule === 'panels') return { label: 'Top Track', value: `${panels} nos (2.5 m)` };
  const length = rule === 'opening' ? openingWidth : openingWidth + cuttingWidth + TRACK_PARKING_EXTRA_MM;
  return { label: 'Top Track', value: formatFeetRoundedUp(length) };
}

/**
 * Telescopic sliding systems ("2+1" = 2 sliding + 1 fixed panel) follow one rule, confirmed by
 * Vimalnath for 1+0, 1+1, 2+0 and 2+1 and extended to 3+0, 3+1, 4+0 and 4+1:
 * - each sliding panel adds a 16 mm overlap, and the width is shared between all the glass panels;
 *   the cutting height is the opening height − 92 mm; glass is the cutting size − 21 mm;
 * - 3 gaskets and 4 connectors per panel, 2 verticals and 2 track caps, the horizontals by `horizontal`,
 *   the top track by `track`, and the system's sliding kit (`kit` names it when it isn't named after the system).
 */
function telescopicFormula(
  system: string,
  maxWidth: number,
  { kit = `${system} Sliding Kit`, track = 'panels', horizontal = 'bars' }: { kit?: string; track?: TrackRule; horizontal?: HorizontalRule } = {},
): SystemFormula {
  const [sliding, fixed] = system.split('+').map(Number);
  const panels = sliding + fixed;
  const minWidth = 600 * panels;
  const cuttingWidth = (openingWidth: number) => (openingWidth + OVERLAP_MM * sliding) / panels;
  return {
    range: { minWidth, maxWidth, minHeight: MIN_HEIGHT_MM, maxHeight: MAX_HEIGHT_MM },
    cuttingSize: {
      width: cuttingWidth,
      height: (_openingWidth, openingHeight) => openingHeight - HEIGHT_DEDUCTION_MM,
    },
    glassQuantity: panels,
    materialBrackets: [
      {
        // One list for every cutting size the opening range produces.
        minWidth: cuttingWidth(minWidth),
        maxWidth: cuttingWidth(maxWidth),
        minHeight: MIN_HEIGHT_MM - HEIGHT_DEDUCTION_MM,
        maxHeight: MAX_HEIGHT_MM - HEIGHT_DEDUCTION_MM,
        materials: (finishedWidth, cuttingHeight, openingWidth) => [
          { label: 'Vertical', value: cuttingHeight <= SHORT_VERTICAL_MAX_MM ? '2 nos (2.5 m)' : '2 nos (3 m)' },
          horizontalItem(horizontal, panels, finishedWidth),
          trackItem(track, panels, openingWidth, finishedWidth),
          { label: 'Track Cap', value: '2 nos (2.5 m)' },
          { label: 'Sliding Handle / Latch Handle', value: '1+1' },
          { label: kit, value: '1 nos' },
          { label: 'Gasket', value: `${3 * panels} nos (8mm)` },
          { label: 'Connector', value: `${4 * panels} nos` },
          { label: 'Middle', value: 'According to design' },
          { label: 'D. Connector', value: 'According to design' },
        ],
      },
    ],
  };
}

// Formulas keyed by system ("1+0", "2+0", …), with the widest opening each allows. Any system not
// listed here falls back to the CUTTING_ALLOWANCE_MM placeholder below until its formula is confirmed.
const SYSTEM_FORMULAS: Record<string, SystemFormula> = {
  '1+0': telescopicFormula('1+0', 1200, { kit: '0+1 Sliding Kit' }),
  '1+1': telescopicFormula('1+1', 2438),
  '2+0': telescopicFormula('2+0', 2438, { track: 'parking', horizontal: 'optimized' }),
  '2+1': telescopicFormula('2+1', 3657, { track: 'opening', horizontal: 'optimized' }),
  '3+0': telescopicFormula('3+0', 3657, { track: 'parking', horizontal: 'optimized' }),
  '3+1': telescopicFormula('3+1', 4876, { track: 'opening', horizontal: 'optimized' }),
  '4+0': telescopicFormula('4+0', 4876, { track: 'parking', horizontal: 'optimized' }),
  '4+1': telescopicFormula('4+1', 6095, { track: 'opening', horizontal: 'optimized' }),
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
      materials: bracket.materials(cuttingWidth, cuttingHeight, width),
    },
  };
}
