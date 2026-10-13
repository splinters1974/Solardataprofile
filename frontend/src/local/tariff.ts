/**
 * Unit rates: one flat rate, or recurring time bands.
 *
 * Rates are entered in p/kWh and converted to £/kWh once, here. A band covers
 * chosen days of the week and a time window (which may cross midnight), and
 * can carry effective dates. Every interval must match exactly one band; the
 * check below reports any half hour with no rate or two, and a tariff that
 * fails it is not used (the flat rate is, with a warning on screen).
 *
 * Costs are estimates of energy cost at the rates entered. They exclude
 * standing, capacity and other fixed charges, and a past period priced at
 * today's rate is not that period's actual bill.
 */
import { dayOfWeek, fmtDayMonYear } from './dates';
import { inSlotWindow, isValid, SLOTS, type Frame } from './frame';
import { slotTime } from './calendar';

export interface TariffBand {
  id: string;
  name: string;
  rateP: number;
  /** Monday to Sunday. */
  days: boolean[];
  /** Half-hour window, start inclusive, end exclusive; start === end means all day; wraps midnight. */
  start: number;
  end: number;
  /** Effective dates, inclusive. Empty means always. */
  from?: string;
  to?: string;
}

export interface Tariff {
  mode: 'flat' | 'bands';
  bands: TariffBand[];
  /** Bank holidays use Sunday's bands. Needs the site calendar's holidays. */
  holidaysAsSunday: boolean;
}

export const flatTariff = (): Tariff => ({ mode: 'flat', bands: [], holidaysAsSunday: false });

export const ALL_DAYS = [true, true, true, true, true, true, true];
export const WEEKDAYS = [true, true, true, true, true, false, false];
export const WEEKENDS = [false, false, false, false, false, true, true];

/** A two-rate example to start editing from: day and night. */
export function exampleBands(dayP: number): TariffBand[] {
  return [
    { id: 'day', name: 'Day', rateP: dayP, days: ALL_DAYS.slice(), start: 14, end: 48 },
    { id: 'night', name: 'Night', rateP: Math.round(dayP * 0.7 * 100) / 100, days: ALL_DAYS.slice(), start: 0, end: 14 },
  ];
}

function bandApplies(b: TariffBand, date: string, dow: number, s: number): boolean {
  if (b.from && date < b.from) return false;
  if (b.to && date > b.to) return false;
  return b.days[dow] && inSlotWindow(s, b.start, b.end);
}

export interface PriceGrid {
  /** £/kWh for each day and half hour. */
  rows: Float64Array[];
  /** True when the time bands were used; false means the flat rate. */
  banded: boolean;
  /** Problems that stopped the bands being used, if any. */
  problems: string[];
  description: string;
}

/**
 * £/kWh for every interval of a frame. With bands, any interval matching no
 * band or more than one makes the tariff invalid, and the flat rate is used.
 */
export function priceGrid(f: Frame, tariff: Tariff | null, flatP: number, isHoliday: (d: string) => boolean): PriceGrid {
  const flat = flatP / 100;
  const flatGrid = (problems: string[] = []): PriceGrid => ({
    rows: f.dates.map(() => new Float64Array(SLOTS).fill(flat)),
    banded: false,
    problems,
    description: `${flatP}p/kWh flat`,
  });
  if (!tariff || tariff.mode === 'flat' || !tariff.bands.length) return flatGrid();

  const rows: Float64Array[] = [];
  let none = 0;
  let many = 0;
  let firstNone = '';
  let firstMany = '';
  f.dates.forEach((date, i) => {
    const dow = tariff.holidaysAsSunday && isHoliday(date) ? 6 : dayOfWeek(date);
    const row = new Float64Array(SLOTS);
    for (let s = 0; s < SLOTS; s++) {
      const hits = tariff.bands.filter((b) => bandApplies(b, date, dow, s));
      if (hits.length === 1) { row[s] = hits[0].rateP / 100; continue; }
      row[s] = flat;
      if (!isValid(f, i, s)) continue; // only intervals with readings need a rate
      if (!hits.length) { none++; if (!firstNone) firstNone = `${fmtDayMonYear(date)} ${slotTime(s)}`; }
      else { many++; if (!firstMany) firstMany = `${fmtDayMonYear(date)} ${slotTime(s)}`; }
    }
    rows.push(row);
  });
  const problems: string[] = [];
  if (none) problems.push(`${none} half hours have no rate (first: ${firstNone}).`);
  if (many) problems.push(`${many} half hours match more than one band (first: ${firstMany}).`);
  if (problems.length) return flatGrid(problems);
  return { rows, banded: true, problems: [], description: describeTariff(tariff) };
}

export function describeTariff(t: Tariff | null, flatP?: number): string {
  if (!t || t.mode === 'flat' || !t.bands.length) return flatP !== undefined ? `${flatP}p/kWh flat` : 'Flat rate';
  const short = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  return t.bands.map((b) => {
    const days = b.days.every(Boolean) ? 'every day'
      : b.days.slice(0, 5).every(Boolean) && !b.days[5] && !b.days[6] ? 'Mon-Fri'
        : !b.days.slice(0, 5).some(Boolean) && b.days[5] && b.days[6] ? 'Sat-Sun'
          : short.filter((_, k) => b.days[k]).join(', ');
    const time = b.start === b.end ? 'all day' : `${slotTime(b.start)}-${slotTime(b.end)}`;
    const dates = b.from || b.to ? ` (${b.from ? `from ${fmtDayMonYear(b.from)}` : ''}${b.to ? ` to ${fmtDayMonYear(b.to)}` : ''})` : '';
    return `${b.name} ${b.rateP}p ${days} ${time}${dates}`;
  }).join('; ') + (t.holidaysAsSunday ? '; bank holidays as Sunday' : '');
}
