/**
 * India's states as GST names them (the shop's server checks against the same list), and GSTIN checks, for signup,
 * the shop's details and delivery addresses.
 */

const GST_STATES: Record<string, string> = {
  '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand', '06': 'Haryana',
  '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh', '13': 'Nagaland',
  '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand',
  '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat', '26': 'Dadra and Nagar Haveli and Daman and Diu',
  '27': 'Maharashtra', '29': 'Karnataka', '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry',
  '35': 'Andaman and Nicobar Islands', '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh',
};

/** Alphabetical, Maharashtra (the shop's own) first. */
export const STATES = ['Maharashtra', ...Object.values(GST_STATES).filter((state) => state !== 'Maharashtra').sort()];
export const HOME_STATE = 'Maharashtra';

/** "27AAPFU0939F1ZV": 15 characters, the first two a state's code. Empty is allowed (not every customer has one). */
export function gstinProblem(value: string): string | undefined {
  const gstin = value.trim().toUpperCase();
  if (!gstin) return undefined;
  if (!/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstin) || !(gstin.slice(0, 2) in GST_STATES)) return 'Enter the 15-character GSTIN, e.g. 27AAPFU0939F1ZV.';
  return undefined;
}

/** The state a GSTIN belongs to: its first two digits. */
export const stateOfGstin = (value: string) => GST_STATES[value.trim().slice(0, 2)];

export const pinProblem = (value: string) => (/^\d{6}$/.test(value.trim()) ? undefined : 'Enter the 6-digit PIN code.');
