import { formatMm, formatNumber, formatSixteenths } from '@/lib/format';

/** Sizes are entered in millimetres or in tape-measure inches (whole inches plus sixteenths). */
export type LengthUnit = 'mm' | 'in';

/** The chosen unit, remembered across the app: the glass calculator and bar optimizer share it. */
export const SIZE_UNIT_KEY = 'vimalnath:size-unit';

export const UNIT_OPTIONS: { value: LengthUnit; label: string }[] = [
  { value: 'mm', label: 'Millimetres (mm)' },
  { value: 'in', label: 'Inches (″)' },
];

/**
 * A bar plan's lengths are whole millimetres, or whole sixteenths of an inch for an inch plan so that
 * tape sizes add up exactly (three 32″ pieces fill a 96″ bar). "2,450 mm" / "47 1/2″".
 */
export const formatLength = (value: number, unit: LengthUnit = 'mm') => (unit === 'in' ? formatSixteenths(value) : formatMm(value));

/** Without the unit for millimetres, for tight labels: "2,450" / "47 1/2″". */
export const formatLengthValue = (value: number, unit: LengthUnit = 'mm') => (unit === 'in' ? formatSixteenths(value) : formatNumber(value));

export const unitWord = (unit: LengthUnit = 'mm') => (unit === 'in' ? 'inches' : 'millimetres');
