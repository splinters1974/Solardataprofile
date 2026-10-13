/**
 * Shared test helpers: a hand-built office whose right answers are known.
 */
import { addDays, dayOfWeek } from '../src/local/dates';
import { analyseSite, type SiteMetrics } from '../src/local/findings';
import { defaultSettings, type SiteSettings } from '../src/local/site';
import { makeCalendar } from '../src/local/calendar';
import { checkQuality } from '../src/local/dataQuality';
import { holidaysBetween } from '../src/local/holidays';
import type { Frame } from '../src/local/frame';

/** 2 kW base all the time; 10 kW 08:00-18:00 on working weekdays (closed on bank holidays). */
export function office(days = 364, start = '2024-01-01', weekendKw = 2): Frame {
  const dates = Array.from({ length: days }, (_, i) => addDays(start, i));
  const holidays = holidaysBetween(dates[0], dates[dates.length - 1]);
  const rows = dates.map((d) => Array.from({ length: 48 }, (_, s) => {
    const weekday = dayOfWeek(d) < 5 && !holidays.has(d);
    const kw = weekday && s >= 16 && s < 36 ? 10 : weekday ? 2 : weekendKw;
    return kw / 2; // kWh per half hour
  }));
  return { dates, rows };
}

const day = (open: number, close: number) => [{ open, close }];
export const settings = (patch: Partial<SiteSettings> = {}): SiteSettings => ({
  ...defaultSettings('Test'),
  calendar: { ...makeCalendar([day(16, 36), day(16, 36), day(16, 36), day(16, 36), day(16, 36), [], []]), confirmed: true },
  ...patch,
});

export function analyse(f: Frame, st: SiteSettings, rate = 25): SiteMetrics {
  const quality = checkQuality(f, { meterType: st.meterType, reviewedOk: st.review.reviewedOk });
  return analyseSite({ frame: f, settings: st, defaultRateP: rate, quality, carbon: null });
}

