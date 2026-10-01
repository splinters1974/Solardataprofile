/**
 * The standalone app must give the same answers as the Python backend.
 *
 * parity/generate.py ran the backend over the files in parity/ and saved
 * its output to expected.json. This runs the browser engine over the same
 * files and compares. Numbers may differ in the last rounded digit (Python
 * rounds halves to even, JavaScript rounds them up); anything more is a bug.
 *
 * Run with: npm run test:local
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseHHFile } from '../src/local/parser';
import {
  availableWeeks, dayNightSplit, dayOfWeekProfile, fullYearScatter, heatmapMatrix,
  loadDurationCurve, monthlyTotals, summaryStats, weekProfile,
} from '../src/local/analytics';
import { holidaysForYear } from '../src/local/holidays';

const dir = join(import.meta.dirname, 'parity');
const expected = JSON.parse(readFileSync(join(dir, 'expected.json'), 'utf8'));

function load(name: string) {
  const buf = readFileSync(join(dir, name));
  return parseHHFile(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), name);
}

/** One unit in the last decimal place the expected value was rounded to. */
function lastDigit(v: number): number {
  const s = String(v);
  if (s.includes('e')) return Math.abs(v) * 1e-9;
  const dp = s.includes('.') ? s.split('.')[1].length : 0;
  return 10 ** -dp;
}

function close(actual: unknown, want: unknown, path = '$'): void {
  if (typeof want === 'number' && typeof actual === 'number') {
    const tol = Math.max(lastDigit(want) * 1.01, Math.abs(want) * 1e-9);
    assert.ok(Math.abs(actual - want) <= tol, `${path}: got ${actual}, want ${want}`);
    return;
  }
  if (Array.isArray(want)) {
    assert.ok(Array.isArray(actual), `${path}: not an array`);
    assert.equal((actual as unknown[]).length, want.length, `${path}: length`);
    want.forEach((w, i) => close((actual as unknown[])[i], w, `${path}[${i}]`));
    return;
  }
  if (want && typeof want === 'object') {
    for (const [k, w] of Object.entries(want)) {
      close((actual as Record<string, unknown>)?.[k], w, `${path}.${k}`);
    }
    return;
  }
  assert.equal(actual, want, path);
}

for (const name of ['workbook_a.xlsx', 'semicolon.csv']) {
  const want = expected[name];

  test(`${name}: parses to the same days and readings`, () => {
    const { frame, format, warnings } = load(name);
    assert.equal(format, want.format);
    assert.deepEqual(warnings, want.warnings);
    assert.deepEqual(frame.dates, want.dates);
    close(frame.rows.map((r) => Math.round(r.reduce((a, b) => a + b, 0) * 1e6) / 1e6), want.row_sums);
  });

  test(`${name}: overview and analyser charts match`, () => {
    const { frame } = load(name);
    const d = frame.dates;
    const mid = d[Math.floor(d.length / 3)];
    const late = d[Math.floor((2 * d.length) / 3)];
    close(monthlyTotals(frame), want.monthly_totals, 'monthly');
    close(heatmapMatrix(frame).matrix, want.heatmap, 'heatmap');
    close(summaryStats(frame), want.summary, 'summary');
    close(availableWeeks(frame), want.weeks, 'weeks');
    close(dayOfWeekProfile(frame, mid, late, true), want.profile, 'profile');
    close(dayOfWeekProfile(frame, undefined, undefined, false), want.profile_all_no_holidays, 'profile_all');
    close(loadDurationCurve(frame), want.ldc, 'ldc');
    close(loadDurationCurve(frame, mid, late), want.ldc_window, 'ldc_window');
    close(dayNightSplit(frame, undefined, undefined, 0, 14), want.day_night, 'day_night');
    close(dayNightSplit(frame, d[0], d[d.length - 1], 46, 13), want.day_night_wrap, 'day_night_wrap');
    close(weekProfile(frame, want.weeks[3].value), want.week, 'week');

    const sc = fullYearScatter(frame, true);
    assert.equal(sc.points.length, want.scatter.count);
    assert.equal(sc.sampled, want.scatter.sampled);
    assert.equal(sc.total_readings, want.scatter.total_readings);
    assert.equal(sc.points.filter((p) => p.type === 'Bank holiday').length, want.scatter.holidays);
    close(sc.points.slice(0, 5), want.scatter.first, 'scatter.first');
    assert.equal(fullYearScatter(frame, true, 2400).points.length, want.scatter_print);
  });
}

test('transposed file keeps its dates and every day', () => {
  // The Python parser trimmed this layout to 48 days on an assumed 1 January
  // start. The browser version turns it round first and keeps the calendar.
  const { frame, format, warnings } = load('transposed_b.xlsx');
  assert.equal(format, 'B');
  assert.equal(frame.dates.length, 365);
  assert.equal(frame.dates[0], '2024-04-01');
  assert.equal(frame.dates[364], '2025-03-31');
  assert.ok(frame.rows.every((r) => r.length === 48));
  assert.ok(!warnings.some((w) => w.includes('No usable date column')));
});

test('bank holidays include substitutes and one-offs', () => {
  const h2022 = holidaysForYear(2022);
  for (const d of ['2022-01-03', '2022-04-15', '2022-04-18', '2022-05-02', '2022-06-02',
    '2022-06-03', '2022-08-29', '2022-09-19', '2022-12-26', '2022-12-27']) {
    assert.ok(h2022.has(d), d);
  }
  assert.ok(holidaysForYear(2025).has('2025-04-18'));
});
