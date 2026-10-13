/**
 * Usage overview and HH Analyser maths, in the browser.
 *
 * Ports of backend/app/services/usage_analytics.py and hh_analytics.py, with
 * one deliberate difference: readings flagged as missing or excluded are
 * left out, never counted as zero. Averages divide by the readings present.
 *
 * Demand is in kW: kW = interval kWh / interval hours, so a 30-minute reading
 * of 50 kWh is an average of 100 kW across that half hour.
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
import {
  dayKwh, INTERVAL_HOURS, isCompleteDay, isValid, SLOTS, sliceFrame, type Frame,
} from './frame';

/** kW per kWh for a half-hour reading (1 / interval hours). */
export const KW_PER_KWH_PER_HH = 1 / INTERVAL_HOURS;
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
export const slice = sliceFrame;

/** Mean of valid readings in each slot across the given days. Slots with none read 0. */
function meanValid(f: Frame, idx: number[], scale = 1): number[] {
  const tot = new Array(SLOTS).fill(0);
  const n = new Array(SLOTS).fill(0);
  for (const i of idx) {
    const r = f.rows[i];
    for (let s = 0; s < SLOTS; s++) if (isValid(f, i, s)) { tot[s] += r[s]; n[s]++; }
  }
  return tot.map((v, s) => (n[s] ? (v / n[s]) * scale : 0));
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
    for (let s = 0; s < SLOTS; s++) {
      if (isValid(frame, i, s)) out.push({ datetime: `${d}T${labels[s]}`, kwh: round(r[s], 3) });
    }
  });
  return out;
}

export function dailySeries(frame: Frame): DailyPoint[] {
  return frame.dates.map((d, i) => ({ date: d, kwh: round(dayKwh(frame, i), 2) }));
}

/** Per calendar month, including empty months inside a gap. */
function monthlyBuckets(frame: Frame, value: (i: number) => number) {
  if (!frame.dates.length) return [];
  const months = monthsBetween(frame.dates[0], frame.dates[frame.dates.length - 1]);
  const index = new Map(months.map((m, i) => [m.key, i]));
  const totals = months.map((m) => ({ ...m, total: 0, days: 0 }));
  frame.dates.forEach((d, i) => {
    const b = totals[index.get(d.slice(0, 7))!];
    b.total += value(i);
    b.days += 1;
  });
  return totals;
}

export function monthlyTotals(frame: Frame): MonthlyTotal[] {
  return monthlyBuckets(frame, (i) => dayKwh(frame, i)).map((b) => ({ month: b.key, kwh: round(b.total, 2) }));
}

export function heatmapMatrix(frame: Frame): HeatmapData {
  const matrix: number[][] = [];
  for (let dow = 0; dow < 7; dow++) {
    const idx = frame.dates.flatMap((d, i) => (dayOfWeek(d) === dow ? [i] : []));
    matrix.push(idx.length ? meanValid(frame, idx).map((v) => round(v, 4)) : new Array(SLOTS).fill(0));
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
  const values = (idx: number[]) => meanValid(w, idx, KW_PER_KWH_PER_HH).map((v) => round(v, 2));

  DOW_LABELS.forEach((name, d) => {
    const idx = w.dates.flatMap((x, k) => (dayOfWeek(x) === d ? [k] : []));
    counts[name] = idx.length;
    if (idx.length) series.push({ name, group: 'day', values: values(idx) });
  });

  for (const name of ['Weekday', 'Weekend', 'Bank holiday'] as const) {
    const idx = classes.flatMap((c, k) => (c === name ? [k] : []));
    counts[name] = idx.length;
    if (idx.length) series.push({ name, group: 'summary', values: values(idx) });
  }

  counts.Total = w.dates.length;
  series.push({ name: 'Total', group: 'summary', values: values(w.dates.map((_, k) => k)) });
  return { labels: hhLabels(), series, day_counts: counts };
}

export function loadDurationCurve(
  frame: Frame, from?: string, to?: string, points = 250,
): LoadDurationResponse {
  const w = slice(frame, from, to);
  const kw: number[] = [];
  // Missing and excluded half hours are not readings, so they stay off the curve.
  w.rows.forEach((r, i) => {
    for (let s = 0; s < SLOTS; s++) if (isValid(w, i, s)) kw.push(r[s] * KW_PER_KWH_PER_HH);
  });
  if (!kw.length) {
    return { curve: [], peak_kw: 0, base_kw: 0, average_kw: 0, load_factor: 0, hours_covered: 0 };
  }
  kw.sort((a, b) => b - a);
  const totalHours = kw.length * INTERVAL_HOURS;
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
    curve: idx.map((i) => ({ hours: round((i + 1) * INTERVAL_HOURS * scale, 1), kw: round(kw[i], 2) })),
    peak_kw: round(peak, 2),
    // The lowest valid half-hour, not the 5th-percentile base load reference.
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
  const part = (night: boolean) => (i: number) => {
    let t = 0;
    for (let s = 0; s < SLOTS; s++) if (isNight(s) === night && isValid(w, i, s)) t += w.rows[i][s];
    return t;
  };

  const night = monthlyBuckets(w, part(true));
  const day = monthlyBuckets(w, part(false));

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
    night_window: `${labels[nightStart]} to ${labels[nightEnd % SLOTS]}`,
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
    .map((d, i) => ({ d, i }))
    .filter(({ d }) => d >= start && d < end)
    .map(({ d, i }) => ({
      date: d,
      label: fmtDowDayMon(d),
      // Missing readings break the line rather than drop it to zero.
      values: frame.rows[i].map((v, s) => (isValid(frame, i, s) ? round(v * KW_PER_KWH_PER_HH, 2) : null)),
      total_kwh: round(dayKwh(frame, i), 1),
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
  const daysWanted = Math.max(1, Math.floor(maxPoints / SLOTS));
  const sampled = n > daysWanted;
  const step = sampled ? Math.ceil(n / daysWanted) : 1;

  const points: ScatterResponse['points'] = [];
  let total = 0;
  frame.dates.forEach((d, i) => {
    for (let s = 0; s < SLOTS; s++) if (isValid(frame, i, s)) total++;
    // Bank holidays always survive: an even sample misses most of them and
    // they show a closed site's true base load.
    if (sampled && i % step !== 0 && classes[i] !== 'Bank holiday') return;
    frame.rows[i].forEach((v, s) => {
      if (!isValid(frame, i, s)) return;
      points.push({
        hour: round(s * INTERVAL_HOURS, 2),
        kw: round(v * KW_PER_KWH_PER_HH, 2),
        type: classes[i],
        date: d,
      });
    });
  });
  return { points, sampled, total_readings: total };
}

export function summaryStats(frame: Frame): AnalyserSummary {
  const labels = hhLabels();
  let peak = -Infinity;
  let base = Infinity;
  let peakAt = [0, 0];
  let total = 0;
  let count = 0;
  frame.rows.forEach((r, i) => {
    for (let s = 0; s < SLOTS; s++) {
      if (!isValid(frame, i, s)) continue;
      const v = r[s];
      if (v > peak) { peak = v; peakAt = [i, s]; }
      if (v < base) base = v;
      total += v;
      count += 1;
    }
  });
  if (!count) { peak = 0; base = 0; }

  // Highest and lowest days are chosen from complete days, so a part-recorded
  // day is not reported as the quietest.
  const daily = frame.rows.map((_, i) => dayKwh(frame, i));
  const complete = frame.dates.map((_, i) => isCompleteDay(frame, i));
  let hi = complete.findIndex(Boolean);
  let lo = hi;
  if (hi < 0) { hi = 0; lo = 0; }
  daily.forEach((v, i) => {
    if (!complete[i]) return;
    if (v > daily[hi]) hi = i;
    if (v < daily[lo]) lo = i;
  });
  const completeDays = complete.filter(Boolean).length;

  const peakKw = peak * KW_PER_KWH_PER_HH;
  const averageKw = count ? (total / count) * KW_PER_KWH_PER_HH : 0;
  return {
    days: frame.dates.length,
    total_kwh: round(total, 1),
    peak_kw: round(peakKw, 2),
    peak_when: frame.dates.length ? `${fmtDayMonYear(frame.dates[peakAt[0]])} at ${labels[peakAt[1]]}` : '',
    average_kw: round(averageKw, 2),
    base_kw: round(base * KW_PER_KWH_PER_HH, 2),
    load_factor: peakKw ? round(averageKw / peakKw, 4) : 0,
    highest_day_kwh: round(daily[hi] ?? 0, 1),
    highest_day: frame.dates.length ? fmtDayMonYear(frame.dates[hi]) : '',
    lowest_day_kwh: round(daily[lo] ?? 0, 1),
    lowest_day: frame.dates.length ? fmtDayMonYear(frame.dates[lo]) : '',
    // Average over complete days so part days do not drag it down.
    average_day_kwh: completeDays
      ? round(daily.filter((_, i) => complete[i]).reduce((a, b) => a + b, 0) / completeDays, 1)
      : 0,
  };
}
