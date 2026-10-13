/**
 * The one interval dataset every screen, report and export works from.
 *
 * A frame is a calendar of days, each with 48 half-hour readings in kWh.
 * Readings that cannot be used are kept in place but flagged, with the
 * reason, so nothing is silently counted as zero use: a blank cell, text in
 * a reading cell, a clock-change hour, a conflicting duplicate row or an
 * interval excluded after review. Genuine zero readings stay valid.
 *
 * Raw data is never edited. The analysis frame is derived from it with the
 * site's unit, duplicate choices and exclusions applied, so changing any of
 * those simply derives a new frame.
 */
import { addDays, dayNum } from './dates';

/** Length of one reading. kW = kWh / INTERVAL_HOURS. */
export const INTERVAL_HOURS = 0.5;
export const SLOTS = 48;

export const FLAG = {
  OK: 0,
  BLANK: 1,
  TEXT: 2,
  /** Spring clock change: this clock time did not happen. Not missing data. */
  DST_GAP: 3,
  /** Clock-change day whose layout could not be interpreted safely. */
  DST_UNSAFE: 4,
  /** Two rows for the same date with different readings. */
  DUPLICATE: 5,
  EXCLUDED: 6,
} as const;
export type FlagCode = typeof FLAG[keyof typeof FLAG];

export const FLAG_TEXT: Record<number, string> = {
  [FLAG.BLANK]: 'Blank in the file',
  [FLAG.TEXT]: 'Text instead of a number in the file',
  [FLAG.DST_GAP]: 'Clock change: this time did not exist',
  [FLAG.DST_UNSAFE]: 'Clock-change day could not be read safely',
  [FLAG.DUPLICATE]: 'Conflicting duplicate rows for this date',
  [FLAG.EXCLUDED]: 'Excluded after review',
};

export interface Frame {
  /** "YYYY-MM-DD", ascending, unique. Days absent from the file are absent here. */
  dates: string[];
  /** kWh per half hour. 0 where the reading is not valid; check the flag. */
  rows: number[][];
  /** Per day, a reason code per slot (0 = valid). Null or absent = all valid. */
  flags?: (Uint8Array | null)[];
  /** kWh in the repeated hour of an autumn clock-change day, kept out of the 48 slots. */
  dstExtraKwh?: number[];
}

export const kwOf = (kwh: number) => kwh / INTERVAL_HOURS;

export function flagAt(f: Frame, i: number, s: number): number {
  return f.flags?.[i]?.[s] ?? 0;
}

export function isValid(f: Frame, i: number, s: number): boolean {
  return !(f.flags?.[i]?.[s]);
}

/** Valid readings in one day. */
export function dayValid(f: Frame, i: number): number {
  const fl = f.flags?.[i];
  if (!fl) return SLOTS;
  let n = 0;
  for (let s = 0; s < SLOTS; s++) if (!fl[s]) n++;
  return n;
}

/** Slots that existed on this day (48 less any spring clock-change gap). */
export function dayExpected(f: Frame, i: number): number {
  const fl = f.flags?.[i];
  if (!fl) return SLOTS;
  let n = 0;
  for (let s = 0; s < SLOTS; s++) if (fl[s] !== FLAG.DST_GAP) n++;
  return n;
}

/** A day counts as complete for day-level comparisons at 90% of its readings. */
export const isCompleteDay = (f: Frame, i: number) => dayValid(f, i) >= 0.9 * dayExpected(f, i);

/** Sum of valid kWh in a day. */
export function dayKwh(f: Frame, i: number): number {
  const r = f.rows[i];
  const fl = f.flags?.[i];
  let t = 0;
  for (let s = 0; s < SLOTS; s++) if (!fl || !fl[s]) t += r[s];
  return t;
}

export interface Coverage {
  from: string;
  to: string;
  /** Calendar days from first to last date, inclusive. */
  spanDays: number;
  /** Days present in the file. */
  daysPresent: number;
  /** Days with at least 90% of their readings valid. */
  completeDays: number;
  validReadings: number;
  expectedReadings: number;
  validHours: number;
  /** Valid readings as a share of what the span should hold. */
  share: number;
  /** Valid hours expressed as days, for the annualisation thresholds. */
  validDays: number;
}

export function coverage(f: Frame): Coverage {
  const n = f.dates.length;
  if (!n) {
    return { from: '', to: '', spanDays: 0, daysPresent: 0, completeDays: 0, validReadings: 0,
      expectedReadings: 0, validHours: 0, share: 0, validDays: 0 };
  }
  let valid = 0;
  let expectedPresent = 0;
  let complete = 0;
  for (let i = 0; i < n; i++) {
    const v = dayValid(f, i);
    const e = dayExpected(f, i);
    valid += v;
    expectedPresent += e;
    if (v >= 0.9 * e) complete++;
  }
  const spanDays = dayNum(f.dates[n - 1]) - dayNum(f.dates[0]) + 1;
  // Missing days were expected to hold a full day of readings.
  const expected = expectedPresent + (spanDays - n) * SLOTS;
  return {
    from: f.dates[0],
    to: f.dates[n - 1],
    spanDays,
    daysPresent: n,
    completeDays: complete,
    validReadings: valid,
    expectedReadings: expected,
    validHours: valid * INTERVAL_HOURS,
    share: expected ? valid / expected : 0,
    validDays: (valid * INTERVAL_HOURS) / 24,
  };
}

/** Days inside a date range, keeping flags aligned. */
export function sliceFrame(f: Frame, from?: string, to?: string): Frame {
  if (!from && !to) return f;
  const idx: number[] = [];
  f.dates.forEach((d, i) => { if (!((from && d < from) || (to && d > to))) idx.push(i); });
  return pick(f, idx);
}

export function pick(f: Frame, idx: number[]): Frame {
  return {
    dates: idx.map((i) => f.dates[i]),
    rows: idx.map((i) => f.rows[i]),
    flags: f.flags ? idx.map((i) => f.flags![i] ?? null) : undefined,
    dstExtraKwh: f.dstExtraKwh ? idx.map((i) => f.dstExtraKwh![i] ?? 0) : undefined,
  };
}

/** Every calendar day from first to last, with the frame index or -1 for a missing day. */
export function calendarDays(f: Frame): { date: string; i: number }[] {
  if (!f.dates.length) return [];
  const out: { date: string; i: number }[] = [];
  let k = 0;
  for (let d = f.dates[0]; d <= f.dates[f.dates.length - 1]; d = addDays(d, 1)) {
    if (f.dates[k] === d) out.push({ date: d, i: k++ });
    else out.push({ date: d, i: -1 });
  }
  return out;
}

/** Set a flag on a slot, creating the day's flag array when needed. Valid slots only. */
export function setFlag(f: Frame, i: number, s: number, code: number, overwrite = false) {
  if (!f.flags) f.flags = f.dates.map(() => null);
  let fl = f.flags[i];
  if (!fl) { fl = new Uint8Array(SLOTS); f.flags[i] = fl; }
  if (overwrite || !fl[s]) fl[s] = code;
}

/** Count of flagged slots by reason code. */
export function flagCounts(f: Frame): Record<number, number> {
  const out: Record<number, number> = {};
  f.flags?.forEach((fl) => {
    if (!fl) return;
    for (let s = 0; s < SLOTS; s++) if (fl[s]) out[fl[s]] = (out[fl[s]] ?? 0) + 1;
  });
  return out;
}

// --- Review: exclusions, duplicate choices, clock-change overrides ---------------

export interface Exclusion {
  id: string;
  from: string;
  to: string;
  /** Half-hour window, start inclusive, end exclusive. Absent = whole days. Wraps midnight if start > end. */
  startSlot?: number;
  endSlot?: number;
  reason: string;
  /** Where the exclusion came from: added by hand, or from a data quality item. */
  source: 'manual' | 'quality';
}

export interface DataReview {
  exclusions: Exclusion[];
  /** Per conflicting date: which row to use, or leave it excluded (the default). */
  duplicates: Record<string, 'first' | 'second' | 'exclude'>;
  /** Clock-change days the engineer has checked and wants kept as read. */
  dstKeep: string[];
  /** Days flagged by the quality check that were reviewed and are genuine. */
  reviewedOk: string[];
}

export const emptyReview = (): DataReview => ({ exclusions: [], duplicates: {}, dstKeep: [], reviewedOk: [] });

export function inSlotWindow(s: number, start: number, end: number): boolean {
  if (start === end) return true;
  return start < end ? s >= start && s < end : s >= start || s < end;
}

/** Raw readings as read from the file, before unit conversion and review. */
export interface RawData {
  frame: Frame;
  /** Source unit of the readings. */
  unit: 'kWh' | 'kW';
  /** Second rows for dates that appeared twice with different readings. */
  conflicts: { date: string; second: number[] }[];
}

/**
 * The analysis frame: raw readings in kWh with the review applied. Raw data
 * is not changed. Unit may be overridden by the site settings.
 */
export function deriveFrame(raw: RawData, unit: 'kWh' | 'kW', review: DataReview): Frame {
  const src = raw.frame;
  const scale = unit === 'kW' ? INTERVAL_HOURS : 1;
  const out: Frame = {
    dates: src.dates,
    rows: src.rows.map((r) => (scale === 1 ? r : r.map((v) => v * scale))),
    flags: src.flags ? src.flags.map((fl) => (fl ? Uint8Array.from(fl) : null)) : undefined,
    dstExtraKwh: src.dstExtraKwh?.map((v) => v * scale),
  };
  const index = new Map(src.dates.map((d, i) => [d, i]));

  for (const c of raw.conflicts) {
    const i = index.get(c.date);
    if (i === undefined) continue;
    const choice = review.duplicates[c.date] ?? 'exclude';
    if (choice === 'exclude') continue;
    if (choice === 'second') out.rows[i] = c.second.map((v) => v * scale);
    const fl = out.flags?.[i];
    if (fl) for (let s = 0; s < SLOTS; s++) if (fl[s] === FLAG.DUPLICATE) fl[s] = 0;
  }

  for (const d of review.dstKeep) {
    const i = index.get(d);
    const fl = i === undefined ? null : out.flags?.[i];
    if (fl) for (let s = 0; s < SLOTS; s++) if (fl[s] === FLAG.DST_UNSAFE) fl[s] = 0;
  }

  for (const x of review.exclusions) {
    for (let i = 0; i < out.dates.length; i++) {
      const d = out.dates[i];
      if (d < x.from || d > x.to) continue;
      for (let s = 0; s < SLOTS; s++) {
        if (x.startSlot !== undefined && x.endSlot !== undefined && !inSlotWindow(s, x.startSlot, x.endSlot)) continue;
        if (flagAt(out, i, s)) continue; // already unusable for another reason
        setFlag(out, i, s, FLAG.EXCLUDED);
      }
    }
  }
  // Tidy: drop all-zero flag arrays so "no flags" stays cheap.
  if (out.flags) out.flags = out.flags.map((fl) => (fl && fl.some((v) => v) ? fl : null));
  return out;
}
