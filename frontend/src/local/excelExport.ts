/**
 * Every number behind the analysis, as a workbook engineers can carry on
 * with in their own models. Built from the same metrics as the screen.
 *
 * Sheets: Summary (observed and annual side by side, with coverage and
 * method), Opportunities, Scenarios, Scenario intervals, Data review,
 * Calendar and tariff, then one sheet per site. The customer version leaves
 * out every half-hourly table and internal owners and notes.
 */
import * as XLSX from 'xlsx';
import { dayNightSplit, dayOfWeekProfile, hhLabels, monthlyTotals, round } from './analytics';
import { SITE_TYPES } from './site';
import type { CarbonFactor } from './findings';
import { describeCalendar, describeRange, describePeriods, slotTime } from './calendar';
import { describeTariff } from './tariff';
import { VERDICT_TEXT } from './dataQuality';
import { FLAG_TEXT, flagAt, isValid, SLOTS } from './frame';
import { NATION_LABEL } from './holidays';
import { STATUS_LABEL, newAction } from './actions';
import { describeScenario, type ScenarioRun } from './scenarios';
import { SITE_COLUMNS, type TableSite } from './siteTable';
import type { SiteSummary } from './localClient';

export interface ExportSite {
  site: SiteSummary;
  scenarioRun: ScenarioRun | null;
}

export interface WorkbookOptions {
  /** Include half-hourly readings and interval calculations (internal only). */
  halfHourly: boolean;
  includeNotes: boolean;
  carbon: CarbonFactor | null;
  defaultRateP: number;
  title: string;
}

/** Excel caps sheet names at 31 characters and bans a few symbols. */
function sheetName(base: string, used: Set<string>): string {
  const clean = base.replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 28) || 'Site';
  let name = clean;
  for (let i = 2; used.has(name.toLowerCase()); i++) name = `${clean.slice(0, 26)} ${i}`;
  used.add(name.toLowerCase());
  return name;
}

const r0 = (v: number | null | undefined) => (v === null || v === undefined ? '' : Math.round(v));
const r1 = (v: number | null | undefined) => (v === null || v === undefined ? '' : round(v, 1));
const r2 = (v: number | null | undefined) => (v === null || v === undefined ? '' : round(v, 2));

function addSheet(wb: XLSX.WorkBook, used: Set<string>, name: string, rows: (string | number)[][], widths?: number[]) {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  if (widths) ws['!cols'] = widths.map((wch) => ({ wch }));
  XLSX.utils.book_append_sheet(wb, ws, sheetName(name, used));
}

export function buildWorkbook(sites: ExportSite[], opts: WorkbookOptions): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  const used = new Set<string>();
  const carbonNote = opts.carbon
    ? `Carbon: ${opts.carbon.kgPerKwh} kgCO2e/kWh (${opts.carbon.year}, ${opts.carbon.source}). An entered-factor estimate, not time-resolved grid carbon.`
    : 'Carbon: no emissions factor entered, so carbon is not shown.';

  // --- Summary ----------------------------------------------------------------
  const summary: (string | number)[][] = [
    [opts.title ? `${opts.title}: summary` : 'Summary'],
    ['Observed figures cover each file\'s own period. Annual figures are estimates scaled from valid hours, shown only with enough data. '
      + '£ figures are estimated energy cost at the rates entered, excluding fixed charges; associated costs are not savings and can overlap.'],
    [carbonNote],
    [],
    [
      'Site', 'Meter ID', 'File', 'Role', 'Physical site', 'Building type', 'Hours confirmed', 'From', 'To', 'Span (days)',
      'Valid days', 'Coverage', 'Annualisation', 'Annualisation method', 'Rates', 'Observed kWh', 'Observed cost (£)',
      'Annual kWh (estimate)', 'Annual cost (£, estimate)', 'Observed tCO2e', 'Annual tCO2e (estimate)',
      'Highest half-hour average (kW)', 'When', 'Lowest half hour (kW)', 'Average kW', 'Load factor',
      'All-period reference (kW)', 'Closed-hours reference (kW)', 'Closed-hours share', 'Closed-hours kWh',
      'Excess vs all-period ref (kWh, observed)', 'Excess vs all-period ref (£, observed)', 'Excess vs all-period ref (£/yr, estimate)',
      'Excess vs closed-hours ref (kWh, observed)', 'Excess vs closed-hours ref (£, observed)', 'Excess vs closed-hours ref (£/yr, estimate)',
      'Floor area (m2)', 'kWh/m2 a year (estimate)', 'kWh per open hour', 'Data quality', 'Findings',
      'Capacity (kVA)', 'Highest kVA (assumed PF)', 'Power factor', 'Firm headroom (kW)', 'Test load result',
    ],
  ];
  for (const { site: s } of sites) {
    const m = s.metrics;
    const h = s.headroom;
    summary.push([
      s.settings.name, s.settings.meterId, s.filename, s.settings.role, s.settings.group, SITE_TYPES[s.settings.type].label,
      s.settings.calendar.confirmed ? 'Yes' : 'No', m.coverage.from, m.coverage.to, m.coverage.spanDays,
      r1(m.coverage.validDays), `${(m.coverage.share * 100).toFixed(1)}%`, m.annualisation.mode, m.annualisation.method,
      m.rate.description + (m.rate.problems.length ? ` (bands not applied: ${m.rate.problems.join(' ')})` : ''),
      r0(m.observed.kwh), r0(m.observed.cost), r0(m.annual?.kwh), r0(m.annual?.cost), r2(m.observed.tco2e), r2(m.annual?.tco2e),
      r1(m.peak.kw), m.peak.when, r2(m.lowestKw), r2(m.averageKw), r2(m.loadFactor),
      r2(m.baseAll.kw), r2(m.baseClosed?.kw), m.hasClosed ? `${(m.closed.share * 100).toFixed(1)}%` : '24-7', r0(m.closed.kwh),
      r0(m.excessAll?.observed.kwh), r0(m.excessAll?.observed.cost), r0(m.excessAll?.annual?.cost),
      r0(m.excessClosed?.observed.kwh), r0(m.excessClosed?.observed.cost), r0(m.excessClosed?.annual?.cost),
      r0(m.intensity?.floorAreaM2), r1(m.intensity?.kwhPerM2Annual), r1(m.intensity?.kwhPerOpenHour),
      VERDICT_TEXT[s.quality.verdict].label, m.findings.filter((f) => f.level !== 'info').length,
      h?.capacityKva ?? '', h?.peakKva ?? '', s.settings.powerFactor, h?.firmHeadroomKw ?? '',
      h?.test ? (h.test.fits ? 'No exceedance in analysed data' : 'Exceeds in analysed data') : '',
    ]);
  }
  addSheet(wb, used, 'Summary', summary);

  // --- Opportunities -------------------------------------------------------------
  const opps: (string | number)[][] = [
    ['Opportunities: findings as investigation records. Impact and confidence are separate. Costs are associated costs at the rates entered, not savings; related findings overlap.'],
    [],
    ['Site', 'Meter ID', 'Finding', 'Impact', 'Confidence', 'Why this confidence', 'From', 'To',
      'Observed kWh', 'Observed cost (£)', 'Annual kWh (estimate)', 'Annual cost (£, estimate)',
      'What the data shows', 'Suggested investigation', 'Evidence', 'Calculation', 'Overlaps with', 'Status',
      ...(opts.includeNotes ? ['Owner', 'Target date', 'Notes'] : []), 'Last updated'],
  ];
  for (const { site: s } of sites) {
    for (const f of s.metrics.findings) {
      const a = s.actions[f.key] ?? newAction();
      opps.push([
        s.settings.name, s.settings.meterId, f.title, f.level, f.confidence, f.confidenceReasons.join('; '),
        f.period.from, f.period.to, r0(f.kwh?.observed), r0(f.cost?.observed), r0(f.kwh?.annual), r0(f.cost?.annual),
        f.detail, f.investigation, f.evidence.join(' | '), f.calc.join(' | '), f.related.join(', '),
        STATUS_LABEL[a.status], ...(opts.includeNotes ? [a.owner, a.targetDate, a.notes] : []), a.updated,
      ]);
    }
  }
  addSheet(wb, used, 'Opportunities', opps);

  // --- Scenarios ----------------------------------------------------------------
  const scen: (string | number)[][] = [
    ['Savings scenarios: applied in order to one copy of each site\'s readings, so overlapping scenarios never remove the same energy twice. '
      + 'Observed-period results at the rates entered; annual projections use the site\'s annualisation and are shown separately. Not verified savings.'],
    [],
    ['Site', 'Scenario', 'Enabled', 'Settings', 'Assumptions', 'kWh removed (observed)', 'kWh shifted (observed)',
      'Cost reduction (£, observed)', 'Intervals changed', 'kWh a year (projection)', '£ a year (projection)', 'tCO2e (observed)'],
  ];
  for (const { site: s, scenarioRun } of sites) {
    if (!s.scenarios.length) continue;
    for (const sc of s.scenarios) {
      const r = scenarioRun?.results.find((x) => x.id === sc.id);
      scen.push([s.settings.name, sc.label, sc.enabled ? 'Yes' : 'No', describeScenario(sc), r?.assumptions.join(' ') ?? '',
        r0(r?.kwhRemoved), r0(r?.kwhShifted), r0(r?.costReduction), r?.intervals ?? '', r0(r?.annualKwh), r0(r?.annualCost), r2(r?.tco2e)]);
    }
    if (scenarioRun) {
      scen.push([s.settings.name, 'Total, active scenarios (no double counting)', '', '', '',
        r0(scenarioRun.total.kwh), '', r0(scenarioRun.total.cost), '', r0(scenarioRun.total.annualKwh), r0(scenarioRun.total.annualCost), r2(scenarioRun.total.tco2e)]);
    }
  }
  addSheet(wb, used, 'Scenarios', scen);

  if (opts.halfHourly) {
    const rows: (string | number)[][] = [['Scenario interval calculations: every half hour changed by an active scenario. kWh; positive change = removed, negative = shifted in.'], []];
    for (const { site: s, scenarioRun } of sites) {
      if (!scenarioRun || !scenarioRun.intervals.length) continue;
      const active = s.scenarios.filter((x) => x.enabled);
      rows.push(['Site', 'Date', 'Time', 'Before (kWh)', 'After (kWh)', 'Rate (£/kWh)', ...active.map((x) => `${x.label} (kWh)`)]);
      for (const iv of scenarioRun.intervals) {
        rows.push([s.settings.name, iv.date, slotTime(iv.slot), round(iv.before, 4), round(iv.after, 4), round(iv.price, 4),
          ...iv.changes.map((c) => round(c, 4))]);
      }
      rows.push([]);
    }
    addSheet(wb, used, 'Scenario intervals', rows);
  }

  // --- Data review ------------------------------------------------------------------
  const review: (string | number)[][] = [
    ['Data review: what was excluded, kept or chosen, with reasons. Raw readings are never changed.'], [],
    ['Site', 'Item', 'From', 'To', 'Window', 'Reason or choice', 'Source'],
  ];
  for (const { site: s } of sites) {
    const r = s.settings.review;
    for (const x of r.exclusions) {
      review.push([s.settings.name, 'Excluded', x.from, x.to,
        x.startSlot !== undefined && x.endSlot !== undefined ? `${slotTime(x.startSlot)}-${slotTime(x.endSlot)}` : 'whole days', x.reason, x.source]);
    }
    for (const c of s.conflicts) review.push([s.settings.name, 'Duplicate date', c.date, c.date, '', r.duplicates[c.date] ?? 'exclude (default)', 'file']);
    for (const d of r.dstKeep) review.push([s.settings.name, 'Clock-change day kept as read', d, d, '', 'reviewed', 'manual']);
    for (const d of r.reviewedOk) review.push([s.settings.name, 'Flagged day reviewed as genuine', d, d, '', 'kept', 'quality']);
    review.push([s.settings.name, 'Unit', '', '', '', `${s.settings.unit}${s.settings.unit !== s.info.unit ? ` (file read as ${s.info.unit})` : ''}`, s.info.unitEvidence]);
    review.push([s.settings.name, 'Time convention', '', '', '', s.settings.convention ?? s.info.convention, s.info.conventionEvidence]);
    review.push([s.settings.name, 'Meter type', '', '', '', s.settings.meterType, '']);
  }
  addSheet(wb, used, 'Data review', review);

  // --- Calendar and tariff -------------------------------------------------------------
  const calRows: (string | number)[][] = [
    ['Calendars and tariffs as entered.'], [],
    ['Site', 'Hours confirmed', 'Week', 'Bank holidays', 'Holidays added', 'Holidays removed', 'Dated closures',
      'Exceptional periods', 'Low-activity window', 'Rates', 'Rate problems'],
  ];
  for (const { site: s } of sites) {
    const c = s.settings.calendar;
    calRows.push([
      s.settings.name, c.confirmed ? 'Yes' : 'No', describeCalendar(c),
      `${NATION_LABEL[c.nation]}, ${c.holidays}`, c.holidaysAdded.join(', '), c.holidaysRemoved.join(', '),
      c.closures.map(describeRange).join('; '),
      c.exceptions.map((e) => `${describeRange(e)} (${describePeriods(e.periods)})`).join('; '),
      c.lowActivity ? `${slotTime(c.lowActivity.open)}-${slotTime(c.lowActivity.close)}` : '',
      describeTariff(s.settings.tariff, s.settings.rateP ?? opts.defaultRateP), s.metrics.rate.problems.join(' '),
    ]);
  }
  addSheet(wb, used, 'Calendar and tariff', calRows);

  // --- One sheet per site --------------------------------------------------------------
  const labels = hhLabels();
  for (const { site: s } of sites) {
    const m = s.metrics;
    const f = s.frame;
    const rows: (string | number)[][] = [
      [s.settings.name], [`Source file: ${s.filename}${s.settings.meterId ? `  ·  Meter ${s.settings.meterId}` : ''}`],
      [`${m.coverage.from} to ${m.coverage.to}: ${Math.round(m.coverage.validDays)} valid days, ${(m.coverage.share * 100).toFixed(1)}% coverage. ${m.annualisation.method}`],
      [`Rates: ${m.rate.description}.`],
      [],
      ['Closed hours by day class', 'Closed kWh', 'Closed hours', 'Excess vs all-period ref (kWh)', 'Excess vs closed-hours ref (kWh)'],
      ...m.byClass.map((b) => [b.label, r0(b.closedKwh), r0(b.closedHours), r0(b.excessAll), r0(b.excessClosed)]),
      [],
      ['Month', 'kWh (valid readings)', 'Day kWh', 'Night kWh (00:00-07:00)', 'Base kW (reference)', 'Valid readings', 'Missing or excluded readings'],
    ];
    const dn = dayNightSplit(f);
    const mb = new Map(m.monthlyBase.map((x) => [x.key, x]));
    monthlyTotals(f).forEach((mt, i) => {
      const d = dn.months[i];
      const b = mb.get(mt.month);
      rows.push([mt.month, mt.kwh, d?.day_kwh ?? '', d?.night_kwh ?? '', r2(b?.kw), b?.samples ?? '', b?.excluded ?? '']);
    });
    rows.push([], ['Top ten half-hour peaks (one per day)', 'Time', 'kW', 'kVA (assumed PF)', 'Share of capacity', 'Open?']);
    for (const p of m.peaks) rows.push([p.date, slotTime(p.slot), p.kw, p.kva, p.utilisation === null ? '' : `${Math.round(p.utilisation * 100)}%`, p.open ? 'open' : 'closed']);
    if (m.anomalies.events.length) {
      rows.push([], ['Unusual days', 'Compared with', 'Actual kWh', 'Expected kWh', 'Deviation', 'Baseline from', 'Baseline to', 'Days in baseline', 'Data quality']);
      for (const e of m.anomalies.events) {
        rows.push([e.date, e.dayLabel, e.actualKwh, e.expectedKwh, `${Math.round(e.deviation * 100)}%`, e.baselineFrom, e.baselineTo, e.samples, e.quality ?? 'ok']);
      }
    }
    if (m.anomalies.changes.length) {
      rows.push([], ['Persistent changes: from', 'To', 'Direction', 'Days flagged', 'Eligible days', 'Mean deviation', 'Actual kWh', 'Expected kWh']);
      for (const c of m.anomalies.changes) rows.push([c.from, c.to, c.direction, c.flaggedDays, c.eligibleDays, `${Math.round(c.meanDeviation * 100)}%`, c.actualKwh, c.expectedKwh]);
    }
    if (s.headroom) {
      const h = s.headroom;
      rows.push([], [`Headroom: capacity ${h.capacityKva} kVA, usable ${h.usableKva} kVA after ${h.marginPct}% margin, highest ${h.peakKva} kVA `
        + `(${h.peakWhen}) at an assumed power factor of ${h.powerFactor}, firm headroom ${h.firmHeadroomKw} kW, over ${h.intervals} analysed half hours.`]);
      if (h.test) rows.push([h.test.summary]);
      rows.push(['Month', 'Peak kVA', 'Headroom kW']);
      for (const x of h.monthly) rows.push([x.month, x.peakKva, x.headroomKw]);
    }
    rows.push([], ['Average kW by half hour (valid readings)', ...labels]);
    for (const series of dayOfWeekProfile(f).series) rows.push([series.name, ...series.values]);
    if (opts.halfHourly) {
      rows.push([], ['Date', 'Daily kWh (valid)', ...labels.map((l) => `${l} kWh`), 'Missing or excluded']);
      f.dates.forEach((d, i) => {
        const r = f.rows[i];
        let tot = 0;
        const notes = new Map<string, string[]>();
        const cells = r.map((v, sl) => {
          if (isValid(f, i, sl)) { tot += v; return round(v, 4); }
          const why = FLAG_TEXT[flagAt(f, i, sl)] ?? 'flagged';
          notes.set(why, [...(notes.get(why) ?? []), slotTime(sl)]);
          return '';
        });
        const note = [...notes.entries()].map(([k, v]) => `${k}: ${v.length === SLOTS ? 'all day' : v.join(' ')}`).join('; ');
        rows.push([d, round(tot, 3), ...cells, note]);
      });
    }
    addSheet(wb, used, s.settings.name, rows);
  }

  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

/** The sites table exactly as shown on screen: same columns, same order. */
export function buildSitesTableWorkbook(title: string, sites: TableSite[], rateP: number): ArrayBuffer {
  const rows: (string | number)[][] = [
    [title ? `${title}: sites` : 'Sites'],
    [`Ranked by the estimated annual cost associated with closed-hours use above the reference (not a saving). Unranked sites have too `
      + `little data to annualise. Default rate ${rateP}p/kWh; observed figures cover each file's own period.`],
    [],
    SITE_COLUMNS.map((c) => c.label),
    ...sites.map((s) => SITE_COLUMNS.map((c) => c.exportValue(s))),
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = SITE_COLUMNS.map((c) => ({ wch: c.key === 'site' ? 28 : c.key === 'type' || c.key === 'findings' ? 22 : 14 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sites');
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}
