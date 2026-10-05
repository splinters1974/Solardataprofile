/**
 * Usage overview and HH Analyser maths, in the browser.
 *
 * Ports of backend/app/services/usage_analytics.py and hh_analytics.py.
 * Demand is in kW throughout: a half-hourly reading of X kWh is an average
 * of 2X kW across that half hour.
 */
import type {
  AnalyserSummary, DayNightResponse, DayProfileResponse, HeatmapData,
  LoadDurationResponse, MonthlyTotal, ProfileSeries, ScatterResponse,
  WeekOption, WeekResponse, DailyPoint, HHPoint,
} from '../types';
import {
  addDays, dayOfWeek, fmtDayMonYear, fmtDowDayMon, fmtMonYear,
  monthsBetween,
} from './dates';
import { holidaysBetween } from './holidays';
import { blankSet, type Frame } from './parser';

export const KW_PER_KWH_PER_HH = 2;
export const DEFAULT_NIGHT_START_SLOT = 0;
export const DEFAULT_NIGHT_END_SLOT = 14;

const DOW_LABELS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday',
  'Saturday', 'Sunday'];

export const round = (v: number, dp = 0) => {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
};

const sum = (xs: number[]) => xs.reduce((s, v) => s + v, 0);

export function hhLabels(): string[] {
  const out: string[] = [];
  for (let h = 0; h < 24; h++) {
    for (const m of [0, 30]) out.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
  }
  return out;
}

/** The date-range filter every chart has. */
export function slice(frame: Frame, from?: string, to?: string): Frame {
  if (!from && !to) return frame;
  const dates: string[] = [];
  const rows: number[][] = [];
  frame.dates.forEach((d, i) => {
    if ((from && d < from) || (to && d > to)) return;
    dates.push(d);
    rows.push(frame.rows[i]);
  });
  return { dates, rows, blanks: frame.blanks };
}

function meanRows(rows: number[][], scale = 1): number[] {
  const out = new Array(48).fill(0);
  for (const r of rows) for (let s = 0; s < 48; s++) out[s] += r[s];
  return out.map((v) => (v / rows.length) * scale);
}

type DayClass = 'Weekday' | 'Weekend' | 'Bank holiday';

function classifyDays(dates: string[], excludeHolidays: boolean): DayClass[] {
  const holidays = excludeHolidays && dates.length
    ? holidaysBetween(dates[0], dates[dates.length - 1])
    : new Set<string>();
  return dates.map((d) => {
    if (holidays.has(d)) return 'Bank holiday';
    return dayOfWeek(d) >= 5 ? 'Weekend' : 'Weekday';
  });
}

// --- Upload overview ------------------------------------------------------

export function hhSeries(frame: Frame): HHPoint[] {
  const labels = hhLabels();
  const out: HHPoint[] = [];
  frame.dates.forEach((d, i) => {
    const r = frame.rows[i];
    for (let s = 0; s < 48; s++) out.push({ datetime: `${d}T${labels[s]}`, kwh: round(r[s], 3) });
  });
  return out;
}

export function dailySeries(frame: Frame): DailyPoint[] {
  return frame.dates.map((d, i) => ({ date: d, kwh: round(sum(frame.rows[i]), 2) }));
}

/** Per calendar month, including empty months inside a gap. */
function monthlyBuckets(frame: Frame, value: (row: number[]) => number) {
  if (!frame.dates.length) return [];
  const months = monthsBetween(frame.dates[0], frame.dates[frame.dates.length - 1]);
  const index = new Map(months.map((m, i) => [m.key, i]));
  const totals = months.map((m) => ({ ...m, total: 0, days: 0 }));
  frame.dates.forEach((d, i) => {
    const b = totals[index.get(d.slice(0, 7))!];
    b.total += value(frame.rows[i]);
    b.days += 1;
  });
  return totals;
}

export function monthlyTotals(frame: Frame): MonthlyTotal[] {
  return monthlyBuckets(frame, sum).map((b) => ({ month: b.key, kwh: round(b.total, 2) }));
}

export function heatmapMatrix(frame: Frame): HeatmapData {
  const matrix: number[][] = [];
  for (let dow = 0; dow < 7; dow++) {
    const rows = frame.rows.filter((_, i) => dayOfWeek(frame.dates[i]) === dow);
    matrix.push(rows.length ? meanRows(rows).map((v) => round(v, 4)) : new Array(48).fill(0));
  }
  return {
    dow_labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    hh_labels: hhLabels(),
    matrix,
  };
}

// --- HH Analyser ----------------------------------------------------------

export function dayOfWeekProfile(
  frame: Frame, from?: string, to?: string, excludeHolidays = true,
): DayProfileResponse {
  const w = slice(frame, from, to);
  if (!w.dates.length) return { labels: hhLabels(), series: [], day_counts: {} };

  const classes = classifyDays(w.dates, excludeHolidays);
  const series: ProfileSeries[] = [];
  const counts: Record<string, number> = {};
  const values = (rows: number[][]) =>
    meanRows(rows, KW_PER_KWH_PER_HH).map((v) => round(v, 2));

  DOW_LABELS.forEach((name, i) => {
    const rows = w.rows.filter((_, k) => dayOfWeek(w.dates[k]) === i);
    counts[name] = rows.length;
    if (rows.length) series.push({ name, group: 'day', values: values(rows) });
  });

  for (const name of ['Weekday', 'Weekend', 'Bank holiday'] as const) {
    const rows = w.rows.filter((_, k) => classes[k] === name);
    counts[name] = rows.length;
    if (rows.length) series.push({ name, group: 'summary', values: values(rows) });
  }

  counts.Total = w.rows.length;
  series.push({ name: 'Total', group: 'summary', values: values(w.rows) });
  return { labels: hhLabels(), series, day_counts: counts };
}

export function loadDurationCurve(
  frame: Frame, from?: string, to?: string, points = 250,
): LoadDurationResponse {
  const w = slice(frame, from, to);
  const kw: number[] = [];
  // Blank half hours in the file are not readings, so they stay off the curve.
  w.rows.forEach((r, i) => {
    const skip = blankSet(w, w.dates[i]);
    r.forEach((v, s) => { if (!Number.isNaN(v) && !skip?.has(s)) kw.push(v * KW_PER_KWH_PER_HH); });
  });
  if (!kw.length) {
    return { curve: [], peak_kw: 0, base_kw: 0, average_kw: 0, load_factor: 0, hours_covered: 0 };
  }
  kw.sort((a, b) => b - a);
  const totalHours = kw.length / 2;
  // Annualise so the x axis reads "hours per year" whatever the upload spans.
  const scale = totalHours ? 8766 / totalHours : 1;

  let idx: number[];
  if (kw.length <= points) {
    idx = kw.map((_, i) => i);
  } else {
    const step = (kw.length - 1) / (points - 1);
    const set = new Set<number>([0, kw.length - 1]);
    for (let i = 0; i < points; i++) set.add(Math.trunc(i * step));
    idx = [...set].sort((a, b) => a - b);
  }

  const peak = kw[0];
  const average = sum(kw) / kw.length;
  return {
    curve: idx.map((i) => ({ hours: round(((i + 1) / 2) * scale, 1), kw: round(kw[i], 2) })),
    peak_kw: round(peak, 2),
    base_kw: round(kw[kw.length - 1], 2),
    average_kw: round(average, 2),
    load_factor: peak > 0 ? round(average / peak, 4) : 0,
    hours_covered: round(totalHours, 1),
  };
}

export function dayNightSplit(
  frame: Frame, from?: string, to?: string,
  nightStart = DEFAULT_NIGHT_START_SLOT, nightEnd = DEFAULT_NIGHT_END_SLOT,
): DayNightResponse {
  const w = slice(frame, from, to);
  if (!w.dates.length) {
    return { months: [], night_window: '', totals: { day_kwh: 0, night_kwh: 0, night_share: 0 } };
  }

  // Wraps midnight when start > end, for a 23:30-06:30 style tariff.
  const isNight = (s: number) => (nightStart <= nightEnd
    ? s >= nightStart && s < nightEnd
    : s >= nightStart || s < nightEnd);
  const nightOf = (r: number[]) => r.reduce((t, v, s) => (isNight(s) ? t + v : t), 0);
  const dayOf = (r: number[]) => r.reduce((t, v, s) => (isNight(s) ? t : t + v), 0);

  const night = monthlyBuckets(w, nightOf);
  const day = monthlyBuckets(w, dayOf);

  const months = day.map((b, i) => ({
    month: fmtMonYear(b.y, b.m),
    day_kwh: round(b.total, 1),
    night_kwh: round(night[i].total, 1),
    days: b.days,
    // Partial months distort a month-on-month comparison, so flag them.
    complete: b.days >= 26,
  }));

  const totalDay = sum(day.map((b) => b.total));
  const totalNight = sum(night.map((b) => b.total));
  const total = totalDay + totalNight;
  const labels = hhLabels();
  return {
    months,
    night_window: `${labels[nightStart]} to ${labels[nightEnd % 48]}`,
    totals: {
      day_kwh: round(totalDay, 1),
      night_kwh: round(totalNight, 1),
      night_share: total ? round(totalNight / total, 4) : 0,
    },
  };
}

export function weekProfile(frame: Frame, weekCommencing?: string): WeekResponse {
  if (!frame.dates.length) return { labels: hhLabels(), days: [], week_commencing: null };
  let start = weekCommencing || frame.dates[0];
  start = addDays(start, -dayOfWeek(start)); // snap to Monday
  const end = addDays(start, 7);

  const days = frame.dates
    .map((d, i) => ({ d, r: frame.rows[i] }))
    .filter(({ d }) => d >= start && d < end)
    .map(({ d, r }) => ({
      date: d,
      label: fmtDowDayMon(d),
      values: r.map((v) => round(v * KW_PER_KWH_PER_HH, 2)),
      total_kwh: round(sum(r), 1),
    }));
  return { labels: hhLabels(), days, week_commencing: start };
}

export function availableWeeks(frame: Frame): WeekOption[] {
  if (!frame.dates.length) return [];
  const first = frame.dates[0];
  const last = frame.dates[frame.dates.length - 1];
  const out: WeekOption[] = [];
  for (let d = addDays(first, -dayOfWeek(first)); d <= last; d = addDays(d, 7)) {
    out.push({ value: d, label: fmtDayMonYear(d) });
  }
  return out;
}

/**
 * Every reading as load against time of day. Thinned by whole days, never
 * by individual readings: striding through the flattened array lands on
 * the same half hours each day and the chart collapses into bands.
 */
export function fullYearScatter(
  frame: Frame, excludeHolidays = true, maxPoints = 6000,
): ScatterResponse {
  const n = frame.dates.length;
  if (!n) return { points: [], sampled: false, total_readings: 0 };

  const classes = classifyDays(frame.dates, excludeHolidays);
  const daysWanted = Math.max(1, Math.floor(maxPoints / 48));
  const sampled = n > daysWanted;
  const step = sampled ? Math.ceil(n / daysWanted) : 1;

  const points: ScatterResponse['points'] = [];
  frame.dates.forEach((d, i) => {
    // Bank holidays always survive: an even sample misses most of them and
    // they show a closed site's true base load.
    if (sampled && i % step !== 0 && classes[i] !== 'Bank holiday') return;
    frame.rows[i].forEach((v, s) => {
      points.push({
        hour: round(s / 2, 2),
        kw: round(v * KW_PER_KWH_PER_HH, 2),
        type: classes[i],
        date: d,
      });
    });
  });
  return { points, sampled, total_readings: n * 48 };
}

export function summaryStats(frame: Frame): AnalyserSummary {
  const labels = hhLabels();
  let peak = -Infinity;
  let base = Infinity;
  let peakAt = [0, 0];
  let total = 0;
  let count = 0;
  const partDay = frame.dates.map((d) => (frame.blanks?.get(d)?.length ?? 0) > 0);
  frame.rows.forEach((r, i) => {
    const skip = blankSet(frame, frame.dates[i]);
    r.forEach((v, s) => {
      if (v > peak) { peak = v; peakAt = [i, s]; }
      if (v < base && !skip?.has(s)) base = v;
      total += v;
      count += 1;
    });
  });
  if (base === Infinity) base = 0;

  // The lowest day is chosen from complete days, so a part-recorded day is
  // not reported as the quietest.
  const daily = frame.rows.map(sum);
  let hi = 0;
  let lo = partDay.findIndex((p) => !p);
  if (lo < 0) lo = 0;
  daily.forEach((v, i) => {
    if (v > daily[hi]) hi = i;
    if (v < daily[lo] && !partDay[i]) lo = i;
  });

  const peakKw = peak * KW_PER_KWH_PER_HH;
  const averageKw = (total / count) * KW_PER_KWH_PER_HH;
  return {
    days: frame.dates.length,
    total_kwh: round(total, 1),
    peak_kw: round(peakKw, 2),
    peak_when: `${fmtDayMonYear(frame.dates[peakAt[0]])} at ${labels[peakAt[1]]}`,
    average_kw: round(averageKw, 2),
    base_kw: round(base * KW_PER_KWH_PER_HH, 2),
    load_factor: peakKw ? round(averageKw / peakKw, 4) : 0,
    highest_day_kwh: round(daily[hi], 1),
    highest_day: fmtDayMonYear(frame.dates[hi]),
    lowest_day_kwh: round(daily[lo], 1),
    lowest_day: fmtDayMonYear(frame.dates[lo]),
    average_day_kwh: round(sum(daily) / daily.length, 1),
  };
}

