/**
 * Can these readings be trusted? Checks a meter file for the faults that
 * quietly distort every other number: short or patchy coverage, missing
 * readings, zero days, dropouts, negative readings, stuck or copied
 * (estimated) data and spikes.
 *
 * Works on the analysis frame, so readings already excluded after review are
 * not counted again, and days marked "reviewed, genuine" are not flagged.
 * Each day-level check lists its dates, so they can be excluded or marked
 * as reviewed from the Data review tab. Thresholds are deliberately plain so
 * an engineer can argue with them.
 */
import { fmtDayMonYear } from './dates';
import {
  coverage, dayKwh, dayValid, FLAG, flagCounts, INTERVAL_HOURS, isValid, SLOTS, type Frame,
} from './frame';
import type { MeterType } from './site';

export type CheckStatus = 'ok' | 'warn' | 'fail';
export type Verdict = 'good' | 'check' | 'poor';

export interface QualityCheck {
  key: string;
  status: CheckStatus;
  title: string;
  detail: string;
  /** Days the check points at, for review. */
  dates?: string[];
}

export interface QualityReport {
  verdict: Verdict;
  checks: QualityCheck[];
  /** Days flagged by a check and not yet reviewed, with the reasons. Kept out of reference samples. */
  suspectDays: Map<string, string[]>;
}

export const VERDICT_TEXT: Record<Verdict, { label: string; summary: string }> = {
  good: { label: 'Good', summary: 'No problems found. The figures can be relied on.' },
  check: { label: 'Check', summary: 'Usable, but check the flagged items before relying on the figures.' },
  poor: { label: 'Poor', summary: 'Problems large enough to distort the figures. Fix, exclude or replace the data first.' },
};

export const listDates = (dates: string[], max = 5) =>
  dates.slice(0, max).map(fmtDayMonYear).join(', ') + (dates.length > max ? ` and ${dates.length - max} more` : '');

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))];
}

export function checkQuality(frame: Frame, opts: { meterType?: MeterType; reviewedOk?: string[] } = {}): QualityReport {
  const { dates, rows } = frame;
  const n = dates.length;
  const meterType = opts.meterType ?? 'import';
  const reviewed = new Set(opts.reviewedOk ?? []);
  const checks: QualityCheck[] = [];
  const suspect = new Map<string, string[]>();
  const mark = (d: string, why: string) => {
    if (reviewed.has(d)) return;
    const list = suspect.get(d) ?? [];
    list.push(why);
    suspect.set(d, list);
  };
  const cov = coverage(frame);
  const withData = dates.map((_, i) => dayValid(frame, i) > 0);
  const daily = rows.map((_, i) => dayKwh(frame, i));
  const typicalDay = percentile(daily.filter((_, i) => withData[i] && dayValid(frame, i) >= 43).sort((a, b) => a - b), 0.5);

  // 1. Coverage, in valid hours rather than rows.
  const vd = cov.validDays;
  const vdText = `${vd.toFixed(0)} days of valid readings`;
  if (vd < 180) {
    checks.push({ key: 'coverage', status: 'fail', title: `Only ${vdText}`,
      detail: 'Under six months. Annual figures are not shown by default, and seasonal effects cannot be judged. '
        + 'Ask for a full year before using costs.' });
  } else if (vd < 330) {
    checks.push({ key: 'coverage', status: 'warn', title: `${vdText}, short of a full year`,
      detail: 'Annual figures are indicative: scaled up on the assumption that the missing time looks like the time present.' });
  } else {
    checks.push({ key: 'coverage', status: 'ok', title: vdText, detail: 'Enough readings to cover a year.' });
  }

  // 2. Missing readings and days inside the period.
  const counts = flagCounts(frame);
  const missingReadings = (counts[FLAG.BLANK] ?? 0) + (counts[FLAG.TEXT] ?? 0);
  const suppressed = (counts[FLAG.DST_UNSAFE] ?? 0) + (counts[FLAG.DUPLICATE] ?? 0);
  const missingDays = cov.spanDays - n;
  const share = 1 - cov.share;
  if (missingDays > 0 || missingReadings > 0 || suppressed > 0) {
    const parts = [
      missingDays ? `${missingDays} day${missingDays > 1 ? 's' : ''} absent from the file` : '',
      missingReadings ? `${missingReadings} blank or unreadable half hour${missingReadings > 1 ? 's' : ''}` : '',
      suppressed ? `${suppressed} half hour${suppressed > 1 ? 's' : ''} held back (clock change or duplicate rows)` : '',
    ].filter(Boolean);
    checks.push({
      key: 'gaps', status: share > 0.1 ? 'fail' : 'warn',
      title: `${(share * 100).toFixed(1)}% of the period has no valid reading`,
      detail: `${parts.join('; ')}. Missing readings are left out, not counted as zero. Totals cover the valid `
        + 'readings only; annual figures, where shown, scale from valid hours.',
    });
  } else {
    checks.push({ key: 'gaps', status: 'ok', title: 'No missing readings', detail: 'Every half hour between the first and last date has a valid reading.' });
  }
  const excluded = counts[FLAG.EXCLUDED] ?? 0;
  if (excluded) {
    checks.push({
      key: 'excluded', status: 'ok',
      title: `${excluded} half hour${excluded > 1 ? 's' : ''} excluded after review`,
      detail: `${(excluded * INTERVAL_HOURS).toLocaleString('en-GB')} hours left out on the Data review tab, with reasons recorded there.`,
    });
  }

  // 3. Whole days of zero: meter off, comms lost, or blanks filled with 0 by the supplier.
  const zeroDays = dates.filter((d, i) => withData[i] && !reviewed.has(d)
    && daily[i] <= Math.max(0.001, typicalDay * 0.01) && dayValid(frame, i) >= SLOTS / 2);
  zeroDays.forEach((d) => mark(d, 'no consumption all day'));
  if (zeroDays.length) {
    checks.push({
      key: 'zero-days', status: zeroDays.length / n > 0.03 ? 'fail' : 'warn',
      title: `${zeroDays.length} day${zeroDays.length > 1 ? 's' : ''} with no consumption`,
      detail: `${listDates(zeroDays)}. A building almost never uses nothing all day, so these are usually `
        + 'missing data recorded as zero. If kept, they pull down base load, averages and totals. Exclude them, '
        + 'or mark them as genuine (for example a confirmed shutdown).',
      dates: zeroDays,
    });
  } else {
    checks.push({ key: 'zero-days', status: 'ok', title: 'No zero days', detail: 'Every day with readings shows some consumption.' });
  }

  // 4. Dropouts: runs of exact zero inside days that are otherwise normal.
  const zeroSet = new Set(zeroDays);
  const dropoutDays: string[] = [];
  rows.forEach((r, i) => {
    if (zeroSet.has(dates[i]) || reviewed.has(dates[i])) return;
    let run = 0;
    let hit = false;
    for (let s = 0; s < SLOTS; s++) {
      run = isValid(frame, i, s) && r[s] === 0 ? run + 1 : 0;
      if (run >= 4) hit = true; // two hours of exactly nothing
    }
    if (hit) dropoutDays.push(dates[i]);
  });
  dropoutDays.forEach((d) => mark(d, 'readings drop to zero for 2+ hours'));
  if (dropoutDays.length) {
    checks.push({
      key: 'dropouts', status: dropoutDays.length / n > 0.05 ? 'fail' : 'warn',
      title: `Readings drop to zero for 2+ hours on ${dropoutDays.length} day${dropoutDays.length > 1 ? 's' : ''}`,
      detail: `${listDates(dropoutDays)}. On a site with any base load this is usually lost data, not a real `
        + 'switch-off. If kept, it drags base load down.',
      dates: dropoutDays,
    });
  }

  // 5. Negative readings: depend on what the meter measures.
  let negatives = 0;
  const negDays: string[] = [];
  rows.forEach((r, i) => {
    let any = false;
    for (let s = 0; s < SLOTS; s++) if (isValid(frame, i, s) && r[s] < 0) { negatives++; any = true; }
    if (any) negDays.push(dates[i]);
  });
  if (negatives) {
    if (meterType === 'import') {
      negDays.forEach((d) => mark(d, 'negative readings'));
      checks.push({
        key: 'negative', status: 'fail', title: `${negatives} negative reading${negatives > 1 ? 's' : ''} on an import meter`,
        detail: 'An import meter cannot read below zero. This is usually export from on-site generation, a meter '
          + 'wired the wrong way round, or a sign error. If the meter is net or export, change the meter type in the site settings.',
        dates: negDays,
      });
    } else {
      checks.push({
        key: 'negative', status: 'ok', title: `${negatives} negative reading${negatives > 1 ? 's' : ''} (${meterType} meter)`,
        detail: meterType === 'net'
          ? 'Expected on a net meter: negative readings are export. Demand figures here are net of on-site generation.'
          : 'Export meter: readings are generation sent to the grid, not consumption.',
      });
    }
  }

  // 6. Stuck readings: the same non-zero value for six hours or more.
  const stuckDays: string[] = [];
  rows.forEach((r, i) => {
    if (reviewed.has(dates[i])) return;
    let run = 1;
    for (let s = 1; s < SLOTS; s++) {
      const same = isValid(frame, i, s) && isValid(frame, i, s - 1) && r[s] !== 0 && r[s] === r[s - 1];
      run = same ? run + 1 : 1;
      if (run >= 12) { stuckDays.push(dates[i]); break; }
    }
  });
  stuckDays.forEach((d) => mark(d, 'readings stuck at one value'));
  if (stuckDays.length) {
    checks.push({
      key: 'stuck', status: stuckDays.length / n > 0.1 ? 'fail' : 'warn',
      title: `Readings stuck at one value for 6+ hours on ${stuckDays.length} day${stuckDays.length > 1 ? 's' : ''}`,
      detail: `${listDates(stuckDays)}. Real demand varies from one half hour to the next. Long flat runs `
        + 'usually mean estimated or profiled data filled in by the supplier. (Mark as genuine if the meter '
        + 'only records whole kWh on a small site, where repeats are normal.)',
      dates: stuckDays,
    });
  }

  // 7. Copied days: a day identical to an earlier one is almost always estimated.
  const seen = new Map<string, string>();
  const copied: string[] = [];
  rows.forEach((r, i) => {
    if (zeroSet.has(dates[i]) || reviewed.has(dates[i]) || dayValid(frame, i) < SLOTS / 2) return;
    const key = r.map((v, s) => (isValid(frame, i, s) ? v.toFixed(4) : '-')).join(',');
    if (seen.has(key)) copied.push(dates[i]);
    else seen.set(key, dates[i]);
  });
  copied.forEach((d) => mark(d, 'identical to another day'));
  if (copied.length) {
    checks.push({
      key: 'copied', status: copied.length / n > 0.05 ? 'fail' : 'warn',
      title: `${copied.length} day${copied.length > 1 ? 's are' : ' is'} an exact copy of another day`,
      detail: `${listDates(copied)}. Identical half-hourly readings on two days do not happen with real `
        + 'metering. These are estimates and say little about how the site actually ran.',
      dates: copied,
    });
  }

  // 8. Spikes: far above anything else the meter records.
  const kw: number[] = [];
  rows.forEach((r, i) => { for (let s = 0; s < SLOTS; s++) if (isValid(frame, i, s)) kw.push(r[s] / INTERVAL_HOURS); });
  const p99 = percentile(kw.sort((a, b) => a - b), 0.995);
  const spikes: { date: string; kw: number }[] = [];
  if (p99 > 0) {
    rows.forEach((r, i) => {
      if (reviewed.has(dates[i])) return;
      for (let s = 0; s < SLOTS; s++) {
        if (!isValid(frame, i, s)) continue;
        const k = r[s] / INTERVAL_HOURS;
        if (k > p99 * 3 && k - p99 > 5) spikes.push({ date: dates[i], kw: k });
      }
    });
  }
  if (spikes.length) {
    const worst = spikes.reduce((a, b) => (b.kw > a.kw ? b : a));
    const spikeDays = [...new Set(spikes.map((s) => s.date))];
    spikeDays.forEach((d) => mark(d, 'reading far above normal peak'));
    checks.push({
      key: 'spikes', status: 'warn',
      title: `${spikes.length} reading${spikes.length > 1 ? 's' : ''} far above normal peak`,
      detail: `The highest is ${Math.round(worst.kw).toLocaleString('en-GB')} kW on ${fmtDayMonYear(worst.date)}, `
        + `against a normal peak around ${Math.round(p99).toLocaleString('en-GB')} kW. Could be real (plant start-up) `
        + 'or a meter error. It sets the peak demand figure, so check it before quoting peak or capacity.',
      dates: spikeDays,
    });
  }

  if (reviewed.size) {
    checks.push({
      key: 'reviewed', status: 'ok', title: `${reviewed.size} day${reviewed.size > 1 ? 's' : ''} reviewed as genuine`,
      detail: 'Flagged by a check, reviewed on the Data review tab and kept as real readings.',
    });
  }

  const verdict: Verdict = checks.some((c) => c.status === 'fail') ? 'poor'
    : checks.some((c) => c.status === 'warn') ? 'check' : 'good';
  const order: Record<CheckStatus, number> = { fail: 0, warn: 1, ok: 2 };
  checks.sort((a, b) => order[a.status] - order[b.status]);
  return { verdict, checks, suspectDays: suspect };
}
