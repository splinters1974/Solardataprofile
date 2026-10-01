/**
 * Calendar helpers for the standalone build.
 *
 * Everything is done in UTC on plain "YYYY-MM-DD" strings. Meter data is a
 * list of calendar days, not instants, and using local time would let a
 * clock change shift a day across midnight.
 */

const DAY_MS = 86_400_000;

export const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const pad = (n: number) => String(n).padStart(2, '0');

export function iso(y: number, m: number, d: number): string {
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** Days since 1970-01-01 for an ISO date. */
export function dayNum(date: string): number {
  const [y, m, d] = date.slice(0, 10).split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

export function fromDayNum(n: number): string {
  const t = new Date(n * DAY_MS);
  return iso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

export function addDays(date: string, days: number): string {
  return fromDayNum(dayNum(date) + days);
}

/** Monday = 0 ... Sunday = 6, matching pandas' dayofweek. */
export function dayOfWeek(date: string): number {
  return (new Date(dayNum(date) * DAY_MS).getUTCDay() + 6) % 7;
}

export function parts(date: string): { y: number; m: number; d: number } {
  const [y, m, d] = date.slice(0, 10).split('-').map(Number);
  return { y, m, d };
}

export function isValidDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || y < 1900 || y > 2200) return false;
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/** "01 Jan 2024" */
export function fmtDayMonYear(date: string): string {
  const { y, m, d } = parts(date);
  return `${pad(d)} ${MONTHS_SHORT[m - 1]} ${y}`;
}

/** "Mon 01 Jan" */
export function fmtDowDayMon(date: string): string {
  const { m, d } = parts(date);
  return `${DAYS_SHORT[dayOfWeek(date)]} ${pad(d)} ${MONTHS_SHORT[m - 1]}`;
}

/** "Jan 2024" */
export function fmtMonYear(y: number, m: number): string {
  return `${MONTHS_SHORT[m - 1]} ${y}`;
}

/** "01 January 2024", for report cover lines. */
export function fmtLong(d: Date): string {
  return `${pad(d.getDate())} ${MONTHS_LONG[d.getMonth()]} ${d.getFullYear()}`;
}

/** Every calendar month from the first date's to the last's, gaps included. */
export function monthsBetween(first: string, last: string): { y: number; m: number; key: string }[] {
  const a = parts(first);
  const b = parts(last);
  const out: { y: number; m: number; key: string }[] = [];
  let y = a.y;
  let m = a.m;
  while (y < b.y || (y === b.y && m <= b.m)) {
    out.push({ y, m, key: `${y}-${pad(m)}` });
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}
