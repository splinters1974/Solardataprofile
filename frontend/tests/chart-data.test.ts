import { test } from 'node:test';
import assert from 'node:assert/strict';
import { office, settings, analyse } from './helpers';
import { energySplit, dayProfiles, weeklyTotals } from '../src/local/chartData';
import { planDays } from '../src/local/calendar';

test('where the energy goes: the three parts add up, and the closed part is the closed-hours excess', () => {
  const f = office(364, '2024-01-01', 6); // weekend running at 6 kW
  const st = settings();
  const m = analyse(f, st);
  const plans = planDays(st.calendar, f.dates);
  const s = energySplit(f, plans, m.baseAll.kw);
  assert.ok(Math.abs(s.base + s.openAbove + s.closedAbove - m.observed.kwh) < 1e-6);
  assert.ok(Math.abs(s.closedAbove - m.excessAll!.observed.kwh) < 1e-6);
});

test('daily profiles skip missing readings and weekly totals cover every valid reading', () => {
  const f = office(14, '2024-01-01');
  f.rows[2][10] = Number.NaN;
  f.flags = f.rows.map(() => new Uint8Array(48));
  f.flags[2][10] = 1; // blank
  const plans = planDays(settings().calendar, f.dates);
  const p = dayProfiles(f, plans, 'all');
  assert.equal(p.days.find((d) => d.date === f.dates[2])!.kw[10], null);
  assert.equal(p.max[16], 10, '10 kW is the highest at 08:00');
  const w = weeklyTotals(f);
  assert.equal(w.length, 2);
  const valid = f.rows.flat().filter((v) => Number.isFinite(v)).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(w[0].kwh + w[1].kwh - valid) < 1e-9);
});
