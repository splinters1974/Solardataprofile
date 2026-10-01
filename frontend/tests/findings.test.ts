/**
 * Findings maths on hand-built sites where the right answer is known.
 * Run with: npm run test:local
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, dayOfWeek } from '../src/local/dates';
import { analyseSite, defaultSettings, SITE_TYPES, type SiteSettings } from '../src/local/findings';
import { parseHHFile } from '../src/local/parser';
import { holidaysBetween } from '../src/local/holidays';
import type { Frame } from '../src/local/parser';

/** 2 kW base all the time; 10 kW 08:00-18:00 on working weekdays (closed on bank holidays). */
function office(days = 364, start = '2024-01-01', weekendKw = 2): Frame {
  const dates = Array.from({ length: days }, (_, i) => addDays(start, i));
  const holidays = holidaysBetween(dates[0], dates[dates.length - 1]);
  const rows = dates.map((d) => Array.from({ length: 48 }, (_, s) => {
    const weekday = dayOfWeek(d) < 5 && !holidays.has(d);
    const kw = weekday && s >= 16 && s < 36 ? 10 : weekday ? 2 : weekendKw;
    return kw / 2; // kWh per half hour
  }));
  return { dates, rows };
}

const settings = (patch: Partial<SiteSettings> = {}): SiteSettings => ({
  ...defaultSettings('Test'),
  hours: { weekday: { open: 16, close: 36 }, saturday: null, sunday: null, holidaysLikeSunday: true },
  ...patch,
});

test('cost, base load and out-of-hours split add up', () => {
  const m = analyseSite(office(), settings(), 25);
  assert.equal(m.baseKw, 2);
  // Open-hours load sits exactly on the hours, so nothing out of hours is above base.
  assert.equal(m.oohExcessCost, 0);
  const total = office().rows.flat().reduce((a, b) => a + b, 0);
  assert.equal(m.annualKwh, Math.round(total * (365.25 / 364)));
  assert.equal(m.annualCost, Math.round(m.annualKwh * 0.25));
  assert.ok(m.findings.some((f) => f.key === 'base'));
});

test('load left on after hours is priced at the unit rate', () => {
  // Same office, but plant runs at 6 kW until 22:00: 4 kW above base for 4 hours a weekday.
  const f = office();
  const holidays = holidaysBetween(f.dates[0], f.dates[f.dates.length - 1]);
  const working = (d: string) => dayOfWeek(d) < 5 && !holidays.has(d);
  f.rows = f.rows.map((r, i) => r.map((v, s) => (working(f.dates[i]) && s >= 36 && s < 44 ? 3 : v)));
  const m = analyseSite(f, settings(), 25);
  const weekdays = f.dates.filter(working).length;
  const expectedKwh = 4 * 4 * weekdays * (365.25 / 364);
  assert.ok(Math.abs(m.oohExcessAnnualKwh - expectedKwh) <= 1, `${m.oohExcessAnnualKwh} vs ${expectedKwh}`);
  assert.equal(m.oohExcessCost, Math.round(expectedKwh * 0.25));
  assert.equal(m.findings[0].key, 'ooh');
  // A site-specific rate overrides the portfolio default.
  const m30 = analyseSite(f, settings({ rateP: 30 }), 25);
  assert.equal(m30.oohExcessCost, Math.round(expectedKwh * 0.3));
});

test('a 24-7 site has no out-of-hours finding', () => {
  const m = analyseSite(office(), settings({ type: 'health', hours: SITE_TYPES.health.hours }), 25);
  assert.equal(m.hasOutOfHours, false);
  assert.ok(!m.findings.some((f) => f.key === 'ooh'));
});

test('weekend running is flagged at a site closed at weekends', () => {
  const m = analyseSite(office(364, '2024-01-01', 8), settings(), 25);
  assert.ok(m.findings.some((f) => f.key === 'weekend'));
  assert.ok(!analyseSite(office(), settings(), 25).findings.some((f) => f.key === 'weekend'));
});

test('base load creep compares the same months a year apart, not the seasons', () => {
  const flat = analyseSite(office(364), settings(), 25);
  assert.ok(!flat.findings.some((f) => f.key === 'creep'), 'one year: nothing to compare');
  // Two years, with base load stepping from 2 kW to 3 kW in the second.
  const f = office(731, '2023-01-01');
  f.rows = f.rows.map((r, i) => (f.dates[i] >= '2024-01-01' ? r.map((v) => (v === 1 ? 1.5 : v)) : r));
  const m = analyseSite(f, settings(), 25);
  const creep = m.findings.find((x) => x.key === 'creep');
  assert.ok(creep, 'creep found');
  assert.match(creep!.title, /up 50%/);
});

test('supply capacity close to the limit is flagged', () => {
  const m = analyseSite(office(), settings({ capacityKva: 10.5, powerFactor: 1 }), 25);
  assert.ok(m.findings.some((f) => f.key === 'capacity' && f.level === 'high'));
});

test('a file with two meters stacked is refused, not spliced', () => {
  const header = 'Date,' + Array.from({ length: 48 }, (_, i) => `HH${i + 1}`).join(',');
  const block = Array.from({ length: 60 }, (_, i) => {
    const d = addDays('2024-01-01', i);
    return `${d.slice(8)}/${d.slice(5, 7)}/${d.slice(0, 4)},` + Array(48).fill('1.0').join(',');
  });
  const csv = [header, ...block, ...block].join('\n');
  const bytes = new TextEncoder().encode(csv).buffer;
  assert.throws(() => parseHHFile(bytes, 'two.csv'), /more than one meter/);
  // One repeated row is a paste slip: kept once, with a warning.
  const one = new TextEncoder().encode([header, ...block, block[5]].join('\n')).buffer;
  const parsed = parseHHFile(one, 'one.csv');
  assert.equal(parsed.frame.dates.length, 60);
  assert.ok(parsed.warnings.some((w) => /repeat a date/.test(w)));
});
