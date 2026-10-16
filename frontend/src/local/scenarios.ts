/**
 * User-defined savings scenarios.
 *
 * Every active scenario is applied, in order, to one copy of the site's
 * valid half-hourly readings. Each takes its reduction from what is left
 * after the scenarios before it, so overlapping scenarios can never remove
 * the same energy twice, and no interval can go below its retained floor or
 * below zero. Nothing is reduced until a target is entered.
 *
 * Results are what the scenario would change in the observed period at the
 * rates entered. The annual projection, where shown, uses the site's
 * annualisation method and is shown separately. A scenario is an
 * assumption to test, not a verified saving. Demand or capacity charge
 * savings are not included: the tariff here is energy only.
 */
import { inSlotWindow, INTERVAL_HOURS, isValid, SLOTS, type Frame } from './frame';
import { dayOfWeek, fmtDayMonYear } from './dates';
import { slotTime, type DayPlan } from './calendar';
import type { PriceGrid } from './tariff';
import type { CarbonFactor } from './findings';

export interface Window { start: number; end: number }

interface Common {
  id: string;
  label: string;
  enabled: boolean;
}

/** A. Reduce a share of closed-hours demand above a reference. */
export interface ClosedExcessScenario extends Common {
  kind: 'closed-excess';
  share: number;
  reference: 'all' | 'closed';
}

/** B. Reduce base load by a kW figure during chosen hours. */
export interface BaseScenario extends Common {
  kind: 'base';
  kw: number;
  window: Window;
  days: boolean[];
  floorKw: number;
}

/** C. Remove a share of demand above a floor in early-start or late-stop windows. */
export interface ShoulderScenario extends Common {
  kind: 'shoulders';
  share: number;
  windows: Window[];
  days: boolean[];
  floorKw: number;
}

/**
 * D. Lower peak demand. 'cap' holds every half hour at or below a target kW
 * (peak lopping, the usual approach); 'top' trims the N highest half hours
 * and 'above' trims every half hour above a level, each by up to a kW figure.
 * The reduced energy is removed, or shifted to other hours the same day.
 */
export interface PeakScenario extends Common {
  kind: 'peaks';
  kw: number;
  select: 'cap' | 'top' | 'above';
  /** Top N half hours, or every half hour above this kW. */
  count: number;
  aboveKw: number;
  /** Target maximum demand for 'cap'. 0 means not set yet: no change. */
  capKw?: number;
  action: 'remove' | 'shift';
  /** Where shifted energy goes, the same day. */
  receive: Window;
  floorKw: number;
}

export type Scenario = ClosedExcessScenario | BaseScenario | ShoulderScenario | PeakScenario;

export const SCENARIO_LABEL: Record<Scenario['kind'], string> = {
  'closed-excess': 'A. Reduce closed-hours excess',
  base: 'B. Reduce base load in chosen hours',
  shoulders: 'C. Remove early-start or late-stop demand',
  peaks: 'D. Lower peak demand',
};

const ALL = [true, true, true, true, true, true, true];
const WEEKDAYS = [true, true, true, true, true, false, false];
const newId = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);

/** A new scenario of a kind, with no reduction until a target is entered. */
export function newScenario(kind: Scenario['kind']): Scenario {
  const base = { id: newId(), label: SCENARIO_LABEL[kind], enabled: true };
  switch (kind) {
    case 'closed-excess': return { ...base, kind, share: 0, reference: 'all' };
    case 'base': return { ...base, kind, kw: 0, window: { start: 0, end: 0 }, days: ALL.slice(), floorKw: 0 };
    case 'shoulders': return { ...base, kind, share: 0, windows: [{ start: 10, end: 14 }, { start: 38, end: 42 }], days: WEEKDAYS.slice(), floorKw: 0 };
    case 'peaks': return { ...base, kind, kw: 0, select: 'cap', capKw: 0, count: 10, aboveKw: 0, action: 'remove', receive: { start: 0, end: 12 }, floorKw: 0 };
  }
}

export interface ScenarioResult {
  id: string;
  label: string;
  kind: Scenario['kind'];
  /** Energy removed in the observed period (shifted energy is not removed). */
  kwhRemoved: number;
  kwhShifted: number;
  /** Cost change in the observed period at the rates entered (positive = lower cost). */
  costReduction: number;
  intervals: number;
  annualKwh: number | null;
  annualCost: number | null;
  tco2e: number | null;
  peakKwAfter: number | null;
  /** Days with at least one changed half hour. */
  days: number;
  assumptions: string[];
}

export interface ScenarioRun {
  results: ScenarioResult[];
  total: { kwh: number; cost: number; annualKwh: number | null; annualCost: number | null; tco2e: number | null };
  /** Mean kW by half hour across all days, before and after every active scenario. */
  profileBefore: number[];
  profileAfter: number[];
  /** The same, split into days the site opens and days it stays closed all day (weekends, holidays, closures). */
  profiles: Record<'all' | 'open' | 'closed', { before: number[]; after: number[]; days: number }>;
  peakBefore: number;
  peakAfter: number;
  /** Changed intervals, for the spreadsheet: before, after, and each scenario's change in kWh. */
  intervals: { date: string; slot: number; before: number; after: number; price: number; changes: number[] }[];
}

export interface ScenarioContext {
  frame: Frame;
  plans: DayPlan[];
  prices: PriceGrid;
  /** kW references for scenario A. */
  refs: { all: number; closed: number | null };
  annualFactor: number | null;
  carbon: CarbonFactor | null;
}

const H = INTERVAL_HOURS;
const days7 = (d: boolean[]) => (d.every(Boolean) ? 'every day' : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].filter((_, k) => d[k]).join(', ') || 'no days');
const win = (w: Window) => (w.start === w.end ? 'all day' : `${slotTime(w.start)}-${slotTime(w.end)}`);

export function runScenarios(ctx: ScenarioContext, scenarios: Scenario[]): ScenarioRun {
  const f = ctx.frame;
  const n = f.dates.length;
  const cur = f.rows.map((r) => r.slice());
  const valid = (i: number, s: number) => isValid(f, i, s);
  const active = scenarios.filter((s) => s.enabled);
  const changes = new Map<number, number[]>(); // i*48+s -> per active scenario change (kWh, + = removed)
  const note = (k: number, i: number, s: number, kwh: number) => {
    const key = i * SLOTS + s;
    let arr = changes.get(key);
    if (!arr) { arr = new Array(active.length).fill(0); changes.set(key, arr); }
    arr[k] += kwh;
  };
  const results: ScenarioResult[] = [];
  const carbonOf = (kwh: number) => (ctx.carbon ? (kwh * ctx.carbon.kgPerKwh) / 1000 : null);

  active.forEach((sc, k) => {
    let removed = 0;
    let shifted = 0;
    let cost = 0;
    let touched = 0;
    const dayHit = new Set<number>();
    const assumptions: string[] = [];
    const take = (i: number, s: number, amount: number) => {
      if (amount <= 0) return;
      cur[i][s] -= amount;
      removed += amount;
      cost += amount * ctx.prices.rows[i][s];
      touched++;
      dayHit.add(i);
      note(k, i, s, amount);
    };

    if (sc.kind === 'closed-excess') {
      const ref = sc.reference === 'closed' && ctx.refs.closed !== null ? ctx.refs.closed : ctx.refs.all;
      const share = Math.max(0, Math.min(1, sc.share));
      for (let i = 0; i < n; i++) {
        for (let s = 0; s < SLOTS; s++) {
          if (!valid(i, s) || ctx.plans[i].open[s]) continue;
          take(i, s, share * Math.max(0, cur[i][s] - ref * H));
        }
      }
      assumptions.push(`${Math.round(share * 100)}% of demand above ${ref.toFixed(1)} kW (${sc.reference === 'closed' && ctx.refs.closed !== null ? 'closed-hours' : 'all-period'} reference) removed in every closed half hour.`);
    } else if (sc.kind === 'base') {
      const kw = Math.max(0, sc.kw);
      const floor = Math.max(0, sc.floorKw);
      for (let i = 0; i < n; i++) {
        if (!sc.days[dayOfWeek(f.dates[i])]) continue;
        for (let s = 0; s < SLOTS; s++) {
          if (!valid(i, s) || !inSlotWindow(s, sc.window.start, sc.window.end)) continue;
          take(i, s, Math.min(kw * H, Math.max(0, cur[i][s] - floor * H)));
        }
      }
      assumptions.push(`${kw} kW less demand ${win(sc.window)}, ${days7(sc.days)}, never below a retained floor of ${floor} kW.`);
    } else if (sc.kind === 'shoulders') {
      const share = Math.max(0, Math.min(1, sc.share));
      const floor = Math.max(0, sc.floorKw);
      for (let i = 0; i < n; i++) {
        if (!sc.days[dayOfWeek(f.dates[i])]) continue;
        for (let s = 0; s < SLOTS; s++) {
          if (!valid(i, s) || !sc.windows.some((w) => inSlotWindow(s, w.start, w.end))) continue;
          take(i, s, share * Math.max(0, cur[i][s] - floor * H));
        }
      }
      assumptions.push(`${Math.round(share * 100)}% of demand above a ${floor} kW floor removed in ${sc.windows.map(win).join(' and ')}, ${days7(sc.days)}.`);
    } else {
      const kw = Math.max(0, sc.kw);
      const floor = Math.max(0, sc.floorKw);
      // Select on the readings as they stand after earlier scenarios.
      const cands: [number, number][] = [];
      for (let i = 0; i < n; i++) for (let s = 0; s < SLOTS; s++) if (valid(i, s)) cands.push([i, s]);
      let picked: [number, number][];
      const cap = Math.max(0, sc.capKw ?? 0);
      if (sc.select === 'cap') {
        picked = cap > 0 ? cands.filter(([i, s]) => cur[i][s] / H > cap) : [];
      } else if (sc.select === 'top') {
        cands.sort((a, b) => cur[b[0]][b[1]] - cur[a[0]][a[1]]);
        picked = cands.slice(0, Math.max(0, Math.round(sc.count)));
      } else {
        picked = cands.filter(([i, s]) => cur[i][s] / H > sc.aboveKw);
      }
      const receiveSlots = (i: number) => {
        const out: number[] = [];
        for (let s = 0; s < SLOTS; s++) if (valid(i, s) && inSlotWindow(s, sc.receive.start, sc.receive.end)) out.push(s);
        return out;
      };
      const shiftedByDay = new Map<number, number>();
      let unplaced = 0;
      for (const [i, s] of picked) {
        const amount = sc.select === 'cap'
          ? Math.max(0, cur[i][s] - cap * H)
          : Math.min(kw * H, Math.max(0, cur[i][s] - floor * H));
        if (amount <= 0) continue;
        if (sc.action === 'remove') { take(i, s, amount); continue; }
        if (sc.receive.start !== sc.receive.end && inSlotWindow(s, sc.receive.start, sc.receive.end)) continue;
        if (!receiveSlots(i).length) { unplaced += amount; continue; } // nowhere to put it: leave as is
        cur[i][s] -= amount;
        shifted += amount;
        cost += amount * ctx.prices.rows[i][s];
        touched++;
        dayHit.add(i);
        note(k, i, s, amount);
        shiftedByDay.set(i, (shiftedByDay.get(i) ?? 0) + amount);
      }
      for (const [i, amount] of shiftedByDay) {
        const slots = receiveSlots(i);
        const each = amount / slots.length;
        for (const s of slots) {
          cur[i][s] += each;
          cost -= each * ctx.prices.rows[i][s];
          note(k, i, s, -each);
        }
      }
      assumptions.push(sc.select === 'cap'
        ? (cap > 0 ? `Demand held at or below ${cap} kW: every half hour above it brought down to ${cap} kW.` : 'No target maximum entered yet.')
        : sc.select === 'top'
          ? `The ${sc.count} highest half hours (after earlier scenarios) reduced by up to ${kw} kW, not below ${floor} kW.`
          : `Every half hour above ${sc.aboveKw} kW reduced by up to ${kw} kW, not below ${floor} kW.`);
      assumptions.push(sc.action === 'remove'
        ? 'Energy removed (not moved elsewhere).'
        : `Energy shifted, not removed: it reappears spread evenly over ${win(sc.receive)} the same day. Only the price difference changes cost.${unplaced ? ` ${unplaced.toFixed(0)} kWh had no receiving half hours that day and was left where it was.` : ''}`);
    }

    let peakAfter: number | null = null;
    if (sc.kind === 'peaks') {
      let pk = 0;
      for (let i = 0; i < n; i++) for (let s = 0; s < SLOTS; s++) if (valid(i, s) && cur[i][s] > pk) pk = cur[i][s];
      peakAfter = pk / H;
    }
    const fct = ctx.annualFactor;
    results.push({
      id: sc.id, label: sc.label, kind: sc.kind, kwhRemoved: removed, kwhShifted: shifted, costReduction: cost,
      intervals: touched,
      annualKwh: fct !== null ? removed * fct : null,
      annualCost: fct !== null ? cost * fct : null,
      tco2e: carbonOf(removed),
      peakKwAfter: peakAfter,
      days: dayHit.size,
      assumptions,
    });
  });

  const mean = (rows: number[][], keep: (i: number) => boolean = () => true) => {
    const tot = new Array(SLOTS).fill(0);
    const cnt = new Array(SLOTS).fill(0);
    rows.forEach((r, i) => { if (keep(i)) for (let s = 0; s < SLOTS; s++) if (valid(i, s)) { tot[s] += r[s]; cnt[s]++; } });
    return tot.map((t, s) => (cnt[s] ? t / cnt[s] / H : 0));
  };
  const opens = (i: number) => ctx.plans[i]?.open.some(Boolean) ?? true;
  const countDays = (keep: (i: number) => boolean) => f.dates.reduce((a, _, i) => a + (keep(i) ? 1 : 0), 0);
  const split = (keep: (i: number) => boolean) => ({ before: mean(f.rows, keep), after: mean(cur, keep), days: countDays(keep) });
  const peakOf = (rows: number[][]) => {
    let pk = 0;
    rows.forEach((r, i) => { for (let s = 0; s < SLOTS; s++) if (valid(i, s) && r[s] > pk) pk = r[s]; });
    return pk / H;
  };
  const totalKwh = results.reduce((a, r) => a + r.kwhRemoved, 0);
  const totalCost = results.reduce((a, r) => a + r.costReduction, 0);
  const intervals = [...changes.entries()].sort((a, b) => a[0] - b[0]).map(([key, ch]) => {
    const i = Math.floor(key / SLOTS);
    const s = key % SLOTS;
    return { date: f.dates[i], slot: s, before: f.rows[i][s], after: cur[i][s], price: ctx.prices.rows[i][s], changes: ch };
  });
  return {
    results,
    total: {
      kwh: totalKwh, cost: totalCost,
      annualKwh: ctx.annualFactor !== null ? totalKwh * ctx.annualFactor : null,
      annualCost: ctx.annualFactor !== null ? totalCost * ctx.annualFactor : null,
      tco2e: carbonOf(totalKwh),
    },
    profileBefore: mean(f.rows),
    profileAfter: mean(cur),
    profiles: { all: split(() => true), open: split(opens), closed: split((i) => !opens(i)) },
    peakBefore: peakOf(f.rows),
    peakAfter: peakOf(cur),
    intervals,
  };
}

export function describeScenario(sc: Scenario): string {
  switch (sc.kind) {
    case 'closed-excess': return `${Math.round(sc.share * 100)}% of closed-hours excess (${sc.reference === 'closed' ? 'closed-hours' : 'all-period'} reference)`;
    case 'base': return `${sc.kw} kW ${win(sc.window)}, ${days7(sc.days)}, floor ${sc.floorKw} kW`;
    case 'shoulders': return `${Math.round(sc.share * 100)}% above ${sc.floorKw} kW in ${sc.windows.map(win).join(' and ')}, ${days7(sc.days)}`;
    case 'peaks': {
      const how = sc.action === 'remove' ? 'removed' : `shifted to ${win(sc.receive)}`;
      if (sc.select === 'cap') return `maximum demand held at ${sc.capKw ?? 0} kW, ${how}`;
      return `${sc.select === 'top' ? `top ${sc.count} half hours` : `half hours above ${sc.aboveKw} kW`} cut by ${sc.kw} kW, ${how}`;
    }
  }
}

export const fmtDateSlot = (date: string, slot: number) => `${fmtDayMonYear(date)} ${slotTime(slot)}`;
