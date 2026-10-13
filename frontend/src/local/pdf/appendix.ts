/**
 * The opportunities appendix: what sits behind the headline numbers, in a
 * form a client or colleague can check. Observed against annual figures and
 * coverage; the investigations with their confidence and evidence; savings
 * scenarios and their non-overlapping total; how the references were worked
 * out and what was excluded; the calendar and rates used; and the dates
 * that the evidence and comparisons rest on.
 */
import { fmtDayMonYear } from '../dates';
import { DAY_CLASS_LABEL, describeCalendar, describeRange, slotTime } from '../calendar';
import { describeTariff } from '../tariff';
import { NATION_LABEL } from '../holidays';
import { comparePeriods, gbp, kwFmt, kwhFmt, topInvestigations, type CarbonFactor, type Finding, type SiteMetrics } from '../findings';
import { describeScenario, type ScenarioRun } from '../scenarios';
import { STATUS_LABEL, newAction, type ActionStore } from '../actions';
import { VERDICT_TEXT } from '../dataQuality';
import { addDays } from '../dates';
import type { SiteSummary } from '../localClient';
import { fmt, hex, INK, LEVEL_STYLE, MUTED, type Report } from './common';

const IMPACT = { high: 'High', medium: 'Medium', low: 'Low', info: 'Note' } as const;
const CONF = { high: 'High', medium: 'Medium', low: 'Low' } as const;

const money = (v: number | null | undefined) => (v === null || v === undefined ? 'n/a' : gbp(v));
const kwh = (v: number | null | undefined) => (v === null || v === undefined ? 'n/a' : kwhFmt(v));
const tco2 = (v: number | null | undefined) => (v === null || v === undefined ? 'not entered' : `${fmt(v, 1)} t`);

/** Observed against annual estimate, with coverage and method. */
export function observedVsAnnual(r: Report, m: SiteMetrics) {
  const c = m.coverage;
  r.y = r.table(['', 'Observed period', 'Annual estimate'], [
    ['Period', `${fmtDayMonYear(c.from)} to ${fmtDayMonYear(c.to)} (${c.spanDays} days)`, m.annual ? `${m.annualisation.mode === 'full' ? 'Full year' : 'Indicative'}` : 'Not annualised'],
    ['Valid readings', `${c.validReadings.toLocaleString('en-GB')} of ${c.expectedReadings.toLocaleString('en-GB')} (${(c.share * 100).toFixed(1)}%), ${fmt(c.validDays, 0)} days`, ''],
    ['Electricity', kwh(m.observed.kwh), kwh(m.annual?.kwh)],
    ['Estimated energy cost', money(m.observed.cost), money(m.annual?.cost)],
    ['Carbon (entered factor)', tco2(m.observed.tco2e), tco2(m.annual?.tco2e)],
  ], { widths: [0.22, 0.42, 0.36], fontSize: 7.5, leftCols: [1, 2] }) + 2;
  r.small(`${m.annualisation.method}${m.annualisation.warning ? ` ${m.annualisation.warning}` : ''} Rates: ${m.rate.description}.`
    + `${m.rate.problems.length ? ` Time bands not used: ${m.rate.problems.join(' ')}` : ''} Costs exclude standing, capacity and other fixed charges.`);
}

function findingBlock(r: Report, f: Finding, status?: string) {
  const d = r.doc;
  const style = LEVEL_STYLE[f.level];
  const textW = r.width - 8;
  const lines = [
    ...(d.splitTextToSize(f.detail, textW) as string[]),
    ...(d.splitTextToSize(`Check: ${f.investigation}`, textW) as string[]),
    ...(d.splitTextToSize(`Evidence: ${f.evidence.join('; ')}`, textW) as string[]),
    ...(d.splitTextToSize(`Confidence ${CONF[f.confidence].toLowerCase()}: ${f.confidenceReasons.join('; ')}.`, textW) as string[]),
  ];
  const h = 7 + lines.length * 3.5 + 2;
  r.need(h);
  d.setFillColor(...style.color).rect(r.left, r.y, 1.2, h - 2, 'F');
  d.setFont('helvetica', 'bold').setFontSize(9).setTextColor(...INK);
  const head = `${f.title}`;
  d.text(d.splitTextToSize(head, r.width - 60)[0] as string, r.left + 4, r.y + 4);
  d.setFont('helvetica', 'normal').setFontSize(7).setTextColor(...style.color);
  d.text(`IMPACT ${IMPACT[f.level].toUpperCase()}  ·  CONFIDENCE ${CONF[f.confidence].toUpperCase()}${status ? `  ·  ${status.toUpperCase()}` : ''}`,
    r.left + r.width, r.y + 4, { align: 'right' });
  d.setFontSize(7.8).setTextColor(...MUTED);
  lines.forEach((line, i) => d.text(line, r.left + 4, r.y + 8.5 + i * 3.5));
  r.y += h;
}

/** The three most useful investigations, for the front of a site summary. */
export function topThree(r: Report, s: SiteSummary) {
  const top = topInvestigations(s.metrics);
  if (!top.length) {
    r.small('No investigations stand out: nothing above note level.');
    return;
  }
  for (const f of top) findingBlock(r, f, STATUS_LABEL[(s.actions[f.key] ?? newAction()).status]);
}

export interface AppendixInput {
  site: SiteSummary;
  scenarioRun: ScenarioRun | null;
  carbon: CarbonFactor | null;
  includeNotes?: boolean;
}

export function opportunitiesAppendix(r: Report, a: AppendixInput) {
  const { site: s, scenarioRun } = a;
  const m = s.metrics;
  r.h2(`Opportunities appendix: ${s.settings.name}`, 30);
  r.small('Measured values come from valid half-hourly readings. Annual figures are estimates. £ figures are energy cost at the '
    + 'rates entered associated with a pattern, not savings, and related findings overlap. Whole-site data cannot show which '
    + 'equipment is responsible; checks are suggestions.');

  r.h2('1. Observed and annual figures', 30);
  observedVsAnnual(r, m);

  r.h2('2. Investigations', 30);
  for (const f of m.findings) {
    const act = s.actions[f.key] ?? newAction();
    findingBlock(r, f, STATUS_LABEL[act.status]);
    if (a.includeNotes && (act.owner || act.notes || act.targetDate)) {
      r.small(`Owner: ${act.owner || '-'}; target: ${act.targetDate || '-'}; notes: ${act.notes || '-'}`);
    }
  }

  r.h2('3. Savings scenarios', 25);
  const active = s.scenarios.filter((x) => x.enabled);
  if (!active.length || !scenarioRun) {
    r.small('No savings scenarios entered for this site.');
  } else {
    r.y = r.table(['Scenario', 'Assumptions', 'kWh removed', 'Cost change', 'A year (projection)'],
      [
        ...scenarioRun.results.map((x) => [x.label, `${describeScenario(active.find((y) => y.id === x.id)!)}. ${x.assumptions.join(' ')}`,
          kwh(x.kwhRemoved) + (x.kwhShifted ? ` (+${kwh(x.kwhShifted)} shifted)` : ''), money(x.costReduction), money(x.annualCost)]),
        ['Total, active scenarios', 'Applied in order to one copy of the readings: no energy counted twice.', kwh(scenarioRun.total.kwh),
          money(scenarioRun.total.cost), money(scenarioRun.total.annualCost)],
      ], { widths: [0.2, 0.44, 0.12, 0.11, 0.13], fontSize: 7, leftCols: [1], boldLast: true }) + 2;
    r.small(`Observed period ${fmtDayMonYear(m.coverage.from)} to ${fmtDayMonYear(m.coverage.to)}. Highest half hour ${kwFmt(scenarioRun.peakBefore)} before, `
      + `${kwFmt(scenarioRun.peakAfter)} after. Scenarios are assumptions to test, not verified savings. Demand and capacity charges are not included.`);
  }

  r.h2('4. References, method and data review', 30);
  r.y = r.table(['Measure', 'Value', 'How it is worked out'], [
    [m.baseAll.label, kwFmt(m.baseAll.kw), m.baseAll.method],
    [m.baseClosed?.label ?? 'Closed-hours reference', m.baseClosed ? kwFmt(m.baseClosed.kw) : 'n/a', m.baseClosed?.method ?? m.baseClosedNote],
    ['Lowest recorded half hour', kwFmt(m.lowestKw), 'The single lowest valid half-hour average. Not used as base load.'],
    ['Highest recorded half hour', kwFmt(m.peak.kw), `Highest half-hour average demand (${m.peak.when}), not an instantaneous maximum.`],
    ['Excess reference used', m.excess ? kwFmt(m.excess.refKw) : 'n/a', m.excess ? `${m.excess.label}. ${m.excess.method}` : 'No closed hours.'],
  ], { widths: [0.22, 0.1, 0.68], fontSize: 7, leftCols: [2] }) + 2;
  if (m.byClass.length) {
    r.y = r.table(['Closed hours by day class', 'Closed kWh', 'Hours', 'Excess (all-period ref)', 'Excess (closed-hours ref)'],
      m.byClass.map((b) => [b.label, kwh(b.closedKwh), fmt(b.closedHours), kwh(b.excessAll), b.excessClosed === null ? 'n/a' : kwh(b.excessClosed)]),
      { widths: [0.28, 0.18, 0.12, 0.21, 0.21], fontSize: 7 }) + 2;
  }
  const rv = s.settings.review;
  const reviewLines = [
    `Data quality: ${VERDICT_TEXT[s.quality.verdict].label}. ${s.quality.checks.filter((c) => c.status !== 'ok').map((c) => c.title).join('; ') || 'No issues.'}`,
    ...rv.exclusions.map((x) => `Excluded ${fmtDayMonYear(x.from)}${x.to !== x.from ? ` to ${fmtDayMonYear(x.to)}` : ''}`
      + `${x.startSlot !== undefined && x.endSlot !== undefined ? ` ${slotTime(x.startSlot)}-${slotTime(x.endSlot)}` : ''}: ${x.reason}`),
    ...(rv.reviewedOk.length ? [`${rv.reviewedOk.length} flagged day(s) reviewed and kept as genuine.`] : []),
    ...(s.conflicts.length ? [`${s.conflicts.length} date(s) appeared twice with different readings: ${s.conflicts.map((c) => `${c.date} (${rv.duplicates[c.date] ?? 'excluded'})`).join(', ')}.`] : []),
    `Readings in ${s.settings.unit}${s.settings.unit === 'kW' ? ', converted to kWh per half hour (x 0.5)' : ''}; ${s.settings.meterType} meter.`,
  ];
  for (const line of reviewLines) r.small(line);

  r.h2('5. Calendar and rates', 20);
  const c = s.settings.calendar;
  r.small(`Calendar: ${describeCalendar(c)}`);
  if (c.closures.length) r.small(`Dated closures: ${c.closures.map(describeRange).join('; ')}.`);
  if (c.exceptions.length) r.small(`Exceptional periods: ${c.exceptions.map(describeRange).join('; ')}.`);
  r.small(`Bank holidays: ${NATION_LABEL[c.nation]}${c.holidaysAdded.length ? `, added ${c.holidaysAdded.join(', ')}` : ''}`
    + `${c.holidaysRemoved.length ? `, removed ${c.holidaysRemoved.join(', ')}` : ''}.`);
  r.small(`Rates: ${describeTariff(s.settings.tariff, m.rate.flatP)}${m.rate.problems.length ? ' (bands not applied, flat rate used)' : ''}.`
    + ` Carbon: ${a.carbon ? `${a.carbon.kgPerKwh} kgCO2e/kWh, ${a.carbon.year}, ${a.carbon.source}` : 'no factor entered'}.`);

  r.h2('6. Evidence dates and comparisons', 25);
  const ev: string[][] = [];
  for (const e of m.anomalies.events.slice(0, 6)) {
    ev.push([fmtDayMonYear(e.date), `Unusual ${e.direction} day (${e.dayLabel})`, `${kwh(e.actualKwh)} vs ${kwh(e.expectedKwh)} expected`,
      `Baseline ${fmtDayMonYear(e.baselineFrom)} to ${fmtDayMonYear(e.baselineTo)}, ${e.samples} days${e.quality ? `; data: ${e.quality}` : ''}`]);
  }
  for (const ch of m.anomalies.changes.slice(0, 4)) {
    ev.push([`${fmtDayMonYear(ch.from)} to ${fmtDayMonYear(ch.to)}`, `Sustained ${ch.direction === 'up' ? 'rise' : 'fall'}`,
      `${kwh(ch.actualKwh)} vs ${kwh(ch.expectedKwh)}`, `${ch.flaggedDays} of ${ch.eligibleDays} eligible days`]);
  }
  for (const p of m.peaks.slice(0, 5)) {
    ev.push([fmtDayMonYear(p.date), `Peak half hour ${slotTime(p.slot)} (${p.open ? 'open' : 'closed'})`, kwFmt(p.kw),
      p.utilisation === null ? 'no capacity entered' : `${Math.round(p.utilisation * 100)}% of capacity at PF ${s.settings.powerFactor}`]);
  }
  if (ev.length) r.y = r.table(['Date', 'What', 'Value', 'Basis'], ev, { widths: [0.2, 0.3, 0.2, 0.3], fontSize: 7, leftCols: [1, 2, 3] }) + 2;
  // The latest four weeks against the previous four and the same weeks a year earlier.
  const to = m.coverage.to;
  if (to) {
    const from = addDays(to, -27);
    const comps = comparePeriods(s.frame, from, to);
    r.y = r.table(['Latest 28 days compared with', 'Period', 'kWh (matched days)', 'Change', 'Note'],
      comps.map((x) => [x.label, `${fmtDayMonYear(x.other.from)} to ${fmtDayMonYear(x.other.to)}`,
        x.matchedDays ? `${kwh(x.matchedNowKwh)} vs ${kwh(x.matchedThenKwh)}` : '-', x.change === null ? 'n/a' : `${x.change >= 0 ? '+' : ''}${(x.change * 100).toFixed(1)}%`, x.note]),
      { widths: [0.24, 0.2, 0.2, 0.08, 0.28], fontSize: 7, leftCols: [1, 2, 4] }) + 2;
  }
  r.small(`Unusual-day rule: ${m.anomalies.checkedDays} days checked; not applicable on ${m.anomalies.notApplicable}. Screening thresholds, not standards.`);
  void DAY_CLASS_LABEL; void hex;
}

/** Estate-wide list of investigations, for the portfolio report. */
export function estateOpportunities(r: Report, rows: { siteName: string; finding: Finding; status: string }[]) {
  r.h2('Estate opportunities', 30);
  r.small('Every finding on every site, highest impact first. Associated costs are energy cost at the rates entered, not savings, '
    + 'and findings on the same site overlap: do not add them up.');
  const order = { high: 0, medium: 1, low: 2, info: 3 };
  const sorted = [...rows].filter((x) => x.finding.level !== 'info')
    .sort((a, b) => order[a.finding.level] - order[b.finding.level]
      || (b.finding.cost?.annual ?? b.finding.cost?.observed ?? 0) - (a.finding.cost?.annual ?? a.finding.cost?.observed ?? 0));
  r.y = r.table(['Site', 'Finding', 'Impact', 'Confidence', 'Associated cost', 'Status'],
    sorted.map((x) => [x.siteName, x.finding.title, IMPACT[x.finding.level], CONF[x.finding.confidence],
      x.finding.cost ? (x.finding.cost.annual !== null ? `${money(x.finding.cost.annual)}/yr` : `${money(x.finding.cost.observed)} (period)`) : '-',
      x.status]),
    { widths: [0.16, 0.46, 0.07, 0.09, 0.12, 0.1], fontSize: 7, leftCols: [1, 2, 3, 5] }) + 3;
}

export const activeStatus = (store: ActionStore, key: string) => STATUS_LABEL[(store[key] ?? newAction()).status];
