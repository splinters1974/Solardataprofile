/**
 * Every number behind the analysis, as a workbook engineers can carry on
 * with in their own models.
 */
import * as XLSX from 'xlsx';
import { dayNightSplit, dayOfWeekProfile, hhLabels, monthlyTotals, round } from './analytics';
import { describeHours, SITE_TYPES, type SiteMetrics, type SiteSettings } from './findings';
import type { Frame } from './parser';
import { VERDICT_TEXT, type QualityReport } from './dataQuality';
import type { HeadroomResult } from './headroom';
import { SITE_COLUMNS, type TableSite } from './siteTable';

export interface ExportSite {
  settings: SiteSettings;
  filename: string;
  frame: Frame;
  metrics: SiteMetrics;
  quality: QualityReport;
  headroom: HeadroomResult | null;
}

/** Excel caps sheet names at 31 characters and bans a few symbols. */
function sheetName(base: string, used: Set<string>): string {
  const clean = base.replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 28) || 'Site';
  let name = clean;
  for (let i = 2; used.has(name.toLowerCase()); i++) name = `${clean.slice(0, 26)} ${i}`;
  used.add(name.toLowerCase());
  return name;
}

/**
 * `halfHourly: false` is the summary-only workbook given to customers:
 * findings, quality, monthly figures, headroom and average profiles, but
 * not the raw half-hourly readings.
 */
export function buildWorkbook(sites: ExportSite[], opts: { halfHourly: boolean } = { halfHourly: true }): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  const used = new Set<string>();

  const summary: (string | number)[][] = [[
    'Site', 'File', 'Building type', 'Opening hours', 'From', 'To', 'Days',
    'Rate (p/kWh)', 'Annual kWh', 'Annual cost (£)', 'Peak kW', 'Average kW', 'Load factor',
    'Base load kW', 'Base load share', 'Out-of-hours share', 'Out-of-hours cost (£)',
    'Out-of-hours above base (£)', 'Findings', 'Data quality', 'Capacity (kVA)', 'Peak (kVA)',
    'Firm headroom (kW)', 'Test load fits',
  ]];
  for (const s of sites) {
    const m = s.metrics;
    summary.push([
      s.settings.name, s.filename, SITE_TYPES[s.settings.type].label, describeHours(s.settings.hours),
      m.dateFrom, m.dateTo, m.days, m.rateP, m.annualKwh, m.annualCost, m.peakKw, m.averageKw,
      m.loadFactor, m.baseKw, m.baseShare, m.hasOutOfHours ? m.oohShare : '',
      m.hasOutOfHours ? m.oohCost : '', m.hasOutOfHours ? m.oohExcessCost : '',
      m.findings.filter((f) => f.level !== 'info').length,
      VERDICT_TEXT[s.quality.verdict].label,
      s.headroom?.capacityKva ?? '', s.headroom?.peakKva ?? '', s.headroom?.firmHeadroomKw ?? '',
      s.headroom?.test ? (s.headroom.test.fits ? 'Yes' : 'No') : '',
    ]);
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), sheetName('Summary', used));

  const labels = hhLabels();
  for (const s of sites) {
    const m = s.metrics;
    const rows: (string | number)[][] = [
      [s.settings.name], [`Source file: ${s.filename}`],
      [`Rate ${m.rateP}p/kWh fully delivered. Annual figures are scaled to a year from ${m.days} days.`],
      [],
      ['Findings', 'Level', '£ a year', 'Detail'],
      ...m.findings.map((f) => [f.title, f.level, f.annualGbp !== undefined ? Math.round(f.annualGbp) : '', f.detail]),
      [],
      [`Data quality: ${VERDICT_TEXT[s.quality.verdict].label}`, 'Status', '', 'Detail'],
      ...s.quality.checks.map((c) => [c.title, c.status, '', c.detail]),
      [],
      ['Month', 'kWh', 'Day kWh', 'Night kWh (00:00-07:00)', 'Cost (£)'],
    ];
    const dn = dayNightSplit(s.frame);
    monthlyTotals(s.frame).forEach((mt, i) => {
      const d = dn.months[i];
      rows.push([mt.month, mt.kwh, d?.day_kwh ?? '', d?.night_kwh ?? '', round((mt.kwh * m.rateP) / 100)]);
    });
    if (s.headroom) {
      const h = s.headroom;
      rows.push([], [`Headroom: capacity ${h.capacityKva} kVA, usable ${h.usableKva} kVA, peak ${h.peakKva} kVA `
        + `(${h.peakWhen}), firm headroom ${h.firmHeadroomKw} kW`]);
      if (h.test) rows.push([h.test.summary]);
      rows.push(['Month', 'Peak kVA', 'Headroom kW']);
      for (const x of h.monthly) rows.push([x.month, x.peakKva, x.headroomKw]);
    }
    rows.push([], ['Average kW by half hour', ...labels]);
    for (const series of dayOfWeekProfile(s.frame).series) rows.push([series.name, ...series.values]);
    if (opts.halfHourly) {
      rows.push([], ['Date', 'Daily kWh', ...labels.map((l) => `${l} kWh`)]);
      s.frame.dates.forEach((d, i) => {
        const r = s.frame.rows[i];
        rows.push([d, round(r.reduce((a, b) => a + b, 0), 3), ...r.map((v) => round(v, 4))]);
      });
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), sheetName(s.settings.name, used));
  }

  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

/** The sites table exactly as shown on screen: same columns, same order. */
export function buildSitesTableWorkbook(title: string, sites: TableSite[], rateP: number): ArrayBuffer {
  const rows: (string | number)[][] = [
    [title ? `${title}: sites` : 'Sites'],
    [`Ranked by out-of-hours use above base load. Costs at the rates set (default ${rateP}p/kWh), scaled to a year.`],
    [],
    SITE_COLUMNS.map((c) => c.label),
    ...sites.map((s) => SITE_COLUMNS.map((c) => c.exportValue(s))),
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = SITE_COLUMNS.map((c) => ({ wch: c.key === 'site' ? 28 : c.key === 'type' || c.key === 'findings' ? 22 : 13 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sites');
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}
