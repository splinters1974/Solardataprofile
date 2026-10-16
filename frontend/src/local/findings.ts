/**
 * Per-site analysis: one calculation layer for the site screen, the
 * portfolio, the PDFs and the spreadsheets.
 *
 * Every figure comes from valid readings only. Observed figures cover the
 * period in the file; annual figures are an estimate, scaled from valid hours
 * to a year, shown only when there is enough data (or when deliberately
 * forced). £ figures are energy cost at the rates entered, associated with a
 * pattern of use. They are not savings: how much of a pattern can be removed
 * is an engineering judgement on site, and findings can overlap.
 *
 * Whole-site half-hourly data cannot show which equipment is responsible
 * for anything, so findings describe demand and suggest what to check.
 */
import { addDays, dayNum, dayOfWeek, fmtDayMonYear, monthsBetween, MONTHS_SHORT } from './dates';
import {
  coverage, dayKwh, dayValid, FLAG, flagAt, INTERVAL_HOURS, isCompleteDay, isValid, SLOTS,
  type Coverage, type Frame,
} from './frame';
import {
  DAY_CLASS_LABEL, isAlwaysOpen, isHoliday, planDays, slotTime, type DayClass, type DayPlan,
} from './calendar';
import { priceGrid, type PriceGrid } from './tariff';
import { DEFAULT_POWER_FACTOR, type DetectionSettings, type SiteSettings } from './site';
import type { QualityReport, Verdict } from './dataQuality';

export type Level = 'high' | 'medium' | 'low' | 'info';
export type Confidence = 'high' | 'medium' | 'low';

export type SiteTab = 'overview' | 'review' | 'calendar' | 'baseload' | 'heatmap'
  | 'anomalies' | 'scenarios' | 'capacity' | 'charts' | 'settings';

export interface EvidenceLink { label: string; tab: SiteTab; date?: string }

export interface CarbonFactor {
  /** kgCO2e per kWh. */
  kgPerKwh: number;
  year: string;
  source: string;
}

export interface Totals { kwh: number; cost: number; tco2e: number | null }

export interface Finding {
  key: string;
  title: string;
  /** What the data shows. */
  detail: string;
  /** What to check. Equipment is only ever a possible explanation. */
  investigation: string;
  /** Potential impact, separate from confidence. */
  level: Level;
  confidence: Confidence;
  confidenceReasons: string[];
  evidence: string[];
  /** The calculation, step by step. */
  calc: string[];
  period: { from: string; to: string };
  kwh?: { observed: number; annual: number | null };
  /** Energy cost associated with the pattern, at the rates entered. Not a saving. */
  cost?: { observed: number; annual: number | null };
  kw?: number;
  /** Relies on the opening hours being right. */
  calendarDependent: boolean;
  links: EvidenceLink[];
  /** Other findings that overlap with this one: do not add them together. */
  related: string[];
}

export interface Annualisation {
  mode: 'off' | 'indicative' | 'full';
  forced: boolean;
  /** Multiply observed totals by this for an annual estimate. Null when off. */
  factor: number | null;
  validDays: number;
  method: string;
  warning: string | null;
}

export interface Reference {
  kw: number;
  samples: number;
  label: string;
  method: string;
}

export interface ClassSplit {
  cls: DayClass;
  label: string;
  closedKwh: number;
  closedHours: number;
  excessAll: number;
  excessClosed: number | null;
}

export interface ExcessResult {
  reference: 'all' | 'closed';
  refKw: number;
  label: string;
  observed: Totals;
  annual: Totals | null;
  intervals: number;
  method: string;
}

export interface AnomalyEvent {
  date: string;
  dayLabel: string;
  direction: 'high' | 'low';
  actualKwh: number;
  expectedKwh: number;
  deviation: number;
  baselineFrom: string;
  baselineTo: string;
  samples: number;
  quality: string | null;
}

export interface ChangeEvent {
  from: string;
  to: string;
  direction: 'up' | 'down';
  flaggedDays: number;
  eligibleDays: number;
  meanDeviation: number;
  actualKwh: number;
  expectedKwh: number;
}

export interface AnomalyResult {
  events: AnomalyEvent[];
  changes: ChangeEvent[];
  checkedDays: number;
  notApplicable: number;
  notApplicableReasons: { insufficient: number; noVariation: number };
}

export interface PeakRow {
  date: string;
  slot: number;
  kw: number;
  kva: number;
  utilisation: number | null;
  open: boolean;
}

export interface MonthlyBase { key: string; month: string; kw: number; samples: number; excluded: number; thin: boolean }

export interface SiteMetrics {
  coverage: Coverage;
  annualisation: Annualisation;
  rate: { description: string; banded: boolean; problems: string[]; flatP: number };
  observed: Totals;
  annual: Totals | null;
  peak: { kw: number; date: string; slot: number; when: string };
  lowestKw: number;
  averageKw: number;
  loadFactor: number;
  baseAll: Reference;
  baseClosed: Reference | null;
  baseClosedNote: string;
  base: { observed: Totals; annual: Totals | null; share: number };
  hasClosed: boolean;
  open: { kwh: number; hours: number };
  closed: { kwh: number; hours: number; share: number };
  byClass: ClassSplit[];
  excessAll: ExcessResult | null;
  excessClosed: ExcessResult | null;
  /** The one chosen in settings, used for the ranking. */
  excess: ExcessResult | null;
  monthlyBase: MonthlyBase[];
  anomalies: AnomalyResult;
  peaks: PeakRow[];
  peakRecurrence: { share: number; halfHours: number; days: number };
  intensity: { floorAreaM2: number; kwhPerM2Annual: number | null; kwhPerM2Observed: number; openHours: number; kwhPerOpenHour: number | null } | null;
  findings: Finding[];
  /** Annual associated cost used to rank sites, or null when not annualised. */
  rankValue: number | null;
  qualityVerdict: Verdict;
}

// --- Helpers ------------------------------------------------------------------------

export function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))));
  return sorted[i];
}

function median(xs: number[]): number {
  return percentile([...xs].sort((a, b) => a - b), 0.5);
}

const round = (v: number, dp = 0) => { const f = 10 ** dp; return Math.round(v * f) / f; };
export const gbp = (v: number) => `£${Math.round(v).toLocaleString('en-GB')}`;
export const kwhFmt = (v: number) => `${Math.round(v).toLocaleString('en-GB')} kWh`;
export const kwFmt = (v: number) => `${v.toLocaleString('en-GB', { maximumFractionDigits: 1 })} kW`;
const pct = (v: number) => `${Math.round(v * 100)}%`;

const totals = (kwh: number, cost: number, carbon: CarbonFactor | null): Totals => ({
  kwh, cost, tco2e: carbon ? (kwh * carbon.kgPerKwh) / 1000 : null,
});
const scaleTotals = (t: Totals, f: number | null): Totals | null => (f === null ? null : {
  kwh: t.kwh * f, cost: t.cost * f, tco2e: t.tco2e === null ? null : t.tco2e * f,
});

export function annualisationFor(cov: Coverage, setting: SiteSettings['annualise']): Annualisation {
  const vd = cov.validDays;
  const factor = cov.validHours ? 8766 / cov.validHours : null;
  const method = `Observed kWh x 8,766 / ${Math.round(cov.validHours).toLocaleString('en-GB')} valid hours `
    + `(factor ${factor ? factor.toFixed(2) : 'n/a'}). Assumes the missing time looks like the time present; `
    + 'coverage alone does not make the seasons representative.';
  if (setting === 'off' || !factor) {
    return { mode: 'off', forced: false, factor: null, validDays: vd, method: 'Annual estimates switched off. Observed figures only.', warning: null };
  }
  if (setting === 'force') {
    return {
      mode: vd >= 330 ? 'full' : 'indicative', forced: vd < 180, factor, validDays: vd, method,
      warning: vd < 180 ? `Annualised by choice from only ${Math.round(vd)} days of valid readings. Seasonal effects are not captured; treat annual figures with care.` : null,
    };
  }
  if (vd < 180) {
    return { mode: 'off', forced: false, factor: null, validDays: vd, method: `Not annualised: only ${Math.round(vd)} days of valid readings (under 180). Observed figures only.`, warning: null };
  }
  if (vd < 330) {
    return { mode: 'indicative', forced: false, factor, validDays: vd, method, warning: `Indicative: annual figures scaled from ${Math.round(vd)} days of valid readings.` };
  }
  return { mode: 'full', forced: false, factor, validDays: vd, method, warning: null };
}

/** Potential impact, sized against the site's own energy cost. */
function impactFor(cost: number, totalCost: number): Level {
  const share = totalCost > 0 ? cost / totalCost : 0;
  if (share >= 0.1) return 'high';
  if (share >= 0.04) return 'medium';
  return 'low';
}

/** Evidence confidence, with the reasons that limit it. Separate from impact. */
export function confidenceFor(o: {
  verdict: Verdict; validDays: number; calendarDependent: boolean; confirmed: boolean;
  sample?: { n: number; min: number; what: string };
}): { level: Confidence; reasons: string[] } {
  const rank: Record<Confidence, number> = { high: 2, medium: 1, low: 0 };
  let level: Confidence = 'high';
  const reasons: string[] = [];
  const cap = (l: Confidence, why: string) => { reasons.push(why); if (rank[l] < rank[level]) level = l; };
  if (o.verdict === 'poor') cap('low', 'data quality is Poor');
  else if (o.verdict === 'check') cap('medium', 'data quality has items to check');
  if (o.validDays < 180) cap('low', `only ${Math.round(o.validDays)} days of valid readings`);
  else if (o.validDays < 330) cap('medium', `${Math.round(o.validDays)} days of valid readings, less than a year`);
  if (o.calendarDependent && !o.confirmed) cap('medium', 'opening hours not confirmed');
  if (o.sample && o.sample.n < o.sample.min) cap(o.sample.n < o.sample.min / 3 ? 'low' : 'medium', `small sample: ${o.sample.n} ${o.sample.what}`);
  if (!reasons.length) reasons.push('good data, a year or more of readings, hours confirmed');
  return { level, reasons };
}

// --- Anomalies ----------------------------------------------------------------------

const DOW_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** Comparable days: same weekday and same calendar class. */
const dayKey = (p: DayPlan) => (p.cls === 'weekday' || p.cls === 'saturday' || p.cls === 'sunday'
  ? `${p.dow}` : `${p.cls}-${p.dow}`);

export const dayKeyLabel = (p: DayPlan) => (p.cls === 'weekday' || p.cls === 'saturday' || p.cls === 'sunday'
  ? DOW_NAMES[p.dow] : `${DAY_CLASS_LABEL[p.cls].replace(/s$/, '')} (${DOW_NAMES[p.dow]})`);

/** Days usable as reference: complete, and not flagged by an unresolved quality check. */
export function referenceEligible(f: Frame, suspect: Map<string, string[]>) {
  return f.dates.map((d, i) => isCompleteDay(f, i) && !suspect.has(d));
}

/**
 * Unusual days and persistent changes against a matched baseline: the
 * previous N comparable days (same weekday and calendar class) that are
 * complete and not under a quality question.
 */
export function detectAnomalies(
  f: Frame, plans: DayPlan[], suspect: Map<string, string[]>, det: DetectionSettings,
): AnomalyResult {
  const eligible = referenceEligible(f, suspect);
  const totals = f.dates.map((_, i) => dayKwh(f, i));
  const history = new Map<string, number[]>(); // key -> indices of eligible days so far
  const events: AnomalyEvent[] = [];
  const devs: { i: number; dev: number; actual: number; expected: number }[] = [];
  let checked = 0;
  let insufficient = 0;
  let noVariation = 0;

  f.dates.forEach((d, i) => {
    const key = dayKey(plans[i]);
    const prior = history.get(key) ?? [];
    if (isCompleteDay(f, i)) {
      checked++;
      const base = prior.slice(-det.baselineDays);
      if (base.length < det.minDays) insufficient++;
      else {
        const vals = base.map((k) => totals[k]);
        const m = median(vals);
        const smad = 1.4826 * median(vals.map((v) => Math.abs(v - m)));
        if (smad <= 0 || m <= 0) noVariation++;
        else {
          const x = totals[i];
          const off = x - m;
          devs.push({ i, dev: off / m, actual: x, expected: m });
          if (Math.abs(off) > det.pct * m && Math.abs(off) > det.madMultiple * smad) {
            events.push({
              date: d, dayLabel: dayKeyLabel(plans[i]), direction: off > 0 ? 'high' : 'low',
              actualKwh: round(x, 1), expectedKwh: round(m, 1), deviation: off / m,
              baselineFrom: f.dates[base[0]], baselineTo: f.dates[base[base.length - 1]], samples: base.length,
              quality: suspect.get(d)?.join('; ') ?? null,
            });
          }
        }
      }
    }
    if (eligible[i]) { prior.push(i); history.set(key, prior); }
  });

  // Persistent change: at least persistDays of persistWindow consecutive eligible days off the baseline.
  const changes: ChangeEvent[] = [];
  const w = det.persistWindow;
  for (const dir of ['up', 'down'] as const) {
    const hit = devs.map((x) => (dir === 'up' ? x.dev >= det.persistPct : x.dev <= -det.persistPct));
    let cur: { a: number; b: number } | null = null;
    const spans: { a: number; b: number }[] = [];
    for (let k = 0; k + w <= devs.length; k++) {
      let n = 0;
      for (let j = k; j < k + w; j++) if (hit[j]) n++;
      if (n >= det.persistDays) {
        if (cur && k <= cur.b) cur.b = k + w - 1;
        else { if (cur) spans.push(cur); cur = { a: k, b: k + w - 1 }; }
      }
    }
    if (cur) spans.push(cur);
    for (const s of spans) {
      const part = devs.slice(s.a, s.b + 1);
      const flagged = part.filter((_, k) => hit[s.a + k]).length;
      changes.push({
        from: f.dates[part[0].i], to: f.dates[part[part.length - 1].i], direction: dir,
        flaggedDays: flagged, eligibleDays: part.length,
        meanDeviation: part.reduce((a, x) => a + x.dev, 0) / part.length,
        actualKwh: round(part.reduce((a, x) => a + x.actual, 0), 1),
        expectedKwh: round(part.reduce((a, x) => a + x.expected, 0), 1),
      });
    }
  }
  changes.sort((a, b) => (a.from < b.from ? -1 : 1));
  events.sort((a, b) => Math.abs(b.deviation) - Math.abs(a.deviation));
  return { events, changes, checkedDays: checked, notApplicable: insufficient + noVariation, notApplicableReasons: { insufficient, noVariation } };
}

/**
 * The reference profile for one day: the median kW in each half hour across
 * the previous comparable days that are complete and not under question.
 */
export function referenceProfile(
  f: Frame, plans: DayPlan[], i: number, suspect: Map<string, string[]>, n = 8,
): { kw: (number | null)[]; samples: number; from: string | null; to: string | null } {
  const eligible = referenceEligible(f, suspect);
  const key = dayKey(plans[i]);
  const idx: number[] = [];
  for (let k = i - 1; k >= 0 && idx.length < n; k--) if (eligible[k] && dayKey(plans[k]) === key) idx.push(k);
  idx.reverse();
  const kw = new Array(SLOTS).fill(null).map((_, s) => {
    const vals = idx.filter((k) => isValid(f, k, s)).map((k) => f.rows[k][s] / INTERVAL_HOURS);
    return vals.length ? round(median(vals), 2) : null;
  });
  return { kw, samples: idx.length, from: idx.length ? f.dates[idx[0]] : null, to: idx.length ? f.dates[idx[idx.length - 1]] : null };
}

// --- Period comparisons -----------------------------------------------------------

export interface PeriodTotal { from: string; to: string; daysInRange: number; validDays: number; kwh: number; coverage: number }
export interface Comparison {
  label: string;
  current: PeriodTotal;
  other: PeriodTotal;
  matchedDays: number;
  matchedNowKwh: number;
  matchedThenKwh: number;
  change: number | null;
  note: string;
}

function periodTotal(f: Frame, from: string, to: string): PeriodTotal {
  const span = dayNum(to) - dayNum(from) + 1;
  let valid = 0;
  let kwh = 0;
  let complete = 0;
  f.dates.forEach((d, i) => {
    if (d < from || d > to) return;
    valid += dayValid(f, i);
    kwh += dayKwh(f, i);
    if (isCompleteDay(f, i)) complete++;
  });
  const expected = span * SLOTS;
  return { from, to, daysInRange: span, validDays: complete, kwh, coverage: expected ? valid / expected : 0 };
}

/** The selected range against the previous equal-length period and the same weeks a year earlier. */
export function comparePeriods(f: Frame, from: string, to: string): Comparison[] {
  const span = dayNum(to) - dayNum(from) + 1;
  const shiftDate = (d: string, k: number) => {
    const t = new Date((dayNum(d) + k) * 86_400_000);
    return t.toISOString().slice(0, 10);
  };
  const index = new Map(f.dates.map((d, i) => [d, i]));
  const out: Comparison[] = [];
  for (const [label, k] of [['Previous equal period', -span], ['Same weeks a year earlier (52 weeks before)', -364]] as const) {
    const current = periodTotal(f, from, to);
    const otherFrom = shiftDate(from, k);
    const otherTo = shiftDate(to, k);
    const other = periodTotal(f, otherFrom, otherTo);
    let matched = 0;
    let nowK = 0;
    let thenK = 0;
    for (let d = from; d <= to; d = shiftDate(d, 1)) {
      const a = index.get(d);
      const b = index.get(shiftDate(d, k));
      if (a === undefined || b === undefined || !isCompleteDay(f, a) || !isCompleteDay(f, b)) continue;
      matched++;
      nowK += dayKwh(f, a);
      thenK += dayKwh(f, b);
    }
    const enough = matched >= Math.max(1, 0.8 * span);
    out.push({
      label, current, other, matchedDays: matched, matchedNowKwh: nowK, matchedThenKwh: thenK,
      change: enough && thenK > 0 ? nowK / thenK - 1 : null,
      note: enough
        ? `Compared on ${matched} matched days with complete readings in both periods.`
        : `Only ${matched} of ${span} days have complete readings in both periods, so no like-for-like change is shown.`,
    });
  }
  return out;
}

// --- Before and after -------------------------------------------------------------

export interface BeforeAfterSide {
  from: string;
  to: string;
  /** Days with at least 90% of readings valid. */
  completeDays: number;
  /** Base load at the percentile, all valid half hours. */
  baseKw: number | null;
  samples: number;
  /** Average demand across all valid half hours. */
  avgKw: number | null;
  /** Average demand in closed half hours (needs 96+). */
  closedAvgKw: number | null;
  closedSamples: number;
}

/**
 * Measured demand in the weeks either side of a date: did something change
 * when a known change was made (a BMS schedule, a plant switch-off, an LED
 * retrofit)? Using a few weeks either side, not the whole record, keeps the
 * seasons from swamping the answer. Describes a change; does not prove the cause.
 */
export function beforeAfter(f: Frame, plans: DayPlan[], split: string, p: number, weeks = 8) {
  const side = (from: string, to: string): BeforeAfterSide => {
    const all: number[] = [];
    let closedSum = 0;
    let closedN = 0;
    let complete = 0;
    f.dates.forEach((d, i) => {
      if (d < from || d > to) return;
      if (isCompleteDay(f, i)) complete++;
      for (let s = 0; s < SLOTS; s++) {
        if (!isValid(f, i, s)) continue;
        const kw = f.rows[i][s] / INTERVAL_HOURS;
        all.push(kw);
        if (!plans[i].open[s]) { closedSum += kw; closedN++; }
      }
    });
    const avg = all.length ? all.reduce((a, b) => a + b, 0) / all.length : null;
    all.sort((a, b) => a - b);
    return {
      from, to, completeDays: complete,
      baseKw: all.length >= 96 ? percentile(all, p / 100) : null, samples: all.length,
      avgKw: all.length >= 96 ? avg : null,
      closedAvgKw: closedN >= 96 ? closedSum / closedN : null, closedSamples: closedN,
    };
  };
  return {
    split, weeks,
    before: side(addDays(split, -7 * weeks), addDays(split, -1)),
    after: side(split, addDays(split, 7 * weeks - 1)),
  };
}

// --- The analysis -----------------------------------------------------------------

export interface AnalysisInput {
  frame: Frame;
  settings: SiteSettings;
  defaultRateP: number;
  quality: QualityReport;
  carbon: CarbonFactor | null;
  prices?: PriceGrid;
}

export function pricesFor(frame: Frame, settings: SiteSettings, defaultRateP: number): PriceGrid {
  const flatP = settings.rateP ?? defaultRateP;
  return priceGrid(frame, settings.tariff, flatP, (d) => isHoliday(settings.calendar, d));
}

export function analyseSite(input: AnalysisInput): SiteMetrics {
  const { frame: f, settings, defaultRateP, quality, carbon } = input;
  const flatP = settings.rateP ?? defaultRateP;
  const prices = input.prices ?? pricesFor(f, settings, defaultRateP);
  const cal = settings.calendar;
  const plans = planDays(cal, f.dates);
  const cov = coverage(f);
  const ann = annualisationFor(cov, settings.annualise);
  const factor = ann.factor;
  const p = settings.basePercentile / 100;
  const n = f.dates.length;

  // Observed totals and per-interval scan.
  let kwh = 0;
  let cost = 0;
  let peak = -Infinity;
  let peakAt = [0, 0];
  let lowest = Infinity;
  const kwAll: number[] = [];
  const kwClosed: number[] = [];
  const kwLow: number[] = []; // 24/7 low-activity window
  let openKwh = 0; let openN = 0; let closedKwh = 0; let closedN = 0;
  const lowWin = cal.lowActivity;
  f.rows.forEach((r, i) => {
    const pr = prices.rows[i];
    for (let s = 0; s < SLOTS; s++) {
      if (!isValid(f, i, s)) continue;
      const v = r[s];
      kwh += v;
      cost += v * pr[s];
      const k = v / INTERVAL_HOURS;
      kwAll.push(k);
      if (v > peak) { peak = v; peakAt = [i, s]; }
      if (v < lowest) lowest = v;
      if (plans[i].open[s]) { openKwh += v; openN++; } else { closedKwh += v; closedN++; kwClosed.push(k); }
      if (lowWin && (lowWin.open < lowWin.close ? s >= lowWin.open && s < lowWin.close : s >= lowWin.open || s < lowWin.close)) kwLow.push(k);
    }
  });
  // The repeated clock-change hour is real consumption: in totals, not in profiles.
  const extra = (f.dstExtraKwh ?? []).reduce((a, b) => a + b, 0);
  if (extra) { kwh += extra; cost += extra * (flatP / 100); }
  if (!kwAll.length) { peak = 0; lowest = 0; }
  const observed = totals(kwh, cost, carbon);
  const annual = scaleTotals(observed, factor);
  const validHours = cov.validHours;
  const averageKw = validHours ? kwh / validHours : 0;
  const peakKw = peak / INTERVAL_HOURS;

  kwAll.sort((a, b) => a - b);
  kwClosed.sort((a, b) => a - b);
  kwLow.sort((a, b) => a - b);
  const baseAll: Reference = {
    kw: percentile(kwAll, p), samples: kwAll.length,
    label: `All-period reference (${settings.basePercentile}th percentile)`,
    method: `${settings.basePercentile}th percentile of all ${kwAll.length.toLocaleString('en-GB')} valid half-hour demands. `
      + 'Not the minimum, so a single dropout cannot set it.',
  };
  const hasClosed = closedN > 0 && !isAlwaysOpen(cal);
  let baseClosed: Reference | null = null;
  let baseClosedNote = '';
  if (hasClosed && kwClosed.length >= 96) {
    baseClosed = {
      kw: percentile(kwClosed, p), samples: kwClosed.length,
      label: `Closed-hours reference (${settings.basePercentile}th percentile)`,
      method: `${settings.basePercentile}th percentile of ${kwClosed.length.toLocaleString('en-GB')} valid half hours when the site is closed `
        + `under its calendar${cal.confirmed ? '' : ' (hours not yet confirmed)'}.`,
    };
  } else if (!hasClosed && lowWin && kwLow.length >= 96) {
    baseClosed = {
      kw: percentile(kwLow, p), samples: kwLow.length,
      label: `Low-activity reference (${slotTime(lowWin.open)}-${slotTime(lowWin.close)}, ${settings.basePercentile}th percentile)`,
      method: `No confirmed closed hours (open all the time). ${settings.basePercentile}th percentile of ${kwLow.length.toLocaleString('en-GB')} `
        + `valid half hours in the low-activity window ${slotTime(lowWin.open)}-${slotTime(lowWin.close)}, as set in the calendar.`,
    };
    baseClosedNote = 'Site is open all the time; the low-activity window stands in for closed hours.';
  } else {
    baseClosedNote = hasClosed
      ? 'Too few closed-hour readings (under 96) for a closed-hours reference.'
      : 'No confirmed closed hours: the calendar has the site open all the time. Set a low-activity window to get a reference.';
  }

  // Base load: a continuous load at the all-period reference.
  let baseCost = 0;
  f.rows.forEach((_, i) => { for (let s = 0; s < SLOTS; s++) if (isValid(f, i, s)) baseCost += baseAll.kw * INTERVAL_HOURS * prices.rows[i][s]; });
  const baseObserved = totals(baseAll.kw * validHours, baseCost, carbon);
  const base = { observed: baseObserved, annual: scaleTotals(baseObserved, factor), share: kwh ? baseObserved.kwh / kwh : 0 };

  // Closed-hours excess against each reference, split by day class.
  const classes: DayClass[] = ['weekday', 'saturday', 'sunday', 'holiday', 'closure', 'exception'];
  const split = new Map<DayClass, ClassSplit>(classes.map((c) => [c, {
    cls: c, label: DAY_CLASS_LABEL[c], closedKwh: 0, closedHours: 0, excessAll: 0, excessClosed: baseClosed && hasClosed ? 0 : null,
  }]));
  const excessCalc = (ref: Reference, kind: 'all' | 'closed'): ExcessResult => {
    let ex = 0; let exCost = 0; let count = 0;
    f.rows.forEach((r, i) => {
      for (let s = 0; s < SLOTS; s++) {
        if (!isValid(f, i, s) || plans[i].open[s]) continue;
        const e = Math.max(0, r[s] - ref.kw * INTERVAL_HOURS);
        ex += e; exCost += e * prices.rows[i][s]; count++;
        const c = split.get(plans[i].cls)!;
        if (kind === 'all') { c.excessAll += e; c.closedKwh += r[s]; c.closedHours += INTERVAL_HOURS; }
        else if (c.excessClosed !== null) c.excessClosed += e;
      }
    });
    const obs = totals(ex, exCost, carbon);
    return {
      reference: kind, refKw: ref.kw, label: ref.label, observed: obs, annual: scaleTotals(obs, factor), intervals: count,
      method: `For each of ${count.toLocaleString('en-GB')} valid closed half hours: excess kWh = max(0, kWh - ${kwFmt(ref.kw)} x 0.5 h). `
        + 'Associated cost = sum of excess kWh x that half hour\'s rate.',
    };
  };
  const excessAll = hasClosed ? excessCalc(baseAll, 'all') : null;
  const excessClosed = hasClosed && baseClosed ? excessCalc(baseClosed, 'closed') : null;
  const excess = settings.excessReference === 'closed' && excessClosed ? excessClosed : excessAll;
  const byClass = [...split.values()].filter((c) => c.closedHours > 0);

  // Monthly base load with sample counts.
  const monthlyBase: MonthlyBase[] = n ? monthsBetween(f.dates[0], f.dates[n - 1]).flatMap((m) => {
    const vals: number[] = [];
    let excluded = 0;
    let any = false;
    f.dates.forEach((d, i) => {
      if (d.slice(0, 7) !== m.key) return;
      any = true;
      for (let s = 0; s < SLOTS; s++) {
        if (isValid(f, i, s)) vals.push(f.rows[i][s] / INTERVAL_HOURS);
        else if (flagAt(f, i, s) !== FLAG.DST_GAP) excluded++;
      }
    });
    if (!any) return [];
    vals.sort((a, b) => a - b);
    return [{
      key: m.key, month: `${MONTHS_SHORT[m.m - 1]} ${m.y}`, kw: round(percentile(vals, p), 2),
      samples: vals.length, excluded, thin: vals.length < SLOTS * 20,
    }];
  }) : [];

  const anomalies = detectAnomalies(f, plans, quality.suspectDays, settings.detection);

  // Top peaks (one per day) and how often demand comes close to the peak.
  const pf = settings.powerFactor || DEFAULT_POWER_FACTOR;
  const dayPeaks: PeakRow[] = [];
  f.rows.forEach((r, i) => {
    let best = -1; let at = 0;
    for (let s = 0; s < SLOTS; s++) if (isValid(f, i, s) && r[s] > best) { best = r[s]; at = s; }
    if (best < 0) return;
    const kw = best / INTERVAL_HOURS;
    dayPeaks.push({
      date: f.dates[i], slot: at, kw: round(kw, 1), kva: round(kw / pf, 1),
      utilisation: settings.capacityKva ? kw / pf / settings.capacityKva : null, open: plans[i].open[at],
    });
  });
  dayPeaks.sort((a, b) => b.kw - a.kw);
  const peaks = dayPeaks.slice(0, 10);
  let nearHH = 0;
  const nearDays = new Set<number>();
  f.rows.forEach((r, i) => { for (let s = 0; s < SLOTS; s++) if (isValid(f, i, s) && r[s] >= 0.9 * peak) { nearHH++; nearDays.add(i); } });

  const intensity = settings.floorAreaM2 && settings.floorAreaM2 > 0 ? {
    floorAreaM2: settings.floorAreaM2,
    kwhPerM2Annual: annual ? annual.kwh / settings.floorAreaM2 : null,
    kwhPerM2Observed: kwh / settings.floorAreaM2,
    openHours: openN * INTERVAL_HOURS,
    kwhPerOpenHour: openN ? kwh / (openN * INTERVAL_HOURS) : null,
  } : null;

  const metricsBase = {
    coverage: cov, annualisation: ann,
    rate: { description: prices.description, banded: prices.banded, problems: prices.problems, flatP },
    observed, annual,
    peak: { kw: round(peakKw, 1), date: f.dates[peakAt[0]] ?? '', slot: peakAt[1], when: n ? `${fmtDayMonYear(f.dates[peakAt[0]])} at ${slotTime(peakAt[1])}` : '' },
    lowestKw: round(lowest / INTERVAL_HOURS, 2),
    averageKw: round(averageKw, 2),
    loadFactor: peakKw > 0 ? round(averageKw / peakKw, 3) : 0,
    baseAll, baseClosed, baseClosedNote, base, hasClosed,
    open: { kwh: openKwh, hours: openN * INTERVAL_HOURS },
    closed: { kwh: closedKwh, hours: closedN * INTERVAL_HOURS, share: kwh ? closedKwh / kwh : 0 },
    byClass, excessAll, excessClosed, excess, monthlyBase, anomalies, peaks,
    peakRecurrence: { share: 0.9, halfHours: nearHH, days: nearDays.size },
    intensity,
    qualityVerdict: quality.verdict,
    rankValue: excess?.annual ? excess.annual.cost : null,
  };
  const findings = buildFindings(f, plans, settings, metricsBase, quality, prices);
  return { ...metricsBase, findings };
}

// --- Findings -------------------------------------------------------------------

type Base = Omit<SiteMetrics, 'findings'>;

function buildFindings(f: Frame, plans: DayPlan[], st: SiteSettings, m: Base, quality: QualityReport, prices: PriceGrid): Finding[] {
  const out: Finding[] = [];
  const period = { from: m.coverage.from, to: m.coverage.to };
  const confirmed = st.calendar.confirmed;
  const conf = (calendarDependent: boolean, sample?: { n: number; min: number; what: string }) =>
    confidenceFor({ verdict: quality.verdict, validDays: m.coverage.validDays, calendarDependent, confirmed, sample });
  const money = (obs: number, annual: number | null) => (annual !== null ? `${gbp(annual)} a year` : `${gbp(obs)} over the period`);
  const annualLine = m.annualisation.factor !== null ? [`Annual estimate: ${m.annualisation.method}`] : ['Not annualised: observed period only.'];
  const totalCost = m.observed.cost;
  const daily = f.dates.map((_, i) => dayKwh(f, i));
  const complete = f.dates.map((_, i) => isCompleteDay(f, i));
  const medianOf = (pred: (i: number) => boolean) => {
    const v = daily.filter((_, i) => complete[i] && pred(i));
    return { m: v.length ? median(v) : 0, n: v.length };
  };

  // 1. Closed-hours use above the reference.
  if (m.hasClosed && m.excess && m.closed.kwh > 0) {
    const e = m.excess;
    const worst = f.dates.map((d, i) => {
      let x = 0;
      for (let s = 0; s < SLOTS; s++) if (isValid(f, i, s) && !plans[i].open[s]) x += Math.max(0, f.rows[i][s] - e.refKw * INTERVAL_HOURS);
      return { d, x };
    }).sort((a, b) => b.x - a.x).slice(0, 3).filter((w) => w.x > 0);
    const alt = e.reference === 'all' ? m.excessClosed : m.excessAll;
    const c = conf(true);
    out.push({
      key: 'ooh',
      title: `Closed-hours use above the ${e.reference === 'all' ? 'all-period' : 'closed-hours'} reference: ${money(e.observed.cost, e.annual?.cost ?? null)}`,
      detail: `${pct(m.closed.share)} of consumption (${kwhFmt(m.closed.kwh)} observed) falls outside opening hours. Of that, `
        + `${kwhFmt(e.observed.kwh)} sits above the reference of ${kwFmt(e.refKw)}. Some of it may be essential load `
        + '(refrigeration, IT, process, security).',
      investigation: 'Demand stays above the usual closed-hours level when the site should be shut. Check controls and '
        + 'operating schedules (time clocks, BMS, plant left enabled), then confirm which loads are essential.',
      level: impactFor(e.observed.cost, totalCost),
      confidence: c.level, confidenceReasons: c.reasons,
      evidence: [
        ...m.byClass.map((b) => `${b.label}: ${kwhFmt(b.closedKwh)} in ${Math.round(b.closedHours).toLocaleString('en-GB')} closed hours, `
          + `${kwhFmt(e.reference === 'all' ? b.excessAll : (b.excessClosed ?? 0))} above the reference`),
        ...worst.map((w) => `Largest closed-hours excess: ${fmtDayMonYear(w.d)} (${kwhFmt(w.x)})`),
        ...(alt ? [`Against the ${alt.reference === 'all' ? 'all-period' : 'closed-hours'} reference (${kwFmt(alt.refKw)}) instead: `
          + `${kwhFmt(alt.observed.kwh)}, ${money(alt.observed.cost, alt.annual?.cost ?? null)}`] : []),
      ],
      calc: [e.method, `Reference: ${e.label}, ${kwFmt(e.refKw)}.`, ...annualLine],
      period,
      kwh: { observed: e.observed.kwh, annual: e.annual?.kwh ?? null },
      cost: { observed: e.observed.cost, annual: e.annual?.cost ?? null },
      calendarDependent: true,
      links: [{ label: 'Heatmap', tab: 'heatmap', date: worst[0]?.d }, { label: 'Base load and closed hours', tab: 'baseload' }, { label: 'Calendar', tab: 'calendar' }],
      related: ['base', 'weekend', 'holidays', 'closures', 'shoulders'],
    });
  }

  // 2. Base load.
  {
    const c = conf(false);
    const perKw = m.annualisation.factor !== null
      ? `Each 1 kW of continuous load is ${kwhFmt(8766)} and about ${gbp(8766 * (m.observed.kwh ? m.observed.cost / m.observed.kwh : 0))} a year at the average rate.`
      : `Each 1 kW of continuous load is ${kwhFmt(m.coverage.validHours)} over the period.`;
    out.push({
      key: 'base',
      title: `Load that never switches off: ${kwFmt(m.baseAll.kw)}, ${money(m.base.observed.cost, m.base.annual?.cost ?? null)}`,
      detail: `${pct(m.base.share)} of consumption is continuous load at the all-period reference. ${perKw}`,
      investigation: 'List what runs continuously (servers, refrigeration, ventilation, standby loads) and confirm what '
        + 'has to. The heatmap shows whether the floor is steady or stepped.',
      level: m.base.share >= 0.5 && m.hasClosed ? 'medium' : 'info',
      confidence: c.level, confidenceReasons: c.reasons,
      evidence: [
        `${m.baseAll.label}: ${kwFmt(m.baseAll.kw)} from ${m.baseAll.samples.toLocaleString('en-GB')} readings`,
        ...(m.baseClosed ? [`${m.baseClosed.label}: ${kwFmt(m.baseClosed.kw)} from ${m.baseClosed.samples.toLocaleString('en-GB')} readings`] : [m.baseClosedNote]),
        `Lowest recorded half hour: ${kwFmt(m.lowestKw)}`,
      ],
      calc: [m.baseAll.method, 'Cost = reference kW x 0.5 h x each valid half hour\'s rate, summed.', ...annualLine],
      period,
      kwh: { observed: m.base.observed.kwh, annual: m.base.annual?.kwh ?? null },
      cost: { observed: m.base.observed.cost, annual: m.base.annual?.cost ?? null },
      kw: m.baseAll.kw,
      calendarDependent: false,
      links: [{ label: 'Base load trend', tab: 'baseload' }, { label: 'Heatmap', tab: 'heatmap' }],
      related: ['ooh'],
    });
  }

  // 3. Weekends at a site closed at weekends.
  const sat = st.calendar.week[5];
  const sun = st.calendar.week[6];
  if (!sat.length && !sun.length) {
    const wk = medianOf((i) => plans[i].cls === 'weekday');
    const we = medianOf((i) => plans[i].cls === 'saturday' || plans[i].cls === 'sunday');
    const ratio = wk.m > 0 ? we.m / wk.m : 0;
    if (ratio >= 0.5 && we.n) {
      const c = conf(true, { n: we.n, min: 8, what: 'weekend days' });
      out.push({
        key: 'weekend',
        title: `Weekend days use ${pct(ratio)} of a weekday`,
        detail: `A typical weekend day uses ${kwhFmt(we.m)} against ${kwhFmt(wk.m)} on a weekday, at a site set as closed at weekends.`,
        investigation: 'Either the site is used at weekends, or something is left running. Check weekend occupancy and '
          + 'whether heating, ventilation and lighting schedules include weekends. Counted within the closed-hours finding.',
        level: ratio >= 0.7 ? 'high' : 'medium',
        confidence: c.level, confidenceReasons: c.reasons,
        evidence: [`Median of ${we.n} complete weekend days vs ${wk.n} complete weekdays`],
        calc: ['Ratio = median weekend day kWh / median weekday kWh, complete days only, holidays and closures excluded.'],
        period, calendarDependent: true,
        links: [{ label: 'Heatmap', tab: 'heatmap' }, { label: 'Calendar', tab: 'calendar' }],
        related: ['ooh'],
      });
    }
  }

  // 4. Bank holidays that look like working days.
  if (st.calendar.holidays === 'closed') {
    const wk = medianOf((i) => plans[i].cls === 'weekday');
    const busy = f.dates.filter((_, i) => plans[i].cls === 'holiday' && complete[i] && wk.m > 0 && daily[i] >= 0.8 * wk.m);
    if (busy.length) {
      const c = conf(true);
      out.push({
        key: 'holidays',
        title: `${busy.length} bank holiday${busy.length > 1 ? 's' : ''} look like normal working days`,
        detail: `${busy.map(fmtDayMonYear).join(', ')} used at least 80% of a typical weekday (${kwhFmt(wk.m)}).`,
        investigation: 'If the site was closed, check whether heating and plant schedules include bank holidays. If it '
          + 'was open, change the calendar.',
        level: 'medium', confidence: c.level, confidenceReasons: c.reasons,
        evidence: busy.slice(0, 6).map((d) => `${fmtDayMonYear(d)}: ${kwhFmt(daily[f.dates.indexOf(d)])}`),
        calc: ['Holiday flagged when its kWh is at least 80% of the median complete weekday.'],
        period, calendarDependent: true,
        links: [{ label: 'Inspect day', tab: 'heatmap', date: busy[0] }, { label: 'Calendar', tab: 'calendar' }],
        related: ['ooh'],
      });
    }
  }

  // 5. Dated closures that look like normal operation (school holidays, shutdowns).
  if (st.calendar.closures.length) {
    const wk = medianOf((i) => plans[i].cls === 'weekday');
    const busy = f.dates.filter((_, i) => plans[i].cls === 'closure' && dayOfWeek(f.dates[i]) < 5 && complete[i] && wk.m > 0 && daily[i] >= 0.6 * wk.m);
    if (busy.length) {
      const c = conf(true);
      out.push({
        key: 'closures',
        title: `${busy.length} weekday${busy.length > 1 ? 's' : ''} in dated closures use at least 60% of a normal weekday`,
        detail: `During closures entered in the calendar, these weekdays ran close to normal: ${busy.slice(0, 5).map(fmtDayMonYear).join(', ')}`
          + `${busy.length > 5 ? ` and ${busy.length - 5} more` : ''}.`,
        investigation: 'Check whether heating, ventilation and lighting were set back for the closure, and whether the '
          + 'building was in use (holiday clubs, works, cleaning).',
        level: 'medium', confidence: c.level, confidenceReasons: c.reasons,
        evidence: st.calendar.closures.map((r) => `Closure: ${r.label || 'unnamed'} ${fmtDayMonYear(r.from)} to ${fmtDayMonYear(r.to)}`),
        calc: ['Weekday in a dated closure flagged when its kWh is at least 60% of the median complete normal weekday.'],
        period, calendarDependent: true,
        links: [{ label: 'Inspect day', tab: 'heatmap', date: busy[0] }, { label: 'Calendar', tab: 'calendar' }],
        related: ['ooh'],
      });
    }
  }

  // 6. Early starts and late finishes: closed-hours excess in the two hours either side of opening.
  if (m.hasClosed && m.excess) {
    let early = 0; let late = 0; let earlyCost = 0; let lateCost = 0; let daysWith = 0;
    f.dates.forEach((_, i) => {
      const open = plans[i].open;
      const first = open.indexOf(true);
      const last = open.lastIndexOf(true);
      if (first < 0 || (first === 0 && last === SLOTS - 1)) return;
      daysWith++;
      for (let s = Math.max(0, first - 4); s < first; s++) {
        if (!isValid(f, i, s) || open[s]) continue;
        const e = Math.max(0, f.rows[i][s] - m.excess!.refKw * INTERVAL_HOURS);
        early += e; earlyCost += e * prices.rows[i][s];
      }
      for (let s = last + 1; s < Math.min(SLOTS, last + 5); s++) {
        if (!isValid(f, i, s) || open[s]) continue;
        const e = Math.max(0, f.rows[i][s] - m.excess!.refKw * INTERVAL_HOURS);
        late += e; lateCost += e * prices.rows[i][s];
      }
    });
    const total = earlyCost + lateCost;
    if (daysWith && total > 0 && m.excess.observed.cost > 0 && total >= 0.15 * m.excess.observed.cost) {
      const fct = m.annualisation.factor;
      const c = conf(true);
      out.push({
        key: 'shoulders',
        title: `Demand runs above the reference in the two hours around opening and closing: ${money(total, fct ? total * fct : null)}`,
        detail: `Before opening: ${kwhFmt(early)}; after closing: ${kwhFmt(late)}, above the ${kwFmt(m.excess.refKw)} reference. `
          + `That is ${pct(total / m.excess.observed.cost)} of the closed-hours excess.`,
        investigation: late >= early
          ? 'Demand stays above the usual closed-hours level after the confirmed closing time. Check controls and operating '
            + 'schedules, then confirm essential loads.'
          : 'Demand rises well before the confirmed opening time. Check optimum-start and time-clock settings, then confirm '
            + 'what needs to run before opening.',
        level: impactFor(total, totalCost), confidence: c.level, confidenceReasons: c.reasons,
        evidence: [`${daysWith} days with an opening time`, `Window: 2 hours before the first open half hour and 2 hours after the last`],
        calc: ['Excess kWh = max(0, kWh - reference kW x 0.5 h) in the window, closed half hours only, x each half hour\'s rate.', ...annualLine],
        period,
        kwh: { observed: early + late, annual: fct ? (early + late) * fct : null },
        cost: { observed: total, annual: fct ? total * fct : null },
        calendarDependent: true,
        links: [{ label: 'Day inspector', tab: 'heatmap' }, { label: 'Scenarios', tab: 'scenarios' }],
        related: ['ooh'],
      });
    }
  }

  // 7. Base load change, same months a year apart.
  {
    const byMonth = new Map(m.monthlyBase.filter((x) => !x.thin).map((x) => [x.key, x.kw]));
    const pairs = m.monthlyBase.flatMap((x) => {
      if (x.thin) return [];
      const [y, mo] = x.key.split('-');
      const later = byMonth.get(`${Number(y) + 1}-${mo}`);
      return later !== undefined ? [[x.kw, later, x.key] as const] : [];
    });
    if (pairs.length >= 2) {
      const before = pairs.reduce((a, q) => a + q[0], 0) / pairs.length;
      const after = pairs.reduce((a, q) => a + q[1], 0) / pairs.length;
      if (before > 0 && Math.abs(after / before - 1) >= 0.15) {
        const up = after > before;
        const avgRate = m.observed.kwh ? m.observed.cost / m.observed.kwh : 0;
        const extra = Math.abs(after - before) * 8766 * avgRate;
        const c = conf(false, { n: pairs.length, min: 3, what: 'matched months' });
        out.push({
          key: 'creep',
          title: `Base load is ${up ? 'up' : 'down'} ${pct(Math.abs(after / before - 1))} on the same months a year earlier`,
          detail: `Across ${pairs.length} matched months, base load moved from about ${kwFmt(before)} to ${kwFmt(after)}. `
            + `${up ? 'If it stays, the increase is associated with' : 'If it holds, the reduction is worth'} about ${gbp(extra)} a year at the average rate.`,
          investigation: up
            ? 'Check what was added or changed on site, and whether any new continuous load is needed.'
            : 'A lower base load is good news if it follows a known change. Confirm it is real and not a metering change before counting it.',
          level: up ? impactFor(extra, m.annual?.cost ?? totalCost) : 'info',
          confidence: c.level, confidenceReasons: c.reasons,
          evidence: pairs.map(([a, b, k]) => `${k}: ${kwFmt(a)} then ${kwFmt(b)} a year later`),
          calc: ['Monthly base = 5th percentile of the month\'s valid half hours (months with 20+ days only).',
            'Change = mean of later months / mean of earlier months - 1. Cost = kW change x 8,766 h x average rate.'],
          period, kw: after - before, calendarDependent: false,
          links: [{ label: 'Base load trend', tab: 'baseload' }],
          related: ['base'],
        });
      }
    }
  }

  // 8. Unusual days.
  const an = m.anomalies;
  if (an.events.length) {
    const high = an.events.filter((e) => e.direction === 'high');
    const low = an.events.filter((e) => e.direction === 'low');
    const top = an.events.slice(0, 3)
      .map((e) => `${fmtDayMonYear(e.date)} (${kwhFmt(e.actualKwh)} vs ${kwhFmt(e.expectedKwh)} expected)`).join('; ');
    const c = conf(true, { n: an.checkedDays - an.notApplicable, min: 60, what: 'days with a usable baseline' });
    out.push({
      key: 'unusual',
      title: `${an.events.length} unusual day${an.events.length > 1 ? 's' : ''}: ${high.length} high, ${low.length} low`,
      detail: `Days far from the matched baseline for the same weekday and calendar class. Largest: ${top}.`,
      investigation: 'Check against site events, faults, works and missing data. A low day is not a saving until the data '
        + 'and an operational change are confirmed.',
      level: 'low', confidence: c.level, confidenceReasons: c.reasons,
      evidence: [`${an.checkedDays} complete days checked; rule could not be applied on ${an.notApplicable} `
        + `(${an.notApplicableReasons.insufficient} too few comparable days, ${an.notApplicableReasons.noVariation} with no variation)`],
      calc: [`Baseline: previous ${st.detection.baselineDays} comparable days (min ${st.detection.minDays}), complete and not under a quality question.`,
        `Unusual when more than ${pct(st.detection.pct)} from the median and more than ${st.detection.madMultiple} x the scaled median absolute deviation.`],
      period, calendarDependent: true,
      links: [{ label: 'Anomalies', tab: 'anomalies' }, { label: 'Inspect the largest', tab: 'heatmap', date: an.events[0].date }],
      related: [],
    });
  }

  // 9. Persistent changes.
  an.changes.slice(0, 3).forEach((ch, k) => {
    const c = conf(true);
    out.push({
      key: `persistent-${k + 1}`,
      title: `Demand ${ch.direction === 'up' ? 'above' : 'below'} its matched baseline for a sustained period from ${fmtDayMonYear(ch.from)}`,
      detail: `${ch.flaggedDays} of ${ch.eligibleDays} eligible days between ${fmtDayMonYear(ch.from)} and ${fmtDayMonYear(ch.to)} were at least `
        + `${pct(st.detection.persistPct)} ${ch.direction === 'up' ? 'above' : 'below'} their baseline (average ${ch.meanDeviation >= 0 ? '+' : ''}${pct(ch.meanDeviation)}). `
        + `${kwhFmt(ch.actualKwh)} recorded against ${kwhFmt(ch.expectedKwh)} expected.`,
      investigation: ch.direction === 'up'
        ? 'Measured demand rose and stayed up. Check for new equipment, changed schedules, occupancy or a fault starting around this date.'
        : 'Measured demand fell and stayed down. Confirm whether an operational change was made and the data is complete before treating it as a saving.',
      level: ch.direction === 'up' ? 'medium' : 'info',
      confidence: c.level, confidenceReasons: c.reasons,
      evidence: [`Window rule: ${st.detection.persistDays} of ${st.detection.persistWindow} consecutive eligible days`],
      calc: ['Each day compared with the median of its previous comparable days (same weekday and calendar class).'],
      period: { from: ch.from, to: ch.to }, calendarDependent: true,
      links: [{ label: 'Anomalies', tab: 'anomalies' }, { label: 'Inspect first day', tab: 'heatmap', date: ch.from }],
      related: ['unusual'],
    });
  });

  // 10. Supply capacity.
  if (st.capacityKva && st.capacityKva > 0) {
    const pf = st.powerFactor || DEFAULT_POWER_FACTOR;
    const peakKva = m.peak.kw / pf;
    const used = peakKva / st.capacityKva;
    const c = conf(false);
    if (used >= 0.9 || used <= 0.5) {
      out.push({
        key: 'capacity',
        title: used >= 0.9 ? `Highest half-hour demand reached ${pct(used)} of supply capacity`
          : `Highest half-hour demand reached only ${pct(used)} of supply capacity`,
        detail: `Highest recorded half-hour average of ${kwFmt(m.peak.kw)} (about ${Math.round(peakKva)} kVA at an assumed power factor of ${pf}) `
          + `against ${st.capacityKva} kVA agreed, on ${m.peak.when}. ${m.peakRecurrence.halfHours} half hours on ${m.peakRecurrence.days} days came within 10% of it.`,
        investigation: used >= 0.9
          ? 'Little room for heat pumps, EV charging or new plant without a capacity increase. Check the peak dates against site activity and confirm the capacity with the bill or DNO.'
          : 'The site may be paying for capacity it does not use, or has room for electrification. Confirm the agreed capacity and review the peak dates.',
        level: used >= 0.9 ? 'high' : 'info', confidence: c.level, confidenceReasons: c.reasons,
        evidence: m.peaks.slice(0, 3).map((x) => `${fmtDayMonYear(x.date)} ${slotTime(x.slot)}: ${kwFmt(x.kw)} (${x.kva} kVA)`),
        calc: ['kVA = kW / assumed power factor. Half-hour averages, not instantaneous maxima.'],
        period, kw: m.peak.kw, calendarDependent: false,
        links: [{ label: 'Capacity', tab: 'capacity' }],
        related: [],
      });
    }
  }

  // 11. Coverage itself, when it limits everything else.
  if (m.annualisation.mode === 'off' && st.annualise !== 'off') {
    out.push({
      key: 'coverage',
      title: `Only ${Math.round(m.coverage.validDays)} days of valid readings: annual figures not shown`,
      detail: 'Under 180 days of valid readings. Figures cover the observed period only. Seasonal patterns cannot be judged.',
      investigation: 'Ask for at least a full year of half-hourly data before quoting annual costs or comparing sites. '
        + 'Annual figures can be forced in the site settings, with a warning.',
      level: 'info', confidence: 'high', confidenceReasons: ['coverage measured directly'],
      evidence: [`${m.coverage.validReadings.toLocaleString('en-GB')} valid readings of ${m.coverage.expectedReadings.toLocaleString('en-GB')} expected`],
      calc: [m.annualisation.method], period, calendarDependent: false,
      links: [{ label: 'Data review', tab: 'review' }], related: [],
    });
  }

  const order: Record<Level, number> = { high: 0, medium: 1, low: 2, info: 3 };
  const value = (x: Finding) => x.cost?.annual ?? x.cost?.observed ?? 0;
  out.sort((a, b) => order[a.level] - order[b.level] || value(b) - value(a));
  return out;
}

/** The three most useful investigations: highest impact, then confidence, then cost. */
export function topInvestigations(m: SiteMetrics, n = 3): Finding[] {
  const order: Record<Level, number> = { high: 0, medium: 1, low: 2, info: 3 };
  const confOrder: Record<Confidence, number> = { high: 0, medium: 1, low: 2 };
  return m.findings
    .filter((x) => x.level !== 'info')
    .sort((a, b) => order[a.level] - order[b.level] || confOrder[a.confidence] - confOrder[b.confidence]
      || (b.cost?.annual ?? b.cost?.observed ?? 0) - (a.cost?.annual ?? a.cost?.observed ?? 0))
    .slice(0, n);
}
