import { calculateBars } from '@/lib/bar-optimizer';
import { formatFeetRoundedUp, formatInches } from '@/lib/format';

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
  /** Shown on screen and in the PDF when the sizes need checking before anything is cut. */
  warning?: string;
  /** An installation reminder shown with the results and in the PDF, e.g. about the wall pocket. */
  notice?: string;
};

export type SizeRange = { minWidth: number; maxWidth: number; minHeight: number; maxHeight: number };

// Placeholder shop-floor defaults for systems without a confirmed formula below.
const CUTTING_ALLOWANCE_MM = 20;
/** The widest panel printed for the telescopic kits (systemSpecs in src/data/shop/systems.ts). */
const MAX_PANEL_WIDTH_MM = 950;

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
  materials: (cuttingWidth: number, cuttingHeight: number, openingWidth: number, openingHeight: number) => MaterialItem[];
};

type SystemFormula = {
  range: SizeRange;
  cuttingSize: CuttingSizeFormula;
  glassQuantity: number;
  materialBrackets: MaterialBracket[];
  notice?: (cuttingWidth: number) => string;
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
 * - 'opening': one track per panel, each as long as the opening width (systems with a fixed panel, e.g. 2+1);
 * - 'parking': one track per panel, each the opening width + one cutting width + 200 mm, so the panels can slide clear of the
 *   opening (systems where every panel slides, e.g. 2+0).
 */
type TrackRule = 'panels' | 'opening' | 'parking';

function trackItem(rule: TrackRule, panels: number, openingWidth: number, cuttingWidth: number): MaterialItem {
  if (rule === 'panels') return { label: 'Top Track', value: `${panels} nos (2.5 m)` };
  const length = rule === 'opening' ? openingWidth : openingWidth + cuttingWidth + TRACK_PARKING_EXTRA_MM;
  return { label: 'Top Track', value: `${panels} nos (${formatFeetRoundedUp(length)})` };
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

/**
 * 1+0, as specified by Vimalnath: length 600–1200 mm, height 1800–3000 mm; cutting length = length + 16,
 * cutting height = height − 93; one glass. The list is for openings up to 2400 mm high; taller openings
 * get 3 m vertical profiles.
 */
const ONE_PLUS_ZERO: SystemFormula = {
  range: { minWidth: 600, maxWidth: 1200, minHeight: 1800, maxHeight: 3000 },
  cuttingSize: {
    width: (openingWidth) => openingWidth + 16,
    height: (_openingWidth, openingHeight) => openingHeight - 93,
  },
  glassQuantity: 1,
  materialBrackets: [
    {
      // Every cutting size the opening range produces.
      minWidth: 600 + 16,
      maxWidth: 1200 + 16,
      minHeight: 1800 - 93,
      maxHeight: 3000 - 93,
      materials: (_cuttingWidth, _cuttingHeight, _openingWidth, openingHeight) => [
        { label: 'Vertical Profile', value: openingHeight <= 2400 ? '2 nos (2.5 m)' : '2 nos (3 m)' },
        { label: 'Horizontal Profile', value: '1 nos (2.5 m)' },
        { label: 'Sliding Top Track', value: '1 nos (2.5 m)' },
        { label: 'Track Cap', value: '2 nos (2.5 m)' },
        { label: 'Sliding Handle / Latch Handle', value: '1+1' },
        { label: '1+0 Telescopic Sliding Kit', value: '1 nos' },
        { label: 'Gasket', value: '3 nos (8mm)' },
        { label: 'Connector', value: '4 nos' },
        { label: 'Middle Vertical', value: 'According to design' },
        { label: 'Georgian Bar', value: 'According to design' },
        { label: 'Damru Connector', value: 'According to design' },
      ],
    },
  ],
};

type Stock = { mm: number; name: string }[];

/** Vimalnath's full-length vertical and horizontal profile bars: 96″ and 118″. */
const PROFILE_STOCK: Stock = [
  { mm: 96 * 25.4, name: '96″' },
  { mm: 118 * 25.4, name: '118″' },
];

/** Top track and track cap lengths in stock: 8, 10, 12, 14 and 16 ft. */
const TRACK_STOCK: Stock = [8, 10, 12, 14, 16].map((feet) => ({ mm: feet * 304.8, name: `${feet} ft` }));

/**
 * A row worked out by the bar optimizer: `pieces` cuts of `length` mm from the stock lengths (least
 * total length, then fewest bars), e.g. "2 nos (96″)", with the cut size underneath. Also returns the
 * number of bars.
 */
function optimizedRow(label: string, pieces: number, length: number, stock: Stock, what: string): { item: MaterialItem; bars: number } {
  const bars = calculateBars([{ length, qty: pieces }], stock.map((entry) => ({ length: entry.mm })), 0);
  const counts = new Map<number, number>();
  for (const bar of bars) counts.set(bar.length, (counts.get(bar.length) ?? 0) + 1);
  const value = stock
    .filter((entry) => counts.has(entry.mm))
    .map((entry) => `${counts.get(entry.mm)} nos (${entry.name})`)
    .join(' + ');
  return { item: { label, value, note: `Cut ${pieces} pcs × ${length} mm (${formatInches(length)}) · ${what}` }, bars: bars.length };
}

const optimizedHorizontalProfile = (pieces: number, length: number) =>
  optimizedRow('Horizontal Profile', pieces, length, PROFILE_STOCK, 'top and bottom of each glass');

type TrackSpec =
  /** Fixed 2.5 m lengths. */
  | { fixed: number }
  /** `pieces` tracks of `length` mm each, cut from TRACK_STOCK by the bar optimizer. */
  | { pieces: number; length: (openingWidth: number, cuttingWidth: number) => number; what: string };

type SystemSpec = {
  system: string;
  minWidth: number;
  maxWidth: number;
  /** Added to the opening length before it's shared between the glasses (16 mm per overlap). */
  overlap: number;
  verticals: number;
  track: TrackSpec;
  handle: string;
  connectors: number;
  notice?: (cuttingWidth: number) => string;
};

/**
 * The telescopic systems as specified by Vimalnath (1+1, 2+0, 2+1): height 1800–3000 mm; cutting length =
 * (length + overlap) ÷ glasses, cutting height = height − 93. Vertical profiles are 2.5 m up to a 2400 mm
 * cutting height and 3 m above it; horizontals (top and bottom of each glass) come from the bar optimizer;
 * the gasket count is the vertical plus horizontal profile count; the track cap matches the top track.
 */
function vimalnathSystem(spec: SystemSpec): SystemFormula {
  const [sliding, fixed] = spec.system.split('+').map(Number);
  const glasses = sliding + fixed;
  const cuttingWidth = (openingWidth: number) => (openingWidth + spec.overlap) / glasses;
  return {
    range: { minWidth: spec.minWidth, maxWidth: spec.maxWidth, minHeight: 1800, maxHeight: 3000 },
    cuttingSize: {
      width: cuttingWidth,
      height: (_openingWidth, openingHeight) => openingHeight - 93,
    },
    glassQuantity: glasses,
    notice: spec.notice,
    materialBrackets: [
      {
        // Every cutting size the opening range produces.
        minWidth: cuttingWidth(spec.minWidth),
        maxWidth: cuttingWidth(spec.maxWidth),
        minHeight: 1800 - 93,
        maxHeight: 3000 - 93,
        materials: (finishedWidth, cuttingHeight, openingWidth) => {
          const horizontal = optimizedHorizontalProfile(2 * glasses, finishedWidth);
          let track: MaterialItem;
          let cap: MaterialItem;
          if ('fixed' in spec.track) {
            track = { label: 'Top Track', value: `${spec.track.fixed} nos (2.5 m)` };
            cap = { label: 'Track Cap', value: `${spec.track.fixed} nos (2.5 m)` };
          } else {
            const length = spec.track.length(openingWidth, finishedWidth);
            track = optimizedRow('Top Track', spec.track.pieces, length, TRACK_STOCK, spec.track.what).item;
            cap = { ...track, label: 'Track Cap', note: `${track.note?.split(' · ')[0]} · same as the top track` };
          }
          return [
            { label: 'Vertical Profile', value: `${spec.verticals} nos (${cuttingHeight <= 2400 ? '2.5 m' : '3 m'})` },
            horizontal.item,
            track,
            cap,
            { label: 'Sliding Handle / Latch Handle', value: spec.handle },
            { label: `${spec.system} Telescopic Sliding Kit`, value: '1 nos' },
            {
              label: 'Gasket',
              value: `${spec.verticals + horizontal.bars} nos (8mm)`,
              note: `${spec.verticals} vertical + ${horizontal.bars} horizontal profiles`,
            },
            { label: 'Connector', value: `${spec.connectors} nos` },
            { label: 'Middle', value: 'According to design' },
            { label: 'Georgian Bar', value: 'According to design' },
            { label: 'Damru Connector', value: 'According to design' },
          ];
        },
      },
    ],
  };
}

const ONE_PLUS_ONE = vimalnathSystem({
  system: '1+1',
  minWidth: 1200,
  maxWidth: 2400,
  overlap: 16,
  verticals: 4,
  track: { fixed: 2 },
  handle: '1+1',
  connectors: 8,
});

// Both shutters slide into the wall, so 2+0 reminds the user to check the wall pocket.
const TWO_PLUS_ZERO = vimalnathSystem({
  system: '2+0',
  minWidth: 1200,
  maxWidth: 2400,
  overlap: 32,
  verticals: 4,
  track: { pieces: 2, length: (openingWidth, cuttingWidth) => openingWidth + cuttingWidth + TRACK_PARKING_EXTRA_MM, what: 'opening + one shutter + 200 mm' },
  handle: '2+0',
  connectors: 8,
  notice: (cuttingWidth) => `Check the hiding space in the wall: it must be at least the shutter size, ${cuttingWidth} mm (${formatInches(cuttingWidth)}).`,
});

const TWO_PLUS_ONE = vimalnathSystem({
  system: '2+1',
  minWidth: 1800,
  maxWidth: 3600,
  overlap: 32,
  verticals: 6,
  track: { pieces: 3, length: (openingWidth) => openingWidth, what: 'one per panel, as long as the opening' },
  handle: '1+1',
  connectors: 12,
});

// Formulas keyed by system ("1+0", "2+0", …), with the widest opening each allows. Any system not
// listed here falls back to the CUTTING_ALLOWANCE_MM placeholder below until its formula is confirmed.
const SYSTEM_FORMULAS: Record<string, SystemFormula> = {
  '1+0': ONE_PLUS_ZERO,
  '1+1': ONE_PLUS_ONE,
  '2+0': TWO_PLUS_ZERO,
  '2+1': TWO_PLUS_ONE,
  '3+0': telescopicFormula('3+0', 3657, { track: 'parking', horizontal: 'optimized' }),
  '3+1': telescopicFormula('3+1', 4876, { track: 'opening', horizontal: 'optimized' }),
  '4+0': telescopicFormula('4+0', 4876, { track: 'parking', horizontal: 'optimized' }),
  '4+1': telescopicFormula('4+1', 6095, { track: 'opening', horizontal: 'optimized' }),
};

export function getSystemRange(systemName: string): SizeRange | null {
  return SYSTEM_FORMULAS[systemKey(systemName)]?.range ?? null;
}

function fallbackPlan(width: number, height: number, panelCount: number): GlassPlanResult {
  const cuttingWidth = Math.round(Math.max(0, width - CUTTING_ALLOWANCE_MM) / panelCount);
  const cuttingHeight = Math.max(0, height - CUTTING_ALLOWANCE_MM);
  const aluminiumProfileM = ((cuttingWidth + cuttingHeight) * 2 * panelCount) / 1000;
  return {
    openingWidth: width,
    openingHeight: height,
    cuttingWidth,
    cuttingHeight,
    glassWidth: cuttingWidth,
    glassHeight: cuttingHeight,
    glassQuantity: panelCount,
    warning: 'No confirmed formula for this system yet. Check these sizes before cutting.',
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
      materials: bracket.materials(cuttingWidth, cuttingHeight, width, height),
      notice: formula.notice?.(cuttingWidth),
      warning:
        cuttingWidth > MAX_PANEL_WIDTH_MM
          ? `Panel width ${cuttingWidth} mm is over the ${MAX_PANEL_WIDTH_MM} mm printed for this system. Check with Vimalnath before ordering.`
          : undefined,
    },
  };
}
