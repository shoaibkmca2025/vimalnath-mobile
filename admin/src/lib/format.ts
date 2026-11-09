/** ₹1,04,500 — Indian digit grouping, matching the mobile app's formatINR. */
export function formatINR(amount: number): string {
  const whole = String(Math.round(Math.abs(amount)));
  const lastThree = whole.slice(-3);
  const rest = whole.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${amount < 0 ? '−' : ''}₹${rest ? `${rest},` : ''}${lastThree}`;
}

/** ₹1.2L / ₹3.4Cr for tight spaces like stat tiles. */
export function formatINRCompact(amount: number): string {
  if (amount >= 1e7) return `₹${(amount / 1e7).toFixed(amount >= 1e8 ? 0 : 1)}Cr`;
  if (amount >= 1e5) return `₹${(amount / 1e5).toFixed(amount >= 1e6 ? 0 : 1)}L`;
  return formatINR(amount);
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-IN').format(value);
}

const dateFormat = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const dateTimeFormat = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const dayFormat = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' });

export const formatDate = (iso: string) => dateFormat.format(new Date(iso));
export const formatDateTime = (iso: string) => dateTimeFormat.format(new Date(iso));
export const formatDay = (date: Date) => dayFormat.format(date);

/** "Today", "Yesterday", "3 days ago", then the date. */
export function formatRelativeDay(iso: string, now = new Date()): string {
  const start = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((start(now) - start(new Date(iso))) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return formatDate(iso);
}

export const plural = (count: number, one: string, many = `${one}s`) => `${formatNumber(count)} ${count === 1 ? one : many}`;

export const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('');

const weekdayFormat = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
export const formatWeekday = (date: Date) => weekdayFormat.format(date);

/** "Just now", "12 min ago", "3 h ago", "Yesterday", then the date. */
export function formatRelativeTime(iso: string, now = Date.now()): string {
  const minutes = Math.round((now - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 60 * 12) return `${Math.round(minutes / 60)} h ago`;
  return formatRelativeDay(iso, new Date(now));
}

/** 5 h, 1.4 days. */
export const formatHours = (hours: number) => (hours < 24 ? `${Math.max(1, Math.round(hours))} h` : `${(hours / 24).toFixed(1)} days`);

export const formatPercent = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : '—');

/** For the middle of a sentence: "today", "3 days ago", "on 12 Oct 2026". */
export function relativePhrase(relative: string): string {
  return /^\d{1,2} \w{3,4} \d{4}$/.test(relative) ? `on ${relative}` : relative.charAt(0).toLowerCase() + relative.slice(1);
}
