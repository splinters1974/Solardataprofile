/**
 * England and Wales bank holidays, computed rather than tabulated.
 * Port of backend/app/services/bank_holidays.py.
 */
import { addDays, dayOfWeek, iso } from './dates';

function easterSunday(year: number): string {
  // Anonymous Gregorian computus.
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return iso(year, month, day);
}

/** Shift a weekend date to the following Monday or Tuesday. */
function nextWeekday(day: string): string {
  let out = day;
  while (dayOfWeek(out) >= 5) out = addDays(out, 1);
  return out;
}

function firstMonday(year: number, month: number): string {
  const first = iso(year, month, 1);
  return addDays(first, (7 - dayOfWeek(first)) % 7);
}

function lastMonday(year: number, month: number): string {
  const last = month < 12
    ? addDays(iso(year, month + 1, 1), -1)
    : iso(year, 12, 31);
  return addDays(last, -dayOfWeek(last));
}

// One-off royal and jubilee holidays. Not derivable, so listed.
const EXTRAS: Record<number, string[]> = {
  2011: ['2011-04-29'],
  2012: ['2012-06-05'],
  2022: ['2022-06-03', '2022-09-19'],
  2023: ['2023-05-08'],
};

// Regular holidays moved by proclamation: the usual date was a working day.
const MOVED: Record<number, [string, string][]> = {
  2012: [['2012-05-28', '2012-06-04']], // Spring, for the Diamond Jubilee
  2020: [['2020-05-04', '2020-05-08']], // Early May, for VE Day 75
  2022: [['2022-05-30', '2022-06-02']], // Spring, for the Platinum Jubilee
};

const cache = new Map<number, Set<string>>();

export function holidaysForYear(year: number): Set<string> {
  const hit = cache.get(year);
  if (hit) return hit;

  const easter = easterSunday(year);
  const days = new Set<string>([
    nextWeekday(iso(year, 1, 1)),
    addDays(easter, -2),
    addDays(easter, 1),
    firstMonday(year, 5),
    lastMonday(year, 5),
    lastMonday(year, 8),
  ]);

  // Boxing Day must land after Christmas, hence the sequencing.
  const christmas = nextWeekday(iso(year, 12, 25));
  let boxing = nextWeekday(iso(year, 12, 26));
  if (boxing <= christmas) boxing = nextWeekday(addDays(christmas, 1));
  days.add(christmas);
  days.add(boxing);

  for (const d of EXTRAS[year] ?? []) days.add(d);
  for (const [from, to] of MOVED[year] ?? []) {
    days.delete(from);
    days.add(to);
  }
  cache.set(year, days);
  return days;
}

export function holidaysBetween(start: string, end: string): Set<string> {
  const out = new Set<string>();
  const y0 = Number(start.slice(0, 4));
  const y1 = Number(end.slice(0, 4));
  for (let y = y0; y <= y1; y++) {
    for (const d of holidaysForYear(y)) {
      if (d >= start && d <= end) out.add(d);
    }
  }
  return out;
}
