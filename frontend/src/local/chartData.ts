/**
 * Data shaped for the overview charts: where the energy goes, every day's
 * profile, and weekly totals. All from valid readings only; missing half
 * hours are left out, never counted as zero.
 */
import { dayOfWeek } from './dates';
import { INTERVAL_HOURS, isValid, SLOTS, type Frame } from './frame';
import type { DayPlan } from './calendar';

export interface EnergySplit {
  /** Up to the base load reference in every valid half hour: load that never switches off. */
  base: number;
  /** Above the reference while the site is open. */
  openAbove: number;
  /** Above the reference while the site should be closed: the closed-hours excess. */
  closedAbove: number;
  total: number;
}

/** Split all valid consumption into base load, open-hours use above it, and closed-hours excess. The three add up to the total. */
export function energySplit(f: Frame, plans: DayPlan[], refKw: number, rows: number[][] = f.rows): EnergySplit {
  const cap = refKw * INTERVAL_HOURS;
  let base = 0; let openAbove = 0; let closedAbove = 0;
  for (let i = 0; i < f.dates.length; i++) {
    for (let s = 0; s < SLOTS; s++) {
      if (!isValid(f, i, s)) continue;
      const v = Math.max(0, rows[i][s]);
      base += Math.min(v, cap);
      const above = Math.max(0, v - cap);
      if (plans[i].open[s]) openAbove += above; else closedAbove += above;
    }
  }
  return { base, openAbove, closedAbove, total: base + openAbove + closedAbove };
}

export type DayFilter = 'all' | 'open' | 'closed' | 'weekdays' | 'weekends';

export const DAY_FILTER_LABEL: Record<DayFilter, string> = {
  all: 'All days', open: 'Days the site opens', closed: 'Closed days', weekdays: 'Mon to Fri', weekends: 'Sat and Sun',
};

export interface DayProfiles {
  /** kW per half hour for each chosen day; null where there is no valid reading. */
  days: { date: string; kw: (number | null)[] }[];
  avg: (number | null)[];
  max: (number | null)[];
  min: (number | null)[];
  /** Share of the chosen days on which each half hour is closed under the calendar. */
  closedShare: number[];
}

/** Every chosen day's profile with the average, highest and lowest in each half hour. `month` is 1-12 or 0 for all. */
export function dayProfiles(f: Frame, plans: DayPlan[], filter: DayFilter, month = 0, rows: number[][] = f.rows): DayProfiles {
  const keep = (i: number) => {
    const d = f.dates[i];
    if (month && Number(d.slice(5, 7)) !== month) return false;
    const opens = plans[i].open.some(Boolean);
    const dow = dayOfWeek(d);
    switch (filter) {
      case 'open': return opens;
      case 'closed': return !opens;
      case 'weekdays': return dow < 5;
      case 'weekends': return dow >= 5;
      default: return true;
    }
  };
  const days: DayProfiles['days'] = [];
  const sum = new Array(SLOTS).fill(0);
  const n = new Array(SLOTS).fill(0);
  const max: (number | null)[] = new Array(SLOTS).fill(null);
  const min: (number | null)[] = new Array(SLOTS).fill(null);
  const closed = new Array(SLOTS).fill(0);
  let count = 0;
  for (let i = 0; i < f.dates.length; i++) {
    if (!keep(i)) continue;
    count++;
    const kw: (number | null)[] = new Array(SLOTS);
    let any = false;
    for (let s = 0; s < SLOTS; s++) {
      if (!plans[i].open[s]) closed[s]++;
      if (!isValid(f, i, s)) { kw[s] = null; continue; }
      const v = rows[i][s] / INTERVAL_HOURS;
      kw[s] = v; any = true;
      sum[s] += v; n[s]++;
      max[s] = max[s] === null ? v : Math.max(max[s]!, v);
      min[s] = min[s] === null ? v : Math.min(min[s]!, v);
    }
    if (any) days.push({ date: f.dates[i], kw });
  }
  return {
    days,
    avg: sum.map((t, s) => (n[s] ? t / n[s] : null)),
    max, min,
    closedShare: closed.map((c) => (count ? c / count : 0)),
  };
}

export interface WeekTotal {
  /** Monday of the week. */
  start: string;
  kwh: number;
  validHalfHours: number;
  /** Valid share of the week's 336 half hours. */
  coverage: number;
}

/** Totals for each Monday-to-Sunday week that has any data. */
export function weeklyTotals(f: Frame, rows: number[][] = f.rows): WeekTotal[] {
  const out = new Map<string, WeekTotal>();
  f.dates.forEach((d, i) => {
    const dow = dayOfWeek(d);
    const monday = new Date(`${d}T00:00:00Z`);
    monday.setUTCDate(monday.getUTCDate() - dow);
    const key = monday.toISOString().slice(0, 10);
    let w = out.get(key);
    if (!w) { w = { start: key, kwh: 0, validHalfHours: 0, coverage: 0 }; out.set(key, w); }
    for (let s = 0; s < SLOTS; s++) if (isValid(f, i, s)) { w.kwh += rows[i][s]; w.validHalfHours++; }
  });
  return [...out.values()].filter((w) => w.validHalfHours > 0).sort((a, b) => a.start.localeCompare(b.start))
    .map((w) => ({ ...w, coverage: w.validHalfHours / (7 * SLOTS) }));
}
