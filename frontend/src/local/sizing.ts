/**
 * Economics-led array sizing. Port of backend/app/services/solar_sizing.py.
 *
 * The rule: of the sizes that keep self-consumption inside the requested
 * band, take the one with the shortest simple payback.
 */
import type {
  EconomicAssumptions, Economics, MonthlySolarPoint, SizingCurvePoint,
} from '../types';
import { MONTHS_SHORT, monthsBetween, parts } from './dates';
import { appraise } from './economics';
import { round } from './analytics';
import type { Frame } from './parser';

/** A 1 kWp generation profile: one row of 48 half-hour kWh values per day. */
export type GenProfile = Frame;

export interface CurveResult extends SizingCurvePoint {
  economics: Economics;
}

export interface SizingResult {
  best: CurveResult;
  curve: CurveResult[];
  alternative: CurveResult | null;
  monthly: MonthlySolarPoint[];
  warning: string | null;
  days: number;
  annualConsumptionKwh: number;
}

const SUMMER_MONTHS = new Set([6, 7, 8]);
const CANDIDATE_COUNT = 100;
const SEARCH_HEADROOM = 2.5;

const total = (rows: number[][]) => rows.reduce((s, r) => s + r.reduce((a, b) => a + b, 0), 0);

/**
 * Put the reference-year generation onto the consumption calendar by month
 * and day, so June consumption meets June sun.
 */
export function alignGeneration(consumption: Frame, gen: GenProfile): number[][] {
  const byDay = new Map<string, number[]>();
  const byMonth = new Map<number, number[][]>();
  gen.dates.forEach((d, i) => {
    byDay.set(d.slice(5), gen.rows[i]);
    const m = parts(d).m;
    if (!byMonth.has(m)) byMonth.set(m, []);
    byMonth.get(m)!.push(gen.rows[i]);
  });
  const mean = (rows: number[][]) => {
    const out = new Array(48).fill(0);
    for (const r of rows) for (let s = 0; s < 48; s++) out[s] += r[s] / rows.length;
    return out;
  };
  const monthlyMean = new Map([...byMonth].map(([m, rows]) => [m, mean(rows)]));
  const overall = mean(gen.rows);

  return consumption.dates.map((d) => {
    const key = d.slice(5);
    let row = byDay.get(key);
    if (!row && key === '02-29') row = byDay.get('02-28');
    return row ?? monthlyMean.get(parts(d).m) ?? overall;
  });
}

function candidateSizes(consumption: Frame, gen: number[][]): number[] {
  const annualCons = total(consumption.rows);
  const yieldPerKwp = total(gen);
  if (yieldPerKwp <= 0 || annualCons <= 0) {
    return Array.from({ length: 40 }, (_, i) => round((i + 1) * 0.5, 1));
  }
  const top = Math.min((annualCons / yieldPerKwp) * SEARCH_HEADROOM, 20_000);
  const step = top / CANDIDATE_COUNT;
  const decimals = step >= 5 ? 0 : step >= 0.5 ? 1 : step >= 0.05 ? 2 : 3;

  const sizes: number[] = [];
  for (let i = 1; i <= CANDIDATE_COUNT; i++) {
    const v = round(step * i, decimals);
    if (v > 0 && (!sizes.length || v > sizes[sizes.length - 1])) sizes.push(v);
  }
  return sizes;
}

function computeOne(
  consumption: Frame, gen: number[][], kwp: number, summer: boolean[],
  a: EconomicAssumptions, scale: number,
): CurveResult {
  let g = 0;
  let sc = 0;
  let summerExport = 0;
  consumption.rows.forEach((row, i) => {
    const gr = gen[i];
    for (let s = 0; s < 48; s++) {
      const gv = gr[s] * kwp;
      const used = Math.min(gv, row[s]);
      g += gv;
      sc += used;
      if (summer[i]) summerExport += gv - used;
    }
  });
  const exp = g - sc;
  const cons = total(consumption.rows);
  const money = appraise(kwp, sc * scale, exp * scale, a);

  return {
    kwp,
    sc_rate: g > 0 ? round(sc / g, 4) : 0,
    offset_rate: cons > 0 ? round(sc / cons, 4) : 0,
    annual_generation_kwh: round(g * scale, 1),
    self_consumed_kwh: round(sc * scale, 1),
    exported_kwh: round(exp * scale, 1),
    summer_export_kwh: round(summerExport * scale, 1),
    capex: money.capex,
    year_one_saving: money.year_one_saving,
    simple_payback_years: money.simple_payback_years,
    npv: money.npv,
    irr: money.irr,
    economics: money,
  };
}

function monthlyChart(consumption: Frame, gen: number[][], kwp: number): MonthlySolarPoint[] {
  const { dates } = consumption;
  const months = monthsBetween(dates[0], dates[dates.length - 1]).map((m) => ({
    ...m, cons: 0, gen: 0, sc: 0, days: 0,
  }));
  const index = new Map(months.map((m, i) => [m.key, i]));
  consumption.rows.forEach((row, i) => {
    const b = months[index.get(dates[i].slice(0, 7))!];
    b.days += 1;
    for (let s = 0; s < 48; s++) {
      const gv = gen[i][s] * kwp;
      b.cons += row[s];
      b.gen += gv;
      b.sc += Math.min(gv, row[s]);
    }
  });
  // A 366-day upload spills one day into a 13th month; drop near-empty ones.
  return months.filter((m) => m.days >= 15).map((m) => ({
    month: MONTHS_SHORT[m.m - 1],
    consumption_kwh: round(m.cons, 1),
    generation_kwh: round(m.gen, 1),
    self_consumed_kwh: round(m.sc, 1),
    exported_kwh: round(m.gen - m.sc, 1),
  }));
}

const paybackKey = (r: CurveResult) => r.simple_payback_years ?? Infinity;

/** First element with the smallest key, as Python's min() picks. */
function minBy<T>(xs: T[], key: (x: T) => number): T {
  return xs.reduce((best, x) => (key(x) < key(best) ? x : best));
}
function maxBy<T>(xs: T[], key: (x: T) => number): T {
  return xs.reduce((best, x) => (key(x) > key(best) ? x : best));
}

export function recommendSystemSize(
  consumption: Frame, gen1kwp: GenProfile, scMin: number, scMax: number,
  a: EconomicAssumptions,
): SizingResult {
  if (total(consumption.rows) <= 0) {
    throw new Error('The uploaded data contains no consumption. Check the file and try again.');
  }
  if (scMin > scMax) {
    throw new Error('Minimum self-consumption cannot be higher than the maximum.');
  }
  if (total(gen1kwp.rows) <= 0) {
    throw new Error(
      'The generation profile for this location is empty, so the array cannot be sized. '
      + 'This is a problem with the irradiance data, not with your consumption file.',
    );
  }

  const gen = alignGeneration(consumption, gen1kwp);
  const summer = consumption.dates.map((d) => SUMMER_MONTHS.has(parts(d).m));
  const days = consumption.dates.length;
  const scale = days ? 365.25 / days : 1;

  const curve = candidateSizes(consumption, gen).map(
    (k) => computeOne(consumption, gen, k, summer, a, scale),
  );

  const inBand = curve.filter((r) => r.sc_rate >= scMin && r.sc_rate <= scMax);
  const atOrAbove = curve.filter((r) => r.sc_rate >= scMin);
  let best: CurveResult;
  let warning: string | null = null;

  if (inBand.length) {
    best = minBy(inBand, paybackKey);
  } else if (atOrAbove.length) {
    best = maxBy(atOrAbove, (r) => r.kwp);
    warning = `Self-consumption stays above ${Math.trunc(scMax * 100)}% at every size tested, `
      + 'so the load absorbs everything the array can make. Roof area or grid capacity '
      + 'will set the size here, not the consumption profile.';
  } else {
    best = maxBy(curve, (r) => r.sc_rate);
    warning = `Could not reach ${Math.trunc(scMin * 100)}% self-consumption at any size. `
      + `Best is ${Math.trunc(best.sc_rate * 100)}% at ${best.kwp} kWp, because generation `
      + 'overlaps poorly with when this site draws power. Worth testing storage or a '
      + 'load-shifting case.';
  }

  // The largest system that still meets the minimum: most energy on site.
  const maxOnsite = atOrAbove.length ? maxBy(atOrAbove, (r) => r.kwp) : best;

  return {
    best,
    curve,
    alternative: maxOnsite === best ? null : maxOnsite,
    monthly: monthlyChart(consumption, gen, best.kwp),
    warning,
    days,
    annualConsumptionKwh: round(total(consumption.rows) * scale, 1),
  };
}
