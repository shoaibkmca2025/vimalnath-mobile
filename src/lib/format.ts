export const pad2 = (value: number) => String(value).padStart(2, '0');

// Hand-rolled grouping so output is identical on Hermes builds with or without full Intl data.
export const formatNumber = (value: number) => String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

export const formatMm = (value: number) => `${formatNumber(value)} mm`;

/** "29 Sep 2026" */
export function formatOrderDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

/**
 * Tape-measure inches, rounded to the nearest 1/16″ and reduced: 995 mm → "39 3/16″", 1016 mm → "40″",
 * 12.7 mm → "1/2″" (1 inch = 25.4 mm).
 */
export const formatInches = (mm: number) => {
  const { whole, sixteenths } = mmToInchParts(mm);
  const fraction = formatFraction(sixteenths);
  if (!fraction) return `${whole}″`;
  return whole ? `${whole} ${fraction}″` : `${fraction}″`;
};

/** A count of sixteenths as a reduced tape fraction: 8 → "1/2", 3 → "3/16", 0 → "". */
export const formatFraction = (sixteenths: number) => {
  if (!sixteenths) return '';
  const divisor = gcd(sixteenths, 16);
  return `${sixteenths / divisor}/${16 / divisor}`;
};

/** Whole inches plus sixteenths, rounded to the nearest 1/16″. */
export function mmToInchParts(mm: number): { whole: number; sixteenths: number } {
  const total = Math.round((mm / 25.4) * 16);
  return { whole: Math.floor(total / 16), sixteenths: total % 16 };
}

/** 47 and 8/16 → 1207 mm, rounded to the whole millimetre the formulas work in. */
export const inchesToMm = (whole: number, sixteenths: number) => Math.round((whole + sixteenths / 16) * 25.4);

/** "39 3/16″ × 78 3/16″" */
export const formatInchSize = (widthMm: number, heightMm: number) => `${formatInches(widthMm)} × ${formatInches(heightMm)}`;
