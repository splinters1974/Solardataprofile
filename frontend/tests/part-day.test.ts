/**
 * A part-recorded day keeps its readings, but its blank half hours must not
 * drag base load or the load duration curve to zero.
 * Run with: npm run test:local
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadDurationCurve, summaryStats } from '../src/local/analytics';
import { analyseSite, defaultSettings } from '../src/local/findings';
import { parseHHFile } from '../src/local/parser';

function csv(): Uint8Array {
  const lines = ['Date,' + Array.from({ length: 48 }, (_, i) => `HH${i + 1}`).join(',')];
  for (let d = 1; d <= 40; d++) {
    const day = new Date(Date.UTC(2025, 0, d));
    const dd = `${String(day.getUTCDate()).padStart(2, '0')}/${String(day.getUTCMonth() + 1).padStart(2, '0')}/2025`;
    lines.push(`${dd},${Array(48).fill('2.0').join(',')}`);
  }
  lines.push(`10/02/2025,${[...Array(20).fill('2.0'), ...Array(28).fill('')].join(',')}`);
  lines.push(`11/02/2025,${Array(48).fill('').join(',')}`);
  lines.push('');
  return new TextEncoder().encode(lines.join('\n'));
}

test('part-recorded last day is kept, blanks skipped for base and LDC', () => {
  const { frame, warnings } = parseHHFile(csv(), 'part.csv');
  assert.equal(frame.dates.length, 41, 'part day kept, empty day skipped');
  assert.equal(frame.rows[40].slice(0, 20).reduce((a, b) => a + b, 0), 40, 'readings kept');
  assert.equal(loadDurationCurve(frame).base_kw, 4);
  assert.equal(summaryStats(frame).base_kw, 4);
  assert.notEqual(summaryStats(frame).lowest_day, '10 Feb 2025');
  assert.equal(analyseSite(frame, defaultSettings('x'), 25).baseKw, 4);
  assert.ok(warnings.some((w) => w.includes('28 blank half-hour reading(s) across 1 day(s)')));
  assert.ok(warnings.some((w) => w.includes('Skipped 1 dated row(s) with no readings')));
});
