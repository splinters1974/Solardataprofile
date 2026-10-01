/**
 * Data quality and electrification headroom on hand-built sites.
 * Run with: npm run test:local
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays } from '../src/local/dates';
import { checkQuality } from '../src/local/dataQuality';
import { analyseHeadroom } from '../src/local/headroom';
import type { Frame } from '../src/local/parser';

/** A believable site: varied readings, 40 kW peak at 17:00 in winter, lower in summer. */
function site(days = 365, start = '2024-01-01'): Frame {
  const dates = Array.from({ length: days }, (_, i) => addDays(start, i));
  let seed = 1;
  const noise = () => { seed = (seed * 16807) % 2147483647; return (seed / 2147483647) * 0.2; };
  const rows = dates.map((d) => {
    const m = Number(d.slice(5, 7));
    const winter = m === 12 || m <= 2;
    return Array.from({ length: 48 }, (_, s) => {
      const kw = s === 34 ? (winter ? 40 : 30) : s >= 16 && s < 36 ? 20 : 5;
      return kw / 2 + noise();
    });
  });
  return { dates, rows };
}

const statuses = (f: Frame) => Object.fromEntries(checkQuality(f).checks.map((c) => [c.key, c.status]));

test('a clean year passes every check', () => {
  const q = checkQuality(site());
  assert.equal(q.verdict, 'good', JSON.stringify(q.checks.filter((c) => c.status !== 'ok')));
});

test('zero days, dropouts, negatives, stuck and copied data are each caught', () => {
  const f = site();
  f.rows[10] = new Array(48).fill(0);                              // whole day zero
  f.rows[20] = f.rows[20].map((v, s) => (s >= 2 && s < 8 ? 0 : v)); // 3-hour dropout
  f.rows[30][5] = -1;                                               // negative
  f.rows[40] = f.rows[40].map((v, s) => (s < 14 ? 2.5 : v));         // stuck 7 hours
  f.rows[50] = [...f.rows[49]];                                     // copied day
  const st = statuses(f);
  assert.equal(st['zero-days'], 'warn');
  assert.equal(st.dropouts, 'warn');
  assert.equal(st.negative, 'fail');
  assert.equal(st.stuck, 'warn');
  assert.equal(st.copied, 'warn');
  assert.equal(checkQuality(f).verdict, 'poor', 'a negative reading is a fail');
});

test('gaps and short periods are graded', () => {
  const f = site();
  const holed = { dates: f.dates.filter((_, i) => i < 100 || i >= 130), rows: f.rows.filter((_, i) => i < 100 || i >= 130) };
  assert.equal(statuses(holed).gaps, 'warn');
  assert.equal(statuses(site(120)).coverage, 'fail');
  assert.equal(statuses(site(300)).coverage, 'warn');
});

test('a spike far above the normal peak is flagged', () => {
  const f = site();
  f.rows[200][20] = 200; // 400 kW against a ~40 kW site
  assert.equal(statuses(f).spikes, 'warn');
});

test('headroom: peak, firm headroom and monthly pinch', () => {
  const f = site();
  // 50 kVA capacity, 10% margin, power factor 1: usable 45 kVA, winter peak ~40.2 kVA.
  const h = analyseHeadroom(f, { capacityKva: 50, powerFactor: 1, marginPct: 10 });
  assert.equal(h.usableKva, 45);
  assert.ok(Math.abs(h.peakKva - 40.4) < 0.5, `peak ${h.peakKva}`);
  assert.ok(Math.abs(h.firmHeadroomKw - (45 - h.peakKva)) < 0.11);
  const jan = h.monthly.find((m) => m.month === 'Jan 24')!;
  const jun = h.monthly.find((m) => m.month === 'Jun 24')!;
  assert.ok(jan.headroomKw < jun.headroomKw, 'winter is the pinch');
  assert.equal(h.worstWinterByTime[34].kva > h.worstWinterByTime[10].kva, true);
});

test('a heat pump that overlaps the winter peak does not fit; one that avoids it does', () => {
  const f = site();
  const base = { capacityKva: 50, powerFactor: 1, marginPct: 10 };
  // 10 kW all day in the heating season: 40 + 10 = 50 > 45 at 17:00 in winter.
  const clash = analyseHeadroom(f, { ...base, test: { kw: 10, start: 12, end: 44, months: 'heating' } }).test!;
  assert.equal(clash.fits, false);
  assert.ok(clash.daysOver >= 80 && clash.daysOver <= 92, `days over ${clash.daysOver}`);
  assert.match(clash.summary, /would take the site over/);
  // Same load held off between 16:00 and 19:00 (runs 19:00 to 16:00, wrapping midnight): fits.
  const shifted = analyseHeadroom(f, { ...base, test: { kw: 10, start: 38, end: 32, months: 'heating' } }).test!;
  assert.equal(shifted.fits, true, shifted.summary);
  // 6 kW all year, all day: 40.4 + 6 > 45 only if over; it is not.
  assert.equal(analyseHeadroom(f, { ...base, test: { kw: 4, start: 0, end: 0, months: 'all' } }).test!.fits, true);
});
