import { calculateBars } from '@/lib/bar-optimizer';
import { formatInches } from '@/lib/format';

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

/** Extra track beyond the opening and one parked shutter, for systems whose shutters all slide into the wall. */
const TRACK_PARKING_EXTRA_MM = 200;

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
function optimizedRow(label: string, pieces: number, length: number, stock: Stock, what: string, sameLength = false): { item: MaterialItem; bars: number } {
  const lengths = stock.map((entry) => entry.mm);
  // Tracks are only joined when no stock bar is long enough for one piece.
  const longEnough = lengths.filter((bar) => bar >= length);
  const candidates = longEnough.length ? longEnough : lengths;
  const bars = sameLength ? bestOf(candidates.map((single) => joinAndPack(pieces, length, [single]))) : joinAndPack(pieces, length, lengths);
  const counts = new Map<number, number>();
  for (const bar of bars) counts.set(bar, (counts.get(bar) ?? 0) + 1);
  const value = stock
    .filter((entry) => counts.has(entry.mm))
    .map((entry) => `${counts.get(entry.mm)} nos (${entry.name})`)
    .join(' + ');
  const joined = length > Math.max(...bars) ? ' · longer than one bar, so each is joined' : '';
  return { item: { label, value, note: `Cut ${pieces} pcs × ${length} mm (${formatInches(length)}) · ${what}${joined}` }, bars: bars.length };
}

/**
 * The stock bars (their lengths) for `pieces` cuts of `length` mm. A piece longer than the longest bar is
 * joined: it takes whole bars of that length plus a remainder, and the remainders are packed by the bar
 * optimizer (least total length, then fewest bars).
 */
function joinAndPack(pieces: number, length: number, stockLengths: number[]): number[] {
  const longest = Math.max(...stockLengths);
  const whole = length > longest ? Math.floor(length / longest) : 0;
  const rest = length - whole * longest;
  const bars: number[] = Array.from({ length: whole * pieces }, () => longest);
  if (rest > 0.5) {
    const packed = calculateBars([{ length: rest, qty: pieces }], stockLengths.map((bar) => ({ length: bar })), 0);
    bars.push(...packed.map((bar) => bar.length));
  }
  return bars;
}

/** The plan with the least total length, then the fewest bars. */
function bestOf(plans: number[][]): number[] {
  // Totals are compared to the nearest mm: feet and inch stock lengths aren't exact in mm, and a rounding
  // difference mustn't beat a plan with fewer bars.
  const total = (plan: number[]) => Math.round(plan.reduce((sum, bar) => sum + bar, 0));
  return [...plans].sort((a, b) => total(a) - total(b) || a.length - b.length)[0] ?? [];
}

const optimizedHorizontalProfile = (pieces: number, length: number) =>
  optimizedRow('Horizontal Profile', pieces, length, PROFILE_STOCK, 'top and bottom of each glass');

type TrackSpec =
  /** Fixed 2.5 m lengths. */
  | { fixed: number }
  /** `pieces` tracks of `length` mm each, cut from TRACK_STOCK by the bar optimizer. */
  | {
      pieces: number;
      length: (openingWidth: number, cuttingWidth: number) => number;
      what: string;
      /** Every track bar the same stock length (no 8 ft + 12 ft mixes). */
      sameLength?: boolean;
      /** A fixed number of track caps, in the top track's stock length; without it the caps match the track. */
      caps?: number;
    };

type SystemSpec = {
  system: string;
  /** The kit's name in the list; defaults to "<system> Telescopic Sliding Kit". */
  kit?: string;
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
            track = optimizedRow('Top Track', spec.track.pieces, length, TRACK_STOCK, spec.track.what, spec.track.sameLength).item;
            cap =
              spec.track.caps !== undefined
                ? // One stock length (sameLength), so only the count changes: "3 nos (10 ft)" → "2 nos (10 ft)".
                  { label: 'Track Cap', value: track.value.replace(/^\d+ nos/, `${spec.track.caps} nos`), note: 'Same length as the top track bars' }
                : { ...track, label: 'Track Cap', note: `${track.note?.split(' · ')[0]} · same as the top track` };
          }
          return [
            { label: 'Vertical Profile', value: `${spec.verticals} nos (${cuttingHeight <= 2400 ? '2.5 m' : '3 m'})` },
            horizontal.item,
            track,
            cap,
            { label: 'Sliding Handle / Latch Handle', value: spec.handle },
            { label: spec.kit ?? `${spec.system} Telescopic Sliding Kit`, value: '1 nos' },
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
  track: { pieces: 3, length: (openingWidth) => openingWidth, what: 'one per panel, as long as the opening', sameLength: true, caps: 2 },
  handle: '1+1',
  connectors: 12,
});

// The larger systems follow the same structure as 2+0 and 2+1: 600–1200 mm of opening per glass, 16 mm of
// overlap per sliding panel, 2 vertical profiles and 4 connectors per glass. "+0" systems slide fully into
// the wall (wall-pocket reminder, tracks of opening + one shutter + 200 mm, handle named after the system);
// "+1" systems keep a fixed panel (tracks as long as the opening, one stock length, 2 track caps, 1+1 handle).
const allIntoWall = (system: string, glasses: number): SystemSpec => ({
  system,
  minWidth: 600 * glasses,
  maxWidth: 1200 * glasses,
  overlap: 16 * glasses,
  verticals: 2 * glasses,
  track: { pieces: glasses, length: (openingWidth, cuttingWidth) => openingWidth + cuttingWidth + TRACK_PARKING_EXTRA_MM, what: 'opening + one shutter + 200 mm' },
  handle: system,
  connectors: 4 * glasses,
  notice: (cuttingWidth) => `Check the hiding space in the wall: it must be at least the shutter size, ${cuttingWidth} mm (${formatInches(cuttingWidth)}).`,
});

const withFixedPanel = (system: string, glasses: number): SystemSpec => ({
  system,
  minWidth: 600 * glasses,
  maxWidth: 1200 * glasses,
  overlap: 16 * (glasses - 1),
  verticals: 2 * glasses,
  track: { pieces: glasses, length: (openingWidth) => openingWidth, what: 'one per panel, as long as the opening', sameLength: true, caps: 2 },
  handle: '1+1',
  connectors: 4 * glasses,
});

/**
 * Synchro systems, following Vimalnath's 2+0 and 2+2: 600–1200 mm of opening per glass and 16 mm of overlap
 * per sliding panel; 2 vertical profiles per glass; the connector count Vimalnath gives each system; two top tracks
 * (one stock length) and two track caps. With no fixed panels ("+0") the shutters part into the walls, so
 * each track is twice the opening and the results remind the user to check the wall pockets; with fixed
 * panels at the ends ("+2") each track spans the opening.
 */
function synchro(system: string, connectors: number): SystemSpec {
  const [sliding, fixed] = system.split('+').map(Number);
  const glasses = sliding + fixed;
  const intoWall = fixed === 0;
  return {
    system,
    kit: `${system} Synchro Sliding Kit`,
    minWidth: 600 * glasses,
    maxWidth: 1200 * glasses,
    overlap: 16 * sliding,
    verticals: 2 * glasses,
    track: intoWall
      ? { pieces: 2, length: (openingWidth) => 2 * openingWidth, what: 'twice the opening', sameLength: true, caps: 2 }
      : { pieces: 2, length: (openingWidth) => openingWidth, what: 'as long as the opening', sameLength: true, caps: 2 },
    handle: '1+1',
    connectors,
    notice: intoWall
      ? (cuttingWidth) => `Check the hiding space in the wall: it must be at least the shutter size, ${cuttingWidth} mm (${formatInches(cuttingWidth)}).`
      : undefined,
  };
}

// Formulas keyed by system ("1+0", "2+0", …), with the widest opening each allows. Any system not
// listed here falls back to the CUTTING_ALLOWANCE_MM placeholder below until its formula is confirmed.
const SYSTEM_FORMULAS: Record<string, SystemFormula> = {
  '1+0': ONE_PLUS_ZERO,
  '1+1': ONE_PLUS_ONE,
  '2+0': TWO_PLUS_ZERO,
  '2+1': TWO_PLUS_ONE,
  '3+0': vimalnathSystem(allIntoWall('3+0', 3)),
  '3+1': vimalnathSystem(withFixedPanel('3+1', 4)),
  '4+0': vimalnathSystem(allIntoWall('4+0', 4)),
  '4+1': vimalnathSystem(withFixedPanel('4+1', 5)),
  'synchro:2+0': vimalnathSystem(synchro('2+0', 8)),
  'synchro:2+2': vimalnathSystem(synchro('2+2', 16)),
  'synchro:4+0': vimalnathSystem(synchro('4+0', 16)),
  'synchro:4+2': vimalnathSystem(synchro('4+2', 24)),
  'synchro:6+0': vimalnathSystem(synchro('6+0', 24)),
  'synchro:6+2': vimalnathSystem(synchro('6+2', 32)),
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
