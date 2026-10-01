/**
 * Can these readings be trusted? Checks a meter file for the faults that
 * quietly distort every other number: missing days, zero days, dropouts,
 * negative readings, stuck or copied (estimated) data, and spikes.
 *
 * Thresholds are deliberately plain so an engineer can argue with them.
 */
import { dayNum, fmtDayMonYear } from './dates';
import { KW_PER_KWH_PER_HH } from './analytics';
import type { Frame } from './parser';

export type CheckStatus = 'ok' | 'warn' | 'fail';
export type Verdict = 'good' | 'check' | 'poor';

export interface QualityCheck {
  key: string;
  status: CheckStatus;
  title: string;
  detail: string;
}

export interface QualityReport {
  verdict: Verdict;
  checks: QualityCheck[];
}

export const VERDICT_TEXT: Record<Verdict, { label: string; summary: string }> = {
  good: { label: 'Good', summary: 'No problems found. The figures can be relied on.' },
  check: { label: 'Check', summary: 'Usable, but check the flagged items before relying on the figures.' },
  poor: { label: 'Poor', summary: 'Problems large enough to distort the figures. Fix or replace the data first.' },
};

const listDates = (dates: string[], max = 5) =>
  dates.slice(0, max).map(fmtDayMonYear).join(', ') + (dates.length > max ? ` and ${dates.length - max} more` : '');

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))];
}

export function checkQuality(frame: Frame): QualityReport {
  const { dates, rows } = frame;
  const n = dates.length;
  const checks: QualityCheck[] = [];
  const daily = rows.map((r) => r.reduce((a, b) => a + b, 0));
  const sortedDaily = [...daily].sort((a, b) => a - b);
  const typicalDay = percentile(sortedDaily, 0.5);

  // 1. Coverage: enough days to call it a year?
  if (n < 180) {
    checks.push({ key: 'coverage', status: 'fail', title: `Only ${n} days of data`,
      detail: 'Annual figures are scaled up from under six months, so seasonal effects are guessed. '
        + 'Ask for a full year before using the costs.' });
  } else if (n < 330) {
    checks.push({ key: 'coverage', status: 'warn', title: `${n} days of data, short of a full year`,
      detail: 'Annual figures are scaled up to 365 days. Missing months are assumed to look like the ones present.' });
  } else {
    checks.push({ key: 'coverage', status: 'ok', title: `${n} days of data`, detail: 'Enough to cover a full year.' });
  }

  // 2. Missing days inside the period.
  const span = n ? dayNum(dates[n - 1]) - dayNum(dates[0]) + 1 : 0;
  const missing = span - n;
  let longest = 0;
  let longestFrom = '';
  for (let i = 1; i < n; i++) {
    const gap = dayNum(dates[i]) - dayNum(dates[i - 1]) - 1;
    if (gap > longest) { longest = gap; longestFrom = dates[i - 1]; }
  }
  if (missing > 0) {
    checks.push({
      key: 'gaps', status: missing / span > 0.1 ? 'fail' : 'warn',
      title: `${missing} day${missing > 1 ? 's' : ''} missing from the period`,
      detail: `The longest gap is ${longest} day${longest > 1 ? 's' : ''} after ${fmtDayMonYear(longestFrom)}. `
        + 'Totals cover only the days present, then scale to a year.',
    });
  } else {
    checks.push({ key: 'gaps', status: 'ok', title: 'No missing days', detail: 'Every day between the first and last date is present.' });
  }

  // 3. Whole days of zero: meter off, comms lost, or blanks filled with 0.
  const zeroDays = dates.filter((_, i) => daily[i] <= Math.max(0.001, typicalDay * 0.01));
  if (zeroDays.length) {
    checks.push({
      key: 'zero-days', status: zeroDays.length / n > 0.03 ? 'fail' : 'warn',
      title: `${zeroDays.length} day${zeroDays.length > 1 ? 's' : ''} with no consumption`,
      detail: `${listDates(zeroDays)}. A building almost never uses nothing all day, so these are usually `
        + 'missing data recorded as zero. They pull down base load, averages and annual totals.',
    });
  } else {
    checks.push({ key: 'zero-days', status: 'ok', title: 'No zero days', detail: 'Every day shows some consumption.' });
  }

  // 4. Dropouts: runs of zero inside days that are otherwise normal.
  const zeroDaySet = new Set(zeroDays);
  const dropoutDays: string[] = [];
  rows.forEach((r, i) => {
    if (zeroDaySet.has(dates[i])) return;
    let run = 0;
    let hit = false;
    for (const v of r) {
      run = v === 0 ? run + 1 : 0;
      if (run >= 4) hit = true; // two hours of exactly nothing
    }
    if (hit) dropoutDays.push(dates[i]);
  });
  if (dropoutDays.length) {
    checks.push({
      key: 'dropouts', status: dropoutDays.length / n > 0.05 ? 'fail' : 'warn',
      title: `Readings drop to zero for 2+ hours on ${dropoutDays.length} day${dropoutDays.length > 1 ? 's' : ''}`,
      detail: `${listDates(dropoutDays)}. On a site with any base load this is usually lost data, not a real `
        + 'switch-off. It drags the base load figure down.',
    });
  }

  // 5. Negative readings: export, a reversed CT or a sign error.
  let negatives = 0;
  for (const r of rows) for (const v of r) if (v < 0) negatives++;
  if (negatives) {
    checks.push({
      key: 'negative', status: 'fail', title: `${negatives} negative reading${negatives > 1 ? 's' : ''}`,
      detail: 'Consumption cannot be negative. This is usually export from on-site generation, a meter wired '
        + 'the wrong way round, or a sign error in the export. Confirm what the meter measures.',
    });
  }

  // 6. Stuck readings: the same non-zero value for six hours or more.
  const stuckDays: string[] = [];
  rows.forEach((r, i) => {
    let run = 1;
    for (let s = 1; s < 48; s++) {
      run = r[s] !== 0 && r[s] === r[s - 1] ? run + 1 : 1;
      if (run >= 12) { stuckDays.push(dates[i]); break; }
    }
  });
  if (stuckDays.length) {
    checks.push({
      key: 'stuck', status: stuckDays.length / n > 0.1 ? 'fail' : 'warn',
      title: `Readings stuck at one value for 6+ hours on ${stuckDays.length} day${stuckDays.length > 1 ? 's' : ''}`,
      detail: `${listDates(stuckDays)}. Real demand varies from one half hour to the next. Long flat runs `
        + 'usually mean estimated or profiled data filled in by the supplier. (Ignore this if the meter '
        + 'only records whole kWh on a small site, where repeats are normal.)',
    });
  }

  // 7. Copied days: a day identical to an earlier one is almost always estimated.
  const seen = new Map<string, string>();
  const copied: string[] = [];
  rows.forEach((r, i) => {
    if (zeroDaySet.has(dates[i])) return;
    const key = r.map((v) => v.toFixed(4)).join(',');
    if (seen.has(key)) copied.push(dates[i]);
    else seen.set(key, dates[i]);
  });
  if (copied.length) {
    checks.push({
      key: 'copied', status: copied.length / n > 0.05 ? 'fail' : 'warn',
      title: `${copied.length} day${copied.length > 1 ? 's are' : ' is'} an exact copy of another day`,
      detail: `${listDates(copied)}. Identical half-hourly readings on two days do not happen with real `
        + 'metering. These are estimates and say little about how the site actually ran.',
    });
  }

  // 8. Spikes: far above anything else the meter records.
  const kw = rows.flat().map((v) => v * KW_PER_KWH_PER_HH);
  const p99 = percentile([...kw].sort((a, b) => a - b), 0.995);
  const spikes: { date: string; kw: number }[] = [];
  if (p99 > 0) {
    rows.forEach((r, i) => r.forEach((v) => {
      const k = v * KW_PER_KWH_PER_HH;
      if (k > p99 * 3 && k - p99 > 5) spikes.push({ date: dates[i], kw: k });
    }));
  }
  if (spikes.length) {
    const worst = spikes.reduce((a, b) => (b.kw > a.kw ? b : a));
    checks.push({
      key: 'spikes', status: 'warn',
      title: `${spikes.length} reading${spikes.length > 1 ? 's' : ''} far above normal peak`,
      detail: `The highest is ${Math.round(worst.kw).toLocaleString('en-GB')} kW on ${fmtDayMonYear(worst.date)}, `
        + `against a normal peak around ${Math.round(p99).toLocaleString('en-GB')} kW. Could be real (plant start-up) `
        + 'or a meter error. It sets the peak demand figure, so check it before quoting peak or capacity.',
    });
  }

  const verdict: Verdict = checks.some((c) => c.status === 'fail') ? 'poor'
    : checks.some((c) => c.status === 'warn') ? 'check' : 'good';
  const order: Record<CheckStatus, number> = { fail: 0, warn: 1, ok: 2 };
  checks.sort((a, b) => order[a.status] - order[b.status]);
  return { verdict, checks };
}
