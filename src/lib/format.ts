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
  const sixteenths = Math.round((mm / 25.4) * 16);
  const whole = Math.floor(sixteenths / 16);
  const rest = sixteenths % 16;
  if (!rest) return `${whole}″`;
  const divisor = gcd(rest, 16);
  const fraction = `${rest / divisor}/${16 / divisor}`;
  return whole ? `${whole} ${fraction}″` : `${fraction}″`;
};

/** "39 3/16″ × 78 3/16″" */
export const formatInchSize = (widthMm: number, heightMm: number) => `${formatInches(widthMm)} × ${formatInches(heightMm)}`;
