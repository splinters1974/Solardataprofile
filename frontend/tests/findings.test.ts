/**
 * Findings maths on hand-built sites where the right answer is known.
 * Run with: npm run test:local
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, dayOfWeek } from '../src/local/dates';
import { presetCalendar } from '../src/local/site';
import { parseHHFile } from '../src/local/parser';
import { holidaysBetween } from '../src/local/holidays';

import { analyse, office, settings } from './helpers';

test('cost, base load and closed-hours split add up', () => {
  const f = office();
  const m = analyse(f, settings());
  assert.equal(m.baseAll.kw, 2);
  // Open-hours load sits exactly on the hours, so nothing in closed hours is above base.
  assert.equal(Math.round(m.excess!.observed.cost), 0);
  const total = f.rows.flat().reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(m.observed.kwh - total) < 1e-6);
  assert.ok(Math.abs(m.observed.cost - total * 0.25) < 1e-6);
  // Annual: scaled by 8,766 / valid hours (364 x 24).
  assert.ok(Math.abs(m.annual!.kwh - total * (8766 / (364 * 24))) < 1e-6);
  assert.ok(m.findings.some((f) => f.key === 'base'));
});

test('load left on after hours is priced at the unit rate', () => {
  // Same office, but plant runs at 6 kW until 22:00: 4 kW above base for 4 hours a weekday.
  const f = office();
  const holidays = holidaysBetween(f.dates[0], f.dates[f.dates.length - 1]);
  const working = (d: string) => dayOfWeek(d) < 5 && !holidays.has(d);
  f.rows = f.rows.map((r, i) => r.map((v, s) => (working(f.dates[i]) && s >= 36 && s < 44 ? 3 : v)));
  const m = analyse(f, settings());
  const weekdays = f.dates.filter(working).length;
  const observed = 4 * 4 * weekdays;
  assert.ok(Math.abs(m.excess!.observed.kwh - observed) < 1e-6, `${m.excess!.observed.kwh} vs ${observed}`);
  assert.ok(Math.abs(m.excess!.observed.cost - observed * 0.25) < 1e-6);
  assert.equal(m.findings[0].key, 'ooh');
  // A site-specific rate overrides the portfolio default.
  const m30 = analyse(f, settings({ rateP: 30 }));
  assert.ok(Math.abs(m30.excess!.observed.cost - observed * 0.3) < 1e-6);
});

test('a 24-7 site has no closed hours and no weekend finding', () => {
  const m = analyse(office(364, '2024-01-01', 8), settings({ type: 'health', calendar: presetCalendar('health') }));
  assert.equal(m.hasClosed, false);
  assert.ok(!m.findings.some((f) => f.key === 'ooh' || f.key === 'weekend'));
  // The low-activity window stands in as a reference, labelled as such.
  assert.match(m.baseClosed!.label, /Low-activity/);
});

test('weekend running is flagged at a site closed at weekends', () => {
  const m = analyse(office(364, '2024-01-01', 8), settings());
  assert.ok(m.findings.some((f) => f.key === 'weekend'));
  assert.ok(!analyse(office(), settings()).findings.some((f) => f.key === 'weekend'));
});

test('base load change compares the same months a year apart, not the seasons', () => {
  const flat = analyse(office(364), settings());
  assert.ok(!flat.findings.some((f) => f.key === 'creep'), 'one year: nothing to compare');
  // Two years, with base load stepping from 2 kW to 3 kW in the second.
  const f = office(731, '2023-01-01');
  f.rows = f.rows.map((r, i) => (f.dates[i] >= '2024-01-01' ? r.map((v) => (v === 1 ? 1.5 : v)) : r));
  const m = analyse(f, settings());
  const creep = m.findings.find((x) => x.key === 'creep');
  assert.ok(creep, 'creep found');
  assert.match(creep!.title, /up 50%/);
});

test('supply capacity close to the limit is flagged', () => {
  const m = analyse(office(), settings({ capacityKva: 10.5, powerFactor: 1 }));
  assert.ok(m.findings.some((f) => f.key === 'capacity' && f.level === 'high'));
});

test('a file with two meters stacked is refused, not spliced', () => {
  const header = 'Date,' + Array.from({ length: 48 }, (_, i) => `HH${i + 1}`).join(',');
  const block = (v: string) => Array.from({ length: 60 }, (_, i) => {
    const d = addDays('2024-01-01', i);
    return `${d.slice(8)}/${d.slice(5, 7)}/${d.slice(0, 4)},` + Array(48).fill(v).join(',');
  });
  const csv = [header, ...block('1.0'), ...block('2.0')].join('\n');
  assert.throws(() => parseHHFile(new TextEncoder().encode(csv).buffer, 'two.csv'), /more than one meter/);
  // One repeated row with different readings: kept visible and held back until reviewed.
  const one = new TextEncoder().encode([header, ...block('1.0'), block('2.0')[5]].join('\n')).buffer;
  const parsed = parseHHFile(one, 'one.csv');
  assert.equal(parsed.frame.dates.length, 60);
  assert.equal(parsed.raw.conflicts.length, 1);
  assert.ok(parsed.warnings.some((w) => /appear twice/.test(w)));
  // The same file pasted twice is counted once, not doubled.
  const twice = parseHHFile(new TextEncoder().encode([header, ...block('1.0'), ...block('1.0')].join('\n')).buffer, 'twice.csv');
  assert.equal(twice.frame.dates.length, 60);
  assert.equal(twice.raw.conflicts.length, 0);
});

test('findings carry confidence, evidence, calculation and links', () => {
  const f = office(364, '2024-01-01', 8);
  const m = analyse(f, settings());
  for (const x of m.findings) {
    assert.ok(['high', 'medium', 'low'].includes(x.confidence));
    assert.ok(x.confidenceReasons.length);
    assert.ok(x.investigation.length);
    assert.ok(x.calc.length);
  }
  // Unconfirmed hours cap calendar-dependent findings at medium.
  const un = analyse(f, settings({ calendar: { ...settings().calendar, confirmed: false } }));
  const w = un.findings.find((x) => x.key === 'weekend')!;
  assert.notEqual(w.confidence, 'high');
  assert.ok(w.confidenceReasons.some((r) => /not confirmed/.test(r)));
});
