/**
 * Per-site metrics and findings: what is worth looking at, and what it costs.
 *
 * Every £ figure is consumption x one fully delivered unit rate, annualised
 * to a year from however many days were uploaded. The figures say what a
 * pattern costs now. They are not savings promises: how much of it can be
 * removed is an engineering judgement on site.
 */
import { dayOfWeek, fmtDayMonYear, monthsBetween, MONTHS_SHORT } from './dates';
import { holidaysBetween } from './holidays';
import { hhLabels, KW_PER_KWH_PER_HH, round } from './analytics';
import type { Frame } from './parser';

// --- Settings ---------------------------------------------------------------

/** Open from `open` to `close`, in half-hour slots (0 = 00:00, 48 = midnight). */
export type DayHours = { open: number; close: number } | null;

export interface OpeningHours {
  weekday: DayHours;
  saturday: DayHours;
  sunday: DayHours;
  /** Bank holidays follow Sunday hours when true, weekday hours when false. */
  holidaysLikeSunday: boolean;
}

export type SiteType = 'office' | 'school' | 'health' | 'leisure' | 'retail' | 'industrial' | 'custom';

export const SITE_TYPES: Record<SiteType, { label: string; hours: OpeningHours; note: string }> = {
  office: {
    label: 'Office / commercial',
    hours: { weekday: { open: 14, close: 38 }, saturday: null, sunday: null, holidaysLikeSunday: true },
    note: 'Open 07:00 to 19:00 weekdays, closed weekends and bank holidays.',
  },
  school: {
    label: 'School / education',
    hours: { weekday: { open: 14, close: 35 }, saturday: null, sunday: null, holidaysLikeSunday: true },
    note: 'Open 07:00 to 17:30 weekdays. School holidays count as out of hours in full, '
      + 'which is usually right: the building should be close to base load then.',
  },
  health: {
    label: 'Hospital / 24-7 estate',
    hours: {
      weekday: { open: 0, close: 48 }, saturday: { open: 0, close: 48 },
      sunday: { open: 0, close: 48 }, holidaysLikeSunday: true,
    },
    note: 'Occupied around the clock, so there is no out-of-hours analysis. Base load '
      + 'and peak findings still apply.',
  },
  leisure: {
    label: 'Leisure centre',
    hours: {
      weekday: { open: 12, close: 45 }, saturday: { open: 14, close: 40 },
      sunday: { open: 14, close: 40 }, holidaysLikeSunday: true,
    },
    note: 'Open 06:00 to 22:30 weekdays, 07:00 to 20:00 weekends.',
  },
  retail: {
    label: 'Retail',
    hours: {
      weekday: { open: 15, close: 41 }, saturday: { open: 15, close: 41 },
      sunday: { open: 19, close: 33 }, holidaysLikeSunday: true,
    },
    note: 'Open 07:30 to 20:30 Monday to Saturday, 09:30 to 16:30 Sunday.',
  },
  industrial: {
    label: 'Industrial (two shift)',
    hours: { weekday: { open: 12, close: 44 }, saturday: null, sunday: null, holidaysLikeSunday: true },
    note: 'Running 06:00 to 22:00 weekdays.',
  },
  custom: {
    label: 'Custom hours',
    hours: { weekday: { open: 16, close: 36 }, saturday: null, sunday: null, holidaysLikeSunday: true },
    note: 'Set the hours to match the site.',
  },
};

export const DEFAULT_RATE_P = 25;
export const DEFAULT_POWER_FACTOR = 0.95;

export interface SiteSettings {
  name: string;
  type: SiteType;
  hours: OpeningHours;
  /** p/kWh fully delivered. Null means use the portfolio default. */
  rateP: number | null;
  /** Agreed supply capacity in kVA, if known. */
  capacityKva: number | null;
  powerFactor: number;
}

export function defaultSettings(name: string): SiteSettings {
  return {
    name,
    type: 'office',
    hours: structuredClone(SITE_TYPES.office.hours),
    rateP: null,
    capacityKva: null,
    powerFactor: DEFAULT_POWER_FACTOR,
  };
}

// --- Results ----------------------------------------------------------------

export type Level = 'high' | 'medium' | 'low' | 'info';

export interface Finding {
  key: string;
  level: Level;
  title: string;
  detail: string;
  /** What the pattern costs a year, where it can be priced. */
  annualGbp?: number;
}

export interface SiteMetrics {
  days: number;
  dateFrom: string;
  dateTo: string;
  rateP: number;
  annualKwh: number;
  annualCost: number;
  peakKw: number;
  peakWhen: string;
  averageKw: number;
  loadFactor: number;
  baseKw: number;
  baseAnnualKwh: number;
  baseCost: number;
  baseShare: number;
  hasOutOfHours: boolean;
  oohShare: number;
  oohAnnualKwh: number;
  oohCost: number;
  /** Out-of-hours consumption above base load: the addressable part. */
  oohExcessAnnualKwh: number;
  oohExcessCost: number;
  monthlyBaseKw: { month: string; kw: number }[];
  unusualDays: { date: string; kwh: number; typical: number; kind: string }[];
  findings: Finding[];
}

const BASE_PERCENTILE = 0.05;

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))));
  return sorted[i];
}

function median(xs: number[]): number {
  return percentile([...xs].sort((a, b) => a - b), 0.5);
}

/** Is each half hour of this date inside opening hours? */
export function openMask(date: string, hours: OpeningHours, holidays: Set<string>): boolean[] {
  const dow = dayOfWeek(date);
  let spec: DayHours;
  if (holidays.has(date)) spec = hours.holidaysLikeSunday ? hours.sunday : hours.weekday;
  else if (dow === 5) spec = hours.saturday;
  else if (dow === 6) spec = hours.sunday;
  else spec = hours.weekday;
  return Array.from({ length: 48 }, (_, s) => !!spec && s >= spec.open && s < spec.close);
}

export const slotLabel = (slot: number) => (slot >= 48 ? '24:00' : hhLabels()[slot]);

export function describeHours(h: OpeningHours): string {
  const part = (d: DayHours) => (d ? `${slotLabel(d.open)}-${slotLabel(d.close)}` : 'closed');
  return `Weekdays ${part(h.weekday)}, Saturday ${part(h.saturday)}, Sunday ${part(h.sunday)}`;
}

const gbp = (v: number) => `£${Math.round(v).toLocaleString('en-GB')}`;
const kwhFmt = (v: number) => `${Math.round(v).toLocaleString('en-GB')} kWh`;
const kwFmt = (v: number) => `${v.toLocaleString('en-GB', { maximumFractionDigits: 1 })} kW`;

/** Sized against the site's own bill, so a £2k item matters more at a small site. */
function levelFor(gbpValue: number, annualCost: number): Level {
  const share = annualCost > 0 ? gbpValue / annualCost : 0;
  if (share >= 0.1) return 'high';
  if (share >= 0.04) return 'medium';
  return 'low';
}

export function analyseSite(frame: Frame, settings: SiteSettings, defaultRateP: number): SiteMetrics {
  const rateP = settings.rateP ?? defaultRateP;
  const price = rateP / 100;
  const n = frame.dates.length;
  const scale = n ? 365.25 / n : 1;
  const holidays = n ? holidaysBetween(frame.dates[0], frame.dates[n - 1]) : new Set<string>();
  const labels = hhLabels();

  const kwAll: number[] = [];
  let total = 0;
  let peak = -Infinity;
  let peakAt = [0, 0];
  frame.rows.forEach((r, i) => r.forEach((v, s) => {
    total += v;
    kwAll.push(v * KW_PER_KWH_PER_HH);
    if (v > peak) { peak = v; peakAt = [i, s]; }
  }));
  const sortedKw = [...kwAll].sort((a, b) => a - b);
  // Base load: the 5th percentile of half-hourly demand. The minimum is too
  // easily a meter dropout reading zero.
  const baseKw = percentile(sortedKw, BASE_PERCENTILE);
  const peakKw = peak * KW_PER_KWH_PER_HH;
  const averageKw = kwAll.length ? (total / kwAll.length) * KW_PER_KWH_PER_HH : 0;
  const annualKwh = total * scale;
  const annualCost = annualKwh * price;
  const baseAnnualKwh = baseKw * 8766;

  // Out of hours.
  const masks = frame.dates.map((d) => openMask(d, settings.hours, holidays));
  const hasOutOfHours = masks.some((m) => m.some((open) => !open));
  let ooh = 0;
  let oohExcess = 0;
  frame.rows.forEach((r, i) => r.forEach((v, s) => {
    if (masks[i][s]) return;
    ooh += v;
    oohExcess += Math.max(0, v * KW_PER_KWH_PER_HH - baseKw) / KW_PER_KWH_PER_HH;
  }));

  // Base load by month, to spot creep.
  const monthlyBaseKw = n ? monthsBetween(frame.dates[0], frame.dates[n - 1]).flatMap((m) => {
    const vals: number[] = [];
    frame.dates.forEach((d, i) => {
      if (d.slice(0, 7) === m.key) for (const v of frame.rows[i]) vals.push(v * KW_PER_KWH_PER_HH);
    });
    if (vals.length < 48 * 20) return []; // too few days to call
    return [{ month: `${MONTHS_SHORT[m.m - 1]} ${m.y}`, kw: round(percentile(vals.sort((a, b) => a - b), BASE_PERCENTILE), 2) }];
  }) : [];

  // Unusual days, judged against days of the same kind.
  const daily = frame.rows.map((r) => r.reduce((a, b) => a + b, 0));
  const kindOf = (d: string) => {
    if (holidays.has(d)) return 'Bank holiday';
    const dow = dayOfWeek(d);
    return dow === 5 ? 'Saturday' : dow === 6 ? 'Sunday' : 'Weekday';
  };
  const byKind = new Map<string, number[]>();
  frame.dates.forEach((d, i) => {
    const k = kindOf(d) === 'Bank holiday' ? 'Sunday' : kindOf(d);
    if (!byKind.has(k)) byKind.set(k, []);
    byKind.get(k)!.push(daily[i]);
  });
  const typical = new Map([...byKind].map(([k, v]) => [k, median(v)]));
  const spread = new Map([...byKind].map(([k, v]) => {
    const med = typical.get(k)!;
    return [k, median(v.map((x) => Math.abs(x - med))) * 1.4826];
  }));
  const unusualDays = frame.dates.flatMap((d, i) => {
    const kind = kindOf(d);
    const k = kind === 'Bank holiday' ? 'Sunday' : kind;
    const med = typical.get(k) ?? 0;
    const sd = spread.get(k) ?? 0;
    const off = Math.abs(daily[i] - med);
    // Robust outlier test, and a real-world floor so a flat site does not
    // flag every small wobble.
    if (sd > 0 && off > 4 * sd && off > med * 0.25) {
      return [{ date: d, kwh: round(daily[i], 1), typical: round(med, 1), kind }];
    }
    return [];
  }).sort((a, b) => Math.abs(b.kwh - b.typical) - Math.abs(a.kwh - a.typical));

  const findings: Finding[] = [];

  // 1. Out-of-hours load above base.
  if (hasOutOfHours && ooh > 0) {
    const excessCost = oohExcess * scale * price;
    findings.push({
      key: 'ooh',
      level: levelFor(excessCost, annualCost),
      title: `Out-of-hours use above base load costs ${gbp(excessCost)} a year`,
      detail: `${Math.round((ooh / total) * 100)}% of consumption (${kwhFmt(ooh * scale)} a year) `
        + `falls outside opening hours. Of that, ${kwhFmt(oohExcess * scale)} sits above the `
        + `site's base load, which points to plant, lighting or heating running when the `
        + 'building is closed. Check time controls and BMS schedules first.',
      annualGbp: excessCost,
    });
  }

  // 2. Base load.
  const baseShare = annualKwh > 0 ? baseAnnualKwh / annualKwh : 0;
  const baseCost = baseAnnualKwh * price;
  findings.push({
    key: 'base',
    level: baseShare >= 0.5 && hasOutOfHours ? 'medium' : 'info',
    title: `Base load of ${kwFmt(baseKw)} runs all year, costing ${gbp(baseCost)}`,
    detail: `${Math.round(baseShare * 100)}% of consumption is load that never switches off. `
      + `Each 1 kW removed from base load saves ${kwhFmt(8766)} and ${gbp(8766 * price)} a year. `
      + (hasOutOfHours && baseShare >= 0.5
        ? 'That share is high for a site that closes, so it is worth listing what runs overnight.'
        : 'Typical culprits are servers, refrigeration, ventilation and equipment left on standby.'),
    annualGbp: baseCost,
  });

  // 3. Weekend running at a site that closes at weekends.
  const closedWeekends = !settings.hours.saturday && !settings.hours.sunday;
  if (closedWeekends) {
    const weekdayMed = typical.get('Weekday') ?? 0;
    const weekendDays = [...(byKind.get('Saturday') ?? []), ...(byKind.get('Sunday') ?? [])];
    const weekendMed = weekendDays.length ? median(weekendDays) : 0;
    const ratio = weekdayMed > 0 ? weekendMed / weekdayMed : 0;
    if (ratio >= 0.5) {
      findings.push({
        key: 'weekend',
        level: ratio >= 0.7 ? 'high' : 'medium',
        title: `Weekends use ${Math.round(ratio * 100)}% of a weekday`,
        detail: `A typical weekend day uses ${kwhFmt(weekendMed)} against ${kwhFmt(weekdayMed)} on `
          + 'a weekday, at a site set as closed at weekends. Either it is not closed, or '
          + 'something is left running. The out-of-hours figure above includes this.',
      });
    }
  }

  // 4. Bank holidays that look like working days.
  const closedHolidays = settings.hours.holidaysLikeSunday && !settings.hours.sunday;
  if (closedHolidays) {
    const weekdayMed = typical.get('Weekday') ?? 0;
    const busy = frame.dates.filter((d, i) => holidays.has(d) && weekdayMed > 0 && daily[i] >= 0.8 * weekdayMed);
    if (busy.length) {
      findings.push({
        key: 'holidays',
        level: 'medium',
        title: `${busy.length} bank holiday${busy.length > 1 ? 's' : ''} look like normal working days`,
        detail: `${busy.map(fmtDayMonYear).join(', ')} used at least 80% of a typical weekday. `
          + 'If the site was closed, the heating or plant schedule did not know about it.',
      });
    }
  }

  // 5. Base load creep, comparing the same month a year apart. Comparing
  // early months with late ones in a single year measures the seasons, not
  // creep, so with under about 14 months of data this stays silent.
  const byMonth = new Map(monthlyBaseKw.map((m) => [m.month, m.kw]));
  const pairs = monthlyBaseKw.flatMap((m) => {
    const [mon, year] = m.month.split(' ');
    const later = byMonth.get(`${mon} ${Number(year) + 1}`);
    return later !== undefined ? [[m.kw, later] as const] : [];
  });
  if (pairs.length >= 2) {
    const before = pairs.reduce((a, p) => a + p[0], 0) / pairs.length;
    const after = pairs.reduce((a, p) => a + p[1], 0) / pairs.length;
    if (before > 0 && after / before >= 1.15) {
      const extra = (after - before) * 8766 * price;
      findings.push({
        key: 'creep',
        level: levelFor(extra, annualCost),
        title: `Base load is up ${Math.round((after / before - 1) * 100)}% on a year earlier`,
        detail: `Comparing the same ${pairs.length} months a year apart, base load moved from about `
          + `${kwFmt(before)} to ${kwFmt(after)}. Left in place, the increase costs about `
          + `${gbp(extra)} a year. Check what was added or changed on site.`,
        annualGbp: extra,
      });
    }
  }

  // 6. Unusual days.
  if (unusualDays.length) {
    const top = unusualDays.slice(0, 3)
      .map((u) => `${fmtDayMonYear(u.date)} (${kwhFmt(u.kwh)} vs ${kwhFmt(u.typical)} typical)`).join('; ');
    findings.push({
      key: 'unusual',
      level: 'low',
      title: `${unusualDays.length} unusual day${unusualDays.length > 1 ? 's' : ''}`,
      detail: `Days well outside the normal range for their day of the week. Largest: ${top}. `
        + 'Worth checking against site events, faults or missing data.',
    });
  }

  // 7. Supply capacity.
  if (settings.capacityKva && settings.capacityKva > 0) {
    const peakKva = peakKw / (settings.powerFactor || DEFAULT_POWER_FACTOR);
    const used = peakKva / settings.capacityKva;
    if (used >= 0.9) {
      findings.push({
        key: 'capacity',
        level: 'high',
        title: `Peak demand uses ${Math.round(used * 100)}% of supply capacity`,
        detail: `Peak of about ${Math.round(peakKva)} kVA against ${settings.capacityKva} kVA agreed. `
          + 'Little headroom for heat pumps, EV charging or new plant without a capacity '
          + 'increase. Exceeding it can bring excess capacity charges.',
      });
    } else if (used <= 0.5) {
      findings.push({
        key: 'capacity',
        level: 'info',
        title: `Peak demand uses only ${Math.round(used * 100)}% of supply capacity`,
        detail: `Peak of about ${Math.round(peakKva)} kVA against ${settings.capacityKva} kVA agreed. `
          + 'The site may be paying capacity charges for headroom it does not use, or has room '
          + 'for electrification (heat pumps, EV charging) without reinforcement.',
      });
    }
  }

  const order: Record<Level, number> = { high: 0, medium: 1, low: 2, info: 3 };
  findings.sort((a, b) => order[a.level] - order[b.level] || (b.annualGbp ?? 0) - (a.annualGbp ?? 0));

  return {
    days: n,
    dateFrom: frame.dates[0],
    dateTo: frame.dates[n - 1],
    rateP,
    annualKwh: round(annualKwh),
    annualCost: round(annualCost),
    peakKw: round(peakKw, 1),
    peakWhen: n ? `${fmtDayMonYear(frame.dates[peakAt[0]])} at ${labels[peakAt[1]]}` : '',
    averageKw: round(averageKw, 1),
    loadFactor: peakKw > 0 ? round(averageKw / peakKw, 3) : 0,
    baseKw: round(baseKw, 1),
    baseAnnualKwh: round(baseAnnualKwh),
    baseCost: round(baseCost),
    baseShare: round(baseShare, 3),
    hasOutOfHours,
    oohShare: total > 0 ? round(ooh / total, 3) : 0,
    oohAnnualKwh: round(ooh * scale),
    oohCost: round(ooh * scale * price),
    oohExcessAnnualKwh: round(oohExcess * scale),
    oohExcessCost: round(oohExcess * scale * price),
    monthlyBaseKw,
    unusualDays,
    findings,
  };
}

