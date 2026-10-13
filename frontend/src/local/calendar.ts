/**
 * Operating calendars: when a site is open, half hour by half hour.
 *
 * Each day of the week has its own opening periods (several if needed). A
 * period whose close is at or before its open runs overnight into the next
 * morning. Bank holidays follow a chosen nation's dates, editable, and can
 * be closed, run Sunday hours or run normal hours. Dated closures (school
 * holidays, shutdowns) and dated exceptional periods override the week.
 *
 * Presets from a building type are a starting point only: a calendar stays
 * "unconfirmed" until someone ticks that the hours have been checked, and
 * findings that depend on it carry lower confidence until then. School term
 * dates are never inferred; they must be entered as closures.
 */
import { addDays, dayOfWeek, fmtDayMonYear } from './dates';
import { holidaysForNation, NATION_LABEL, type Nation } from './holidays';
import { SLOTS } from './frame';

/** Open from `open` to `close`, in half-hour slots (0 = 00:00, 48 = midnight). close <= open runs overnight. */
export interface Period { open: number; close: number }

export interface DatedRange { id: string; from: string; to: string; label: string }
export interface DatedHours extends DatedRange { periods: Period[] }

export type HolidayTreatment = 'closed' | 'sunday' | 'normal';

export interface Calendar {
  /** Monday to Sunday. */
  week: Period[][];
  nation: Nation;
  holidays: HolidayTreatment;
  holidaysAdded: string[];
  holidaysRemoved: string[];
  closures: DatedRange[];
  exceptions: DatedHours[];
  /**
   * A 24/7 site has no closed hours. This optional low-activity window stands
   * in for them when working out a closed-hours style reference.
   */
  lowActivity: Period | null;
  /** Hours have been checked with the site. Presets start unconfirmed. */
  confirmed: boolean;
}

export type DayClass = 'weekday' | 'saturday' | 'sunday' | 'holiday' | 'closure' | 'exception';

export const DAY_CLASS_LABEL: Record<DayClass, string> = {
  weekday: 'Weekdays', saturday: 'Saturdays', sunday: 'Sundays',
  holiday: 'Bank holidays', closure: 'Dated closures', exception: 'Exceptional periods',
};

export const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const day = (open: number, close: number): Period[] => [{ open, close }];
const weekOf = (weekday: Period[], saturday: Period[], sunday: Period[]): Period[][] =>
  [weekday, weekday, weekday, weekday, weekday, saturday, sunday].map((d) => d.map((p) => ({ ...p })));

export function makeCalendar(week: Period[][], extra: Partial<Calendar> = {}): Calendar {
  return {
    week, nation: 'ew', holidays: 'closed', holidaysAdded: [], holidaysRemoved: [],
    closures: [], exceptions: [], lowActivity: null, confirmed: false, ...extra,
  };
}

export const PRESET_CALENDARS = {
  office: () => makeCalendar(weekOf(day(14, 38), [], [])),
  school: () => makeCalendar(weekOf(day(14, 35), [], [])),
  health: () => makeCalendar(weekOf(day(0, 48), day(0, 48), day(0, 48)), { holidays: 'normal', lowActivity: { open: 2, close: 10 } }),
  leisure: () => makeCalendar(weekOf(day(12, 45), day(14, 40), day(14, 40)), { holidays: 'sunday' }),
  retail: () => makeCalendar(weekOf(day(15, 41), day(15, 41), day(19, 33)), { holidays: 'sunday' }),
  industrial: () => makeCalendar(weekOf(day(12, 44), [], [])),
  custom: () => makeCalendar(weekOf(day(16, 36), [], [])),
};

/** Old-style hours (weekday / Saturday / Sunday) from earlier versions. */
export interface LegacyHours {
  weekday: { open: number; close: number } | null;
  saturday: { open: number; close: number } | null;
  sunday: { open: number; close: number } | null;
  holidaysLikeSunday: boolean;
}

export function fromLegacy(h: LegacyHours): Calendar {
  const p = (x: LegacyHours['weekday']) => (x ? [{ open: x.open, close: x.close }] : []);
  return makeCalendar(weekOf(p(h.weekday), p(h.saturday), p(h.sunday)), {
    holidays: h.holidaysLikeSunday ? 'sunday' : 'normal',
    // Saved by hand in an earlier version, so treat as checked.
    confirmed: false,
  });
}

// --- Classification ---------------------------------------------------------------

const isAllDay = (p: Period) => p.open === 0 && p.close >= SLOTS;
const overnight = (p: Period) => !isAllDay(p) && p.close <= p.open;

const inRange = (d: string, r: DatedRange) => d >= r.from && d <= r.to;

export function isHoliday(cal: Calendar, date: string): boolean {
  if (cal.holidaysRemoved.includes(date)) return false;
  if (cal.holidaysAdded.includes(date)) return true;
  return holidaysForNation(Number(date.slice(0, 4)), cal.nation).has(date);
}

/** Which rule sets a date's hours, and the periods that start on it. */
export function dayRule(cal: Calendar, date: string): { cls: DayClass; periods: Period[]; label?: string } {
  const closure = cal.closures.find((r) => inRange(date, r));
  if (closure) return { cls: 'closure', periods: [], label: closure.label };
  const exception = cal.exceptions.find((r) => inRange(date, r));
  if (exception) return { cls: 'exception', periods: exception.periods, label: exception.label };
  const dow = dayOfWeek(date);
  if (isHoliday(cal, date)) {
    const periods = cal.holidays === 'closed' ? [] : cal.holidays === 'sunday' ? cal.week[6] : cal.week[dow];
    return { cls: 'holiday', periods };
  }
  return { cls: dow === 5 ? 'saturday' : dow === 6 ? 'sunday' : 'weekday', periods: cal.week[dow] };
}

export interface DayPlan {
  cls: DayClass;
  /** Monday = 0 ... Sunday = 6. */
  dow: number;
  open: boolean[];
  label?: string;
}

/** Open or closed for each half hour of a date, including shifts that started the night before. */
export function planDay(cal: Calendar, date: string): DayPlan {
  const rule = dayRule(cal, date);
  const open = new Array(SLOTS).fill(false);
  for (const p of rule.periods) {
    if (isAllDay(p)) { open.fill(true); continue; }
    if (overnight(p)) { for (let s = p.open; s < SLOTS; s++) open[s] = true; continue; }
    for (let s = p.open; s < Math.min(SLOTS, p.close); s++) open[s] = true;
  }
  // The tail of an overnight shift that began yesterday.
  for (const p of dayRule(cal, addDays(date, -1)).periods) {
    if (overnight(p)) for (let s = 0; s < p.close; s++) open[s] = true;
  }
  return { cls: rule.cls, dow: dayOfWeek(date), open, label: rule.label };
}

const planCache = new WeakMap<Calendar, Map<string, DayPlan>>();

/** Day plans for a list of dates, cached per calendar object. */
export function planDays(cal: Calendar, dates: string[]): DayPlan[] {
  let cache = planCache.get(cal);
  if (!cache) { cache = new Map(); planCache.set(cal, cache); }
  return dates.map((d) => {
    let p = cache!.get(d);
    if (!p) { p = planDay(cal, d); cache!.set(d, p); }
    return p;
  });
}

/** True when the week, holidays and closures leave no closed half hours at all. */
export function isAlwaysOpen(cal: Calendar): boolean {
  const weekOpen = cal.week.every((d) => d.some(isAllDay));
  return weekOpen && cal.holidays !== 'closed' && !cal.closures.length;
}

// --- Description ------------------------------------------------------------------

export const slotTime = (s: number) =>
  (s >= SLOTS ? '24:00' : `${String(Math.floor(s / 2)).padStart(2, '0')}:${s % 2 ? '30' : '00'}`);

export function describePeriods(ps: Period[]): string {
  if (!ps.length) return 'closed';
  return ps.map((p) => (isAllDay(p) ? 'all day'
    : `${slotTime(p.open)}-${slotTime(p.close)}${overnight(p) ? ' (overnight)' : ''}`)).join(', ');
}

/** "Mon-Fri 07:00-19:00; Sat closed; Sun closed" with identical neighbours grouped. */
export function describeWeek(cal: Calendar): string {
  const short = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const parts: string[] = [];
  let k = 0;
  while (k < 7) {
    const text = describePeriods(cal.week[k]);
    let j = k;
    while (j + 1 < 7 && describePeriods(cal.week[j + 1]) === text) j++;
    parts.push(`${j > k ? `${short[k]}-${short[j]}` : short[k]} ${text}`);
    k = j + 1;
  }
  return parts.join('; ');
}

export function describeCalendar(cal: Calendar): string {
  const hol = `${NATION_LABEL[cal.nation]} bank holidays ${cal.holidays === 'closed' ? 'closed'
    : cal.holidays === 'sunday' ? 'on Sunday hours' : 'on normal hours'}`;
  const edits = cal.holidaysAdded.length + cal.holidaysRemoved.length
    ? ` (${cal.holidaysAdded.length} added, ${cal.holidaysRemoved.length} removed)` : '';
  const closures = cal.closures.length ? `; ${cal.closures.length} dated closure${cal.closures.length > 1 ? 's' : ''}` : '';
  const exc = cal.exceptions.length ? `; ${cal.exceptions.length} exceptional period${cal.exceptions.length > 1 ? 's' : ''}` : '';
  return `${describeWeek(cal)}. ${hol}${edits}${closures}${exc}. ${cal.confirmed ? 'Hours confirmed.' : 'Hours not yet confirmed.'}`;
}

export const describeRange = (r: DatedRange) =>
  `${r.label || 'Unnamed'}: ${fmtDayMonYear(r.from)}${r.to !== r.from ? ` to ${fmtDayMonYear(r.to)}` : ''}`;

/** Merge a bulk calendar into a site's own: week and holiday rules replaced, dated items added. */
export function mergeCalendar(own: Calendar, bulk: Calendar): Calendar {
  const key = (r: { from: string; to: string }) => `${r.from}|${r.to}`;
  const closures = [...own.closures];
  for (const r of bulk.closures) if (!closures.some((x) => key(x) === key(r))) closures.push({ ...r });
  const exceptions = [...own.exceptions];
  for (const r of bulk.exceptions) if (!exceptions.some((x) => key(x) === key(r))) exceptions.push(structuredClone(r));
  return {
    ...structuredClone(bulk),
    closures,
    exceptions,
    holidaysAdded: [...new Set([...own.holidaysAdded, ...bulk.holidaysAdded])],
    holidaysRemoved: [...new Set([...own.holidaysRemoved, ...bulk.holidaysRemoved])],
  };
}
