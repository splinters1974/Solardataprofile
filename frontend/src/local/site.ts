/**
 * Site settings: what the engineer tells the analyser about a meter and the
 * building behind it. Everything here is an input or an assumption, shown
 * alongside the results it drives.
 */
import {
  fromLegacy, PRESET_CALENDARS, slotTime, type Calendar, type LegacyHours,
} from './calendar';
import { emptyReview, type DataReview } from './frame';
import type { TestLoad } from './headroom';
import type { Tariff } from './tariff';

export type SiteType = 'office' | 'school' | 'health' | 'leisure' | 'retail' | 'industrial' | 'custom';

export const SITE_TYPES: Record<SiteType, { label: string; note: string }> = {
  office: { label: 'Office / commercial', note: 'Preset: open 07:00 to 19:00 weekdays, closed weekends and bank holidays.' },
  school: {
    label: 'School / education',
    note: 'Preset: open 07:00 to 17:30 weekdays. Term dates are not assumed: add school holidays as dated closures.',
  },
  health: {
    label: 'Hospital / 24-7 estate',
    note: 'Preset: open around the clock, so there are no closed hours. A low-activity window (01:00 to 05:00) stands in for them.',
  },
  leisure: { label: 'Leisure centre', note: 'Preset: open 06:00 to 22:30 weekdays, 07:00 to 20:00 weekends.' },
  retail: { label: 'Retail', note: 'Preset: open 07:30 to 20:30 Monday to Saturday, 09:30 to 16:30 Sunday.' },
  industrial: { label: 'Industrial (two shift)', note: 'Preset: running 06:00 to 22:00 weekdays.' },
  custom: { label: 'Custom hours', note: 'Set the hours to match the site.' },
};

export const presetCalendar = (t: SiteType): Calendar => PRESET_CALENDARS[t]();

export const DEFAULT_RATE_P = 25;
export const DEFAULT_POWER_FACTOR = 0.95;

/** Screening thresholds for unusual days and persistent changes. Not universal standards. */
export interface DetectionSettings {
  /** Comparable days in the matched baseline. */
  baselineDays: number;
  /** Fewest valid comparable days for the rule to apply. */
  minDays: number;
  /** A day is unusual when it is this far from the median... */
  pct: number;
  /** ...and this many scaled median absolute deviations away. */
  madMultiple: number;
  /** Persistent change: at least this far from the matched baseline... */
  persistPct: number;
  /** ...on this many days... */
  persistDays: number;
  /** ...out of this many consecutive eligible days. */
  persistWindow: number;
}

export const DEFAULT_DETECTION: DetectionSettings = {
  baselineDays: 8, minDays: 6, pct: 0.25, madMultiple: 4, persistPct: 0.15, persistDays: 5, persistWindow: 7,
};

export type MeterType = 'import' | 'export' | 'net';
export type MeterRole = 'main' | 'sub' | 'separate';

/**
 * Which part of the file the headline figures, findings and reports cover.
 * Files often hold two or three years; the default is the last 12 months, so
 * a site is judged on how it runs now. Trend features (base load by month and
 * year-on-year change, compare periods, before and after) still use the whole file.
 */
export interface AnalysisPeriod {
  mode: 'last12' | 'year' | 'all' | 'custom';
  /** For 'year': 0 = last 12 months, 1 = the 12 months before, and so on. */
  yearsBack?: number;
  from?: string;
  to?: string;
}

export interface SiteSettings {
  name: string;
  /** Part of the file analysed. Defaults to the last 12 months. */
  period: AnalysisPeriod;
  type: SiteType;
  calendar: Calendar;
  /** p/kWh fully delivered. Null means use the portfolio default. */
  rateP: number | null;
  /** Time-band rates. Null or flat mode means the flat rate above. */
  tariff: Tariff | null;
  /** Agreed supply capacity in kVA, if known. */
  capacityKva: number | null;
  powerFactor: number;
  /** Share of capacity held back as a safety margin in the headroom check. */
  headroomMarginPct: number;
  /** A proposed new load (heat pump, EV charging) to test against capacity. */
  testLoad: TestLoad | null;
  /** Unit of the readings in the file. kW readings are converted to kWh per half hour. */
  unit: 'kWh' | 'kW';
  /** Import meters cannot read negative; export and net meters can. */
  meterType: MeterType;
  meterId: string;
  /** For timestamped files: whether times mark the start or end of each half hour. Null = as detected. */
  convention: 'start' | 'end' | null;
  review: DataReview;
  /** auto: off under 180 valid days, indicative to 330, full above. */
  annualise: 'auto' | 'force' | 'off';
  /** Which reference closed-hours excess is measured against. */
  excessReference: 'all' | 'closed';
  /** Percentile used for both base load references. */
  basePercentile: number;
  detection: DetectionSettings;
  floorAreaM2: number | null;
  /** Physical site this meter belongs to. Empty = its own site. */
  group: string;
  role: MeterRole;
}

export function defaultSettings(name: string): SiteSettings {
  return {
    name,
    period: { mode: 'last12' },
    type: 'office',
    calendar: presetCalendar('office'),
    rateP: null,
    tariff: null,
    capacityKva: null,
    powerFactor: DEFAULT_POWER_FACTOR,
    headroomMarginPct: 10,
    testLoad: null,
    unit: 'kWh',
    meterType: 'import',
    meterId: '',
    convention: null,
    review: emptyReview(),
    annualise: 'auto',
    excessReference: 'all',
    basePercentile: 5,
    detection: { ...DEFAULT_DETECTION },
    floorAreaM2: null,
    group: '',
    role: 'main',
  };
}

/**
 * Bring settings saved by an earlier version (customer editions, project
 * files) up to date: weekday/Saturday/Sunday hours become a calendar, and
 * new fields take their defaults.
 */
export function normaliseSettings(s: Partial<SiteSettings> & { hours?: LegacyHours; name: string }): SiteSettings {
  const base = defaultSettings(s.name);
  const calendar = s.calendar ?? (s.hours ? fromLegacy(s.hours) : base.calendar);
  const out: SiteSettings = { ...base, ...s, calendar } as SiteSettings;
  out.review = { ...emptyReview(), ...(s.review ?? {}) };
  out.detection = { ...DEFAULT_DETECTION, ...(s.detection ?? {}) };
  out.period = s.period ?? { mode: 'last12' };
  delete (out as { hours?: unknown }).hours;
  return out;
}

export const slotLabel = slotTime;

/**
 * Published UK Government electricity factors (location-based, Scope 2,
 * generation only), offered as one-click suggestions, never applied by default.
 * 2026 set published by DESNZ on 11 June 2026; 2025 set June 2025.
 */
export const CARBON_PRESETS = [
  { year: '2026', kgPerKwh: 0.13096, source: 'UK Government GHG conversion factors 2026 (DESNZ), UK electricity, Scope 2', note: 'For reporting periods in 2026 onwards.' },
  { year: '2025', kgPerKwh: 0.177, source: 'UK Government GHG conversion factors 2025 (DESNZ), UK electricity, Scope 2', note: 'For reporting periods in 2025.' },
] as const;
