/**
 * Electrification headroom: how much load can be added (heat pumps, EV
 * charging, new plant) before the site outgrows its agreed supply capacity.
 *
 * Works in kVA, because capacity is agreed in kVA. Metered kW is converted
 * at the site's power factor. A safety margin is held back from capacity,
 * since running a supply at 100% leaves nothing for start-up currents or
 * a colder winter than the one in the data.
 */
import { KW_PER_KWH_PER_HH, round } from './analytics';
import { MONTHS_SHORT, monthsBetween, parts } from './dates';
import type { Frame } from './parser';

export interface TestLoad {
  kw: number;
  /** Half-hour slots it runs between, start inclusive, end exclusive. Wraps midnight if start > end. */
  start: number;
  end: number;
  /** 'heating' is October to April. */
  months: 'all' | 'heating';
}

export interface HeadroomInput {
  capacityKva: number;
  powerFactor: number;
  marginPct: number;
  test?: TestLoad | null;
}

export interface HeadroomResult {
  capacityKva: number;
  usableKva: number;
  peakKva: number;
  peakWhen: string;
  /** Largest constant load that fits at every half hour of the year, in kW. */
  firmHeadroomKw: number;
  monthly: { month: string; peakKva: number; headroomKw: number }[];
  /** Worst case in each half hour of the day across the whole period. */
  worstByTime: { slot: number; kva: number }[];
  /** Same, winter months only (Dec, Jan, Feb), which is usually the pinch. */
  worstWinterByTime: { slot: number; kva: number }[];
  test: null | {
    fits: boolean;
    halfHoursOver: number;
    daysOver: number;
    worstOverKva: number;
    worstWhen: string;
    peakWithLoadKva: number;
    summary: string;
  };
}

export const HEATING_MONTHS = new Set([10, 11, 12, 1, 2, 3, 4]);
const WINTER = new Set([12, 1, 2]);

export function inWindow(slot: number, start: number, end: number): boolean {
  if (start === end) return true; // all day
  return start < end ? slot >= start && slot < end : slot >= start || slot < end;
}

const label = (s: number) =>
  `${String(Math.floor(s / 2)).padStart(2, '0')}:${s % 2 ? '30' : '00'}`;

const shortDate = (d: string) => {
  const p = parts(d);
  return `${p.d} ${MONTHS_SHORT[p.m - 1]} ${p.y}`;
};

export function analyseHeadroom(frame: Frame, input: HeadroomInput): HeadroomResult {
  const pf = input.powerFactor > 0 ? input.powerFactor : 0.95;
  const usableKva = input.capacityKva * (1 - input.marginPct / 100);
  const toKva = (kwh: number) => (kwh * KW_PER_KWH_PER_HH) / pf;

  let peakKva = 0;
  let peakAt = [0, 0];
  const worst = new Array(48).fill(0);
  const worstWinter = new Array(48).fill(0);
  frame.rows.forEach((r, i) => {
    const winter = WINTER.has(parts(frame.dates[i]).m);
    r.forEach((v, s) => {
      const kva = toKva(v);
      if (kva > peakKva) { peakKva = kva; peakAt = [i, s]; }
      if (kva > worst[s]) worst[s] = kva;
      if (winter && kva > worstWinter[s]) worstWinter[s] = kva;
    });
  });

  const n = frame.dates.length;
  const monthly = n ? monthsBetween(frame.dates[0], frame.dates[n - 1]).flatMap((m) => {
    let peak = 0;
    let any = false;
    frame.dates.forEach((d, i) => {
      if (d.slice(0, 7) !== m.key) return;
      any = true;
      for (const v of frame.rows[i]) peak = Math.max(peak, toKva(v));
    });
    return any ? [{
      month: `${MONTHS_SHORT[m.m - 1]} ${String(m.y).slice(2)}`,
      peakKva: round(peak, 1),
      headroomKw: round((usableKva - peak) * pf, 1),
    }] : [];
  }) : [];

  let test: HeadroomResult['test'] = null;
  const t = input.test;
  if (t && t.kw > 0) {
    const addKva = t.kw / pf;
    let over = 0;
    let worstOver = 0;
    let worstAt = [0, 0];
    let peakWith = 0;
    const days = new Set<number>();
    const monthsOver = new Map<number, number>();
    frame.rows.forEach((r, i) => {
      const m = parts(frame.dates[i]).m;
      const monthOn = t.months === 'all' || HEATING_MONTHS.has(m);
      r.forEach((v, s) => {
        const kva = toKva(v) + (monthOn && inWindow(s, t.start, t.end) ? addKva : 0);
        if (kva > peakWith) peakWith = kva;
        const excess = kva - usableKva;
        if (excess > 0) {
          over++;
          days.add(i);
          monthsOver.set(m, (monthsOver.get(m) ?? 0) + 1);
          if (excess > worstOver) { worstOver = excess; worstAt = [i, s]; }
        }
      });
    });
    const fits = over === 0;
    const busiest = [...monthsOver.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([m]) => MONTHS_SHORT[m - 1]);
    const window = t.start === t.end ? 'all day' : `${label(t.start)} to ${label(t.end % 48)}`;
    const season = t.months === 'heating' ? 'October to April' : 'all year';
    test = {
      fits,
      halfHoursOver: over,
      daysOver: days.size,
      worstOverKva: round(worstOver, 1),
      worstWhen: fits ? '' : `${shortDate(frame.dates[worstAt[0]])} at ${label(worstAt[1])}`,
      peakWithLoadKva: round(peakWith, 1),
      summary: fits
        ? `A ${t.kw} kW load running ${window}, ${season}, fits. Peak with it would be `
          + `${Math.round(peakWith)} kVA against ${Math.round(usableKva)} kVA usable.`
        : `A ${t.kw} kW load running ${window}, ${season}, would take the site over its usable capacity in `
          + `${over} half hour${over > 1 ? 's' : ''} on ${days.size} day${days.size > 1 ? 's' : ''}, mostly in `
          + `${busiest.join(', ')}. The worst is ${Math.round(worstOver)} kVA over, on `
          + `${shortDate(frame.dates[worstAt[0]])} at ${label(worstAt[1])}. Either a capacity increase, a smaller `
          + 'load, or controls that hold it off at peak times.',
    };
  }

  return {
    capacityKva: input.capacityKva,
    usableKva: round(usableKva, 1),
    peakKva: round(peakKva, 1),
    peakWhen: n ? `${shortDate(frame.dates[peakAt[0]])} at ${label(peakAt[1])}` : '',
    firmHeadroomKw: round((usableKva - peakKva) * pf, 1),
    monthly,
    worstByTime: worst.map((kva, slot) => ({ slot, kva: round(kva, 1) })),
    worstWinterByTime: worstWinter.map((kva, slot) => ({ slot, kva: round(kva, 1) })),
    test,
  };
}
