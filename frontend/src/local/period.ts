/**
 * Turning an analysis period choice into dates for one file.
 */
import { addDays, fmtDayMonYear } from './dates';
import type { AnalysisPeriod } from './site';

export interface PeriodRange {
  from: string;
  to: string;
  /** What the user sees, e.g. "Last 12 months". */
  label: string;
  fileFrom: string;
  fileTo: string;
  /** True when the period is shorter than the file. */
  trimmed: boolean;
}

/** Days in a 12-month period ending on (and including) a date. */
const YEAR_DAYS = 365;

/** A file is "more than a year" when it runs past 12 months plus a few weeks' slack. */
export const isMultiYear = (fileFrom: string, fileTo: string) => !!fileFrom && fileFrom < addDays(fileTo, -(YEAR_DAYS + 30));

/** The day after the same date a year earlier: 30 Sep 2025 gives 1 Oct 2024 (calendar months, leap years handled). */
export function yearStart(to: string): string {
  const y = Number(to.slice(0, 4)) - 1;
  const md = to.slice(5);
  const sameDay = md === '02-29' ? `${y}-02-28` : `${y}-${md}`;
  return addDays(sameDay, 1);
}

/** How many complete-or-partial 12-month blocks, counting back from the end of the file, the file holds. */
export function yearBlocks(fileFrom: string, fileTo: string): { from: string; to: string }[] {
  const out: { from: string; to: string }[] = [];
  let to = fileTo;
  while (to >= fileFrom && out.length < 10) {
    const from = yearStart(to);
    out.push({ from: from < fileFrom ? fileFrom : from, to });
    to = addDays(from, -1);
  }
  return out;
}

export function periodRange(dates: string[], p: AnalysisPeriod): PeriodRange {
  const fileFrom = dates[0] ?? '';
  const fileTo = dates[dates.length - 1] ?? '';
  const whole = { from: fileFrom, to: fileTo };
  let r = whole;
  let label = 'Whole file';
  if (p.mode === 'last12' || (p.mode === 'year' && !p.yearsBack)) {
    r = yearBlocks(fileFrom, fileTo)[0] ?? whole;
    label = 'Last 12 months';
  } else if (p.mode === 'year') {
    const b = yearBlocks(fileFrom, fileTo)[p.yearsBack ?? 0];
    r = b ?? whole;
    label = b ? `12 months to ${fmtDayMonYear(b.to)}` : 'Whole file';
  } else if (p.mode === 'custom' && p.from && p.to && p.from <= p.to) {
    r = { from: p.from < fileFrom ? fileFrom : p.from, to: p.to > fileTo ? fileTo : p.to };
    label = 'Custom period';
  }
  const trimmed = r.from > fileFrom || r.to < fileTo;
  if (!trimmed && p.mode === 'last12') label = 'Whole file (a year or less)';
  return { ...r, label, fileFrom, fileTo, trimmed };
}
