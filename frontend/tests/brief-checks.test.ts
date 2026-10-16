/**
 * The checks required by the October 2026 improvement brief, one test each.
 * Run with: npm run test:local
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays } from '../src/local/dates';
import { coverage, deriveFrame, emptyReview, FLAG, kwOf, type Frame } from '../src/local/frame';
import { parseHHFile, gridLong } from '../src/local/parser';
import { planDay, makeCalendar, type Calendar } from '../src/local/calendar';
import { priceGrid, type Tariff, ALL_DAYS, WEEKDAYS, WEEKENDS } from '../src/local/tariff';
import { runScenarios, newScenario, type Scenario } from '../src/local/scenarios';
import { annualisationFor, confidenceFor, detectAnomalies } from '../src/local/findings';
import { planDays } from '../src/local/calendar';
import { DEFAULT_DETECTION, defaultSettings, presetCalendar } from '../src/local/site';
import { checkQuality } from '../src/local/dataQuality';
import { encodeProject, decodeProject, rawFromSerial, serialiseFrame } from '../src/local/project';
import { analyse, office, settings } from './helpers';

const flat = (days: number, kwh: number, start = '2025-01-06'): Frame => ({
  dates: Array.from({ length: days }, (_, i) => addDays(start, i)),
  rows: Array.from({ length: days }, () => new Array(48).fill(kwh)),
});
const csvBytes = (lines: string[]) => new TextEncoder().encode(lines.join('\n')).buffer;
const header = 'Date,' + Array.from({ length: 48 }, (_, i) => `HH${i + 1}`).join(',');
const ukDate = (d: string) => `${d.slice(8)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

test('50 kWh over 30 minutes is 100 kW, and peak is the highest half-hour average', () => {
  assert.equal(kwOf(50), 100);
  const f = flat(30, 10);
  f.rows[3][20] = 50;
  const m = analyse(f, settings());
  assert.equal(m.peak.kw, 100);
});

test('a file already in kW is not doubled: it is converted to kWh first', () => {
  const lines = ['Site demand (kW)', header, ...Array.from({ length: 40 }, (_, i) => `${ukDate(addDays('2025-01-06', i))},${Array(48).fill('100').join(',')}`)];
  const p = parseHHFile(csvBytes(lines), 'kw.csv');
  assert.equal(p.info.unit, 'kW');
  const f = deriveFrame(p.raw, p.info.unit, emptyReview());
  assert.equal(f.rows[0][0], 50, '100 kW for half an hour is 50 kWh');
  const m = analyse(f, settings());
  assert.equal(m.peak.kw, 100);
});

test('a missing reading is missing, not zero', () => {
  const lines = [header, ...Array.from({ length: 40 }, (_, i) => {
    const vals = Array(48).fill('2');
    if (i === 5) vals[10] = '';
    if (i === 6) vals[11] = 'n/a';
    return `${ukDate(addDays('2025-01-06', i))},${vals.join(',')}`;
  })];
  const p = parseHHFile(csvBytes(lines), 'gap.csv');
  assert.equal(p.frame.flags?.[5]?.[10], FLAG.BLANK);
  assert.equal(p.frame.flags?.[6]?.[11], FLAG.TEXT);
  const m = analyse(p.frame, settings());
  assert.equal(m.lowestKw, 4, 'lowest is 4 kW, not 0');
  assert.equal(m.averageKw, 4, 'average divides by valid hours');
  assert.equal(m.coverage.validReadings, 40 * 48 - 2);
  // A genuine zero stays a valid reading.
  const z = flat(30, 2);
  z.rows[2][3] = 0;
  assert.equal(analyse(z, settings()).lowestKw, 0);
});

test('the same readings loaded twice are refused, so totals cannot double', async () => {
  const { uploadHHFile, clearAll, listSites } = await import('../src/local/localClient');
  clearAll();
  const lines = [header, ...Array.from({ length: 40 }, (_, i) => `${ukDate(addDays('2025-01-06', i))},${Array(48).fill('1').join(',')}`)];
  const file = new File([lines.join('\n')], 'a.csv', { type: 'text/csv' });
  await uploadHHFile(file);
  await assert.rejects(uploadHHFile(new File([lines.join('\n')], 'copy of a.csv')), /already loaded/);
  assert.equal(listSites().length, 1);
  clearAll();
});

test('overnight shifts and dated closures classify half hours correctly', () => {
  // Weekdays 22:00 to 06:00 (overnight), closed weekends, closed 2025-02-10 to 2025-02-14.
  const night = [{ open: 44, close: 12 }];
  const cal: Calendar = {
    ...makeCalendar([night, night, night, night, night, [], []]),
    closures: [{ id: 'c', from: '2025-02-10', to: '2025-02-14', label: 'Shutdown' }],
  };
  const tue = planDay(cal, '2025-01-07'); // Tuesday after a Monday shift
  assert.equal(tue.open[0], true, '00:00 Tuesday is the tail of Monday night');
  assert.equal(tue.open[11], true);
  assert.equal(tue.open[12], false, '06:00 closed');
  assert.equal(tue.open[44], true, '22:00 open');
  const sat = planDay(cal, '2025-01-11');
  assert.equal(sat.open[5], true, 'Friday night runs into Saturday morning');
  assert.equal(sat.open[44], false);
  const sun = planDay(cal, '2025-01-12');
  assert.equal(sun.open[5], false);
  const shut = planDay(cal, '2025-02-11');
  assert.equal(shut.cls, 'closure');
  assert.ok(shut.open.every((o) => !o));
  // Monday after a closure has no tail from Sunday.
  assert.equal(planDay(cal, '2025-02-17').open[2], false);
});

test('clock-change days: mapped where safe, held back where not', () => {
  // Spring 2025-03-30: settlement layout, 46 readings then blanks.
  const spring = Array.from({ length: 40 }, (_, i) => {
    const d = addDays('2025-03-10', i);
    const vals = Array(48).fill('1');
    if (d === '2025-03-30') { vals[46] = ''; vals[47] = ''; vals[2] = '5'; }
    return `${ukDate(d)},${vals.join(',')}`;
  });
  const p = parseHHFile(csvBytes([header, ...spring]), 'spring.csv');
  const i = p.frame.dates.indexOf('2025-03-30');
  assert.equal(p.frame.flags?.[i]?.[2], FLAG.DST_GAP);
  assert.equal(p.frame.flags?.[i]?.[3], FLAG.DST_GAP);
  assert.equal(p.frame.rows[i][4], 5, 'third period moves to 02:00');
  // Gap slots are not counted as missing data.
  assert.equal(coverage(p.frame).share, 1);
  // Autumn 2025-10-26 with only 48 readings: held back, with a note.
  const autumn = Array.from({ length: 40 }, (_, k) => `${ukDate(addDays('2025-10-10', k))},${Array(48).fill('1').join(',')}`);
  const q = parseHHFile(csvBytes([header, ...autumn]), 'autumn.csv');
  const j = q.frame.dates.indexOf('2025-10-26');
  assert.equal(q.frame.flags?.[j]?.[10], FLAG.DST_UNSAFE);
  assert.ok(q.warnings.some((w) => /repeated hour was dropped or merged/.test(w)));
  // Kept after review.
  const kept = deriveFrame(q.raw, 'kWh', { ...emptyReview(), dstKeep: ['2025-10-26'] });
  assert.ok(!kept.flags?.[j]);
  // Timestamped readings: the repeated autumn hour is counted, not added into a slot.
  const t: number[] = [];
  const v: number[] = [];
  const base = Date.UTC(2025, 9, 26) / 60000;
  for (let m = 0; m < 1440 + 60; m += 30) {
    // Local clock: 00:00..01:30, then 01:00..01:30 again, then 02:00 onwards.
    const local = m < 120 ? m : m < 180 ? m - 60 : m - 60;
    t.push(base + local);
    v.push(1);
  }
  const g = gridLong({ t, v, utc: false }, 'start');
  const day = g.rows.find((r) => r.date === '2025-10-26')!;
  assert.equal(day.extra, 2, 'two readings of the repeated hour held separately');
  assert.equal(day.values[2], 1, '01:00 slot holds one reading, not two');
});

test('a 24-7 site is not flagged as closed at weekends', () => {
  const m = analyse(office(364, '2024-01-01', 8), settings({ calendar: presetCalendar('health') }));
  assert.equal(m.hasClosed, false);
  assert.ok(!m.findings.some((f) => f.key === 'weekend' || f.key === 'ooh'));
});

test('100 kWh at 25p/kWh is £25', () => {
  const f = flat(1, 100 / 48);
  const g = priceGrid(f, null, 25, () => false);
  const cost = f.rows[0].reduce((a, v, s) => a + v * g.rows[0][s], 0);
  assert.ok(Math.abs(cost - 25) < 1e-9);
  assert.ok(Math.abs(analyse(f, settings({ annualise: 'off' })).observed.cost - 25) < 1e-9);
});

const ctx = (f: Frame, cal: Calendar, ref = 0) => ({
  frame: f, plans: planDays(cal, f.dates), prices: priceGrid(f, null, 25, () => false),
  refs: { all: ref, closed: null }, annualFactor: null, carbon: null,
});
const allClosed = makeCalendar([[], [], [], [], [], [], []]);

test('50% of 100 kWh eligible excess is 50 kWh, not 100', () => {
  // One closed day: 100 kWh above a zero reference.
  const f = flat(1, 100 / 48);
  const a: Scenario = { ...newScenario('closed-excess'), share: 0.5 } as Scenario;
  const run = runScenarios(ctx(f, allClosed), [a]);
  assert.ok(Math.abs(run.results[0].kwhRemoved - 50) < 1e-9);
  // New scenarios reduce nothing until a target is entered.
  assert.equal(runScenarios(ctx(f, allClosed), [newScenario('closed-excess')]).results[0].kwhRemoved, 0);
});

test('acceptance: 10 kW for 12 hours on 100 days is 12,000 kWh and £3,000 at 25p', () => {
  const f = flat(100, 50); // 100 kW reference load
  const b = { ...newScenario('base'), kw: 10, window: { start: 0, end: 24 }, floorKw: 0 } as Scenario;
  const run = runScenarios(ctx(f, allClosed, 100), [b]);
  assert.ok(Math.abs(run.results[0].kwhRemoved - 12000) < 1e-6);
  assert.ok(Math.abs(run.results[0].costReduction - 3000) < 1e-6);
  assert.equal(run.results[0].annualCost, null, 'annual projection only when the site is annualised');
});

test('overlapping scenarios cannot save more than the reducible energy, and never go negative', () => {
  const f = flat(10, 5); // 10 kW all day
  const many: Scenario[] = [
    { ...newScenario('closed-excess'), share: 1 } as Scenario,
    { ...newScenario('base'), kw: 50, window: { start: 0, end: 0 }, floorKw: 0 } as Scenario,
    { ...newScenario('shoulders'), share: 1, windows: [{ start: 0, end: 0 }], days: ALL_DAYS, floorKw: 0 } as Scenario,
  ];
  const run = runScenarios(ctx(f, allClosed), many);
  const total = f.rows.flat().reduce((a, b) => a + b, 0);
  assert.ok(run.total.kwh <= total + 1e-9);
  assert.ok(Math.abs(run.total.kwh - total) < 1e-6, 'first scenario took it all; the rest found nothing left');
  assert.equal(run.results[1].kwhRemoved, 0);
  assert.ok(run.profileAfter.every((v) => v >= 0));
  // With a retained floor, nothing goes below it.
  const floored = runScenarios(ctx(f, allClosed), [{ ...newScenario('base'), kw: 50, window: { start: 0, end: 0 }, floorKw: 4 } as Scenario]);
  assert.ok(floored.profileAfter.every((v) => v >= 4 - 1e-9));
});

test('peak shifting keeps the energy and moves it to the receiving hours', () => {
  const f = flat(1, 5);
  f.rows[0][34] = 20; // a 40 kW peak at 17:00
  const d = { ...newScenario('peaks'), kw: 10, select: 'top', count: 1, action: 'shift', receive: { start: 0, end: 12 } } as Scenario;
  const run = runScenarios(ctx(f, allClosed), [d]);
  assert.equal(run.results[0].kwhRemoved, 0);
  assert.equal(run.results[0].kwhShifted, 5);
  assert.equal(run.peakAfter, 30);
  const before = f.rows[0].reduce((a, b) => a + b, 0);
  const after = run.profileAfter.reduce((a, b) => a + b * 0.5, 0);
  assert.ok(Math.abs(before - after) < 1e-9, 'energy conserved');
});

test('holding demand at a cap trims every half hour above it, and an unset cap changes nothing', () => {
  const f = flat(2, 1); // 2 kW base, two days
  f.rows[0][34] = 20; // 40 kW
  f.rows[1][20] = 15; // 30 kW
  const capped = runScenarios(ctx(f, allClosed), [{ ...newScenario('peaks'), capKw: 25 } as Scenario]);
  assert.equal(capped.peakAfter, 25);
  assert.equal(capped.results[0].intervals, 2);
  assert.equal(capped.results[0].days, 2);
  assert.ok(Math.abs(capped.results[0].kwhRemoved - ((40 - 25) + (30 - 25)) * 0.5) < 1e-9);
  const unset = runScenarios(ctx(f, allClosed), [newScenario('peaks')]);
  assert.equal(unset.results[0].kwhRemoved, 0, 'no change until a target is entered');
});

test('flat and time-band costs reconcile with interval sums', () => {
  const f = flat(14, 1);
  const bands: Tariff = {
    mode: 'bands', holidaysAsSunday: false,
    bands: [
      { id: 'd', name: 'Weekday day', rateP: 30, days: WEEKDAYS, start: 14, end: 46 },
      { id: 'n', name: 'Weekday night', rateP: 15, days: WEEKDAYS, start: 46, end: 14 },
      { id: 'w', name: 'Weekend', rateP: 20, days: WEEKENDS, start: 0, end: 0 },
    ],
  };
  const g = priceGrid(f, bands, 25, () => false);
  assert.equal(g.banded, true);
  let expected = 0;
  f.dates.forEach((d, i) => {
    const dow = (new Date(d).getUTCDay() + 6) % 7;
    for (let s = 0; s < 48; s++) expected += dow >= 5 ? 0.2 : s >= 14 && s < 46 ? 0.3 : 0.15;
    void i;
  });
  const m = analyse(f, settings({ tariff: bands }));
  assert.ok(Math.abs(m.observed.cost - expected) < 1e-9);
  // A gap in the bands is reported and the flat rate is used instead.
  const broken: Tariff = { ...bands, bands: bands.bands.slice(0, 2) };
  const gb = priceGrid(f, broken, 25, () => false);
  assert.equal(gb.banded, false);
  assert.match(gb.problems[0], /no rate/);
});

test('short periods are not annualised by default; 180-329 days are indicative', () => {
  const short = coverage(flat(120, 1));
  assert.equal(annualisationFor(short, 'auto').mode, 'off');
  assert.equal(annualisationFor(short, 'auto').factor, null);
  const forced = annualisationFor(short, 'force');
  assert.ok(forced.factor && forced.warning);
  assert.equal(annualisationFor(coverage(flat(250, 1)), 'auto').mode, 'indicative');
  assert.equal(annualisationFor(coverage(flat(340, 1)), 'auto').mode, 'full');
  const m = analyse(flat(120, 1), settings());
  assert.equal(m.annual, null);
  assert.ok(m.findings.some((f) => f.key === 'coverage'));
});

test('poor-quality data lowers confidence and is kept out of reference samples', () => {
  assert.equal(confidenceFor({ verdict: 'poor', validDays: 365, calendarDependent: false, confirmed: true }).level, 'low');
  // A zero day under question is not used as a baseline day for its neighbours.
  const f = flat(70, 2);
  f.rows[14] = new Array(48).fill(0);
  const q = checkQuality(f);
  assert.ok(q.suspectDays.has(f.dates[14]));
  const cal = makeCalendar([[{ open: 16, close: 36 }], [{ open: 16, close: 36 }], [{ open: 16, close: 36 }], [{ open: 16, close: 36 }], [{ open: 16, close: 36 }], [], []]);
  const an = detectAnomalies(f, planDays(cal, f.dates), q.suspectDays, DEFAULT_DETECTION);
  assert.equal(an.events.filter((e) => e.date === f.dates[14]).length, 0, 'flat data: zero variation, so the rule does not apply');
  assert.ok(an.notApplicable > 0);
});

test('unusual days use the actual weekday and flag high and low', () => {
  const f = office(140, '2024-01-01');
  // Varied but steady days so the scaled MAD is not zero, and no flat runs for the stuck-data check.
  f.rows = f.rows.map((r, i) => r.map((v, s) => v * (1 + ((i * 7) % 5) / 100 + i / 5000) * (1 + (s % 3) / 50)));
  f.rows[100] = f.rows[100].map((v) => v * 2);
  f.rows[107] = f.rows[107].map((v) => v * 0.3);
  const m = analyse(f, settings());
  const dates = m.anomalies.events.map((e) => [e.date, e.direction]);
  assert.ok(dates.some(([d, dir]) => d === f.dates[100] && dir === 'high'));
  assert.ok(dates.some(([d, dir]) => d === f.dates[107] && dir === 'low'));
  const ev = m.anomalies.events.find((e) => e.date === f.dates[100])!;
  assert.match(ev.dayLabel, /day$/);
});

test('saved projects reload settings, scenarios and action statuses', () => {
  const f = flat(40, 1);
  const st = { ...defaultSettings('Depot'), rateP: 31, floorAreaM2: 1200 };
  const sc = { ...newScenario('base'), kw: 3 } as Scenario;
  const bytes = encodeProject({
    title: 'Estate', defaultRateP: 27, carbon: { kgPerKwh: 0.2, year: '2025', source: 'Test' }, customerLogo: null,
    sites: [{
      filename: 'depot.csv', warnings: [], format: 'A', settings: st, unit: 'kWh', ...serialiseFrame(f), conflicts: [],
      actions: { ooh: { status: 'visit', owner: 'Sam', targetDate: '2026-11-01', notes: 'Check BMS', updated: '2026-10-13' } },
      scenarios: [sc],
    }],
  });
  const p = decodeProject(bytes);
  assert.equal(p.defaultRateP, 27);
  assert.equal(p.sites[0].settings.rateP, 31);
  assert.equal(p.sites[0].actions!.ooh.status, 'visit');
  assert.equal((p.sites[0].scenarios![0] as { kw: number }).kw, 3);
  assert.deepEqual(rawFromSerial(p.sites[0]).frame.dates, f.dates);
  assert.throws(() => decodeProject(new Uint8Array([1, 2, 3])), /not a Data Analyser project/);
});

test('exclusions reviewed by hand drop readings and are counted', () => {
  const f = flat(30, 2);
  const raw = { frame: f, unit: 'kWh' as const, conflicts: [] };
  const ex = deriveFrame(raw, 'kWh', { ...emptyReview(), exclusions: [{ id: 'x', from: f.dates[3], to: f.dates[4], reason: 'Meter fault', source: 'manual' }] });
  assert.equal(coverage(ex).validReadings, 28 * 48);
  assert.equal(ex.flags?.[3]?.[0], FLAG.EXCLUDED);
  assert.equal(f.flags, undefined, 'raw data untouched');
});
