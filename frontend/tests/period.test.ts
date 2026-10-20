import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays } from '../src/local/dates';
import { isMultiYear, periodRange, yearBlocks } from '../src/local/period';
import { sliceFrame } from '../src/local/frame';
import { checkQuality } from '../src/local/dataQuality';
import { analyseSite } from '../src/local/findings';
import { office, settings } from './helpers';

import { yearStart } from '../src/local/period';
const days = (from: string, n: number) => Array.from({ length: n }, (_, i) => addDays(from, i));

test('a three-year file defaults to its last 12 months', () => {
  const d = days('2022-01-01', 1096); // to 2024-12-31
  const r = periodRange(d, { mode: 'last12' });
  assert.equal(r.to, '2024-12-31');
  assert.equal(r.from, '2024-01-01'); // 12 calendar months ending on the last date
  assert.ok(r.trimmed);
  assert.ok(isMultiYear(r.fileFrom, r.fileTo));
  assert.equal(yearBlocks(r.fileFrom, r.fileTo).length, 3);
  const prev = periodRange(d, { mode: 'year', yearsBack: 1 });
  assert.equal(prev.from, '2023-01-01');
  assert.equal(prev.to, '2023-12-31');
  assert.equal(periodRange(d, { mode: 'all' }).trimmed, false);
  const c = periodRange(d, { mode: 'custom', from: '2023-04-01', to: '2023-09-30' });
  assert.equal(c.from, '2023-04-01');
  assert.equal(c.to, '2023-09-30');
});

test('12 months means calendar months, leap years included', () => {
  assert.equal(yearStart('2025-09-30'), '2024-10-01');
  assert.equal(yearStart('2024-09-30'), '2023-10-01');
  assert.equal(yearStart('2024-02-29'), '2023-03-01');
});

test('a file of a year or less is analysed whole', () => {
  const r = periodRange(days('2024-01-01', 300), { mode: 'last12' });
  assert.equal(r.trimmed, false);
  assert.equal(isMultiYear(r.fileFrom, r.fileTo), false);
});

test('figures use the period; base load trend and year-on-year change use the whole file', () => {
  // Three years; base load steps from 2 kW to 3 kW in the final year.
  const f = office(1096, '2022-01-03');
  f.rows.forEach((r, i) => { if (f.dates[i] >= '2024-01-03') for (let s = 0; s < 48; s++) r[s] += 0.5; });
  const st = settings();
  const range = periodRange(f.dates, st.period);
  const pf = sliceFrame(f, range.from, range.to);
  const quality = checkQuality(pf, {});
  const m = analyseSite({ frame: pf, history: f, settings: st, defaultRateP: 25, quality, carbon: null });
  assert.ok(m.coverage.validDays <= 366, 'headline figures cover 12 months (366 days with a 29 February)');
  assert.equal(m.monthlyBase[0].key, '2022-01', 'monthly trend starts at the start of the file');
  const creep = m.findings.find((x) => x.key === 'creep');
  // 50% in a clean year; a little less here because the step falls inside the first month. Pairing 2022 with 2023
  // as well would halve it, so over 40% shows only the last year was compared with the one before.
  const up = Number(creep?.title.match(/up (\d+)%/)?.[1]);
  assert.ok(up > 40 && up <= 50, `the last year is compared with the year before: ${creep?.title}`);
});
