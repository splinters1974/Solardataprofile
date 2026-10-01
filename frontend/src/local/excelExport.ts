/**
 * Every number behind the analysis, as a workbook engineers can carry on
 * with in their own models.
 */
import * as XLSX from 'xlsx';
import { dayNightSplit, dayOfWeekProfile, hhLabels, monthlyTotals, round } from './analytics';
import { describeHours, SITE_TYPES, type SiteMetrics, type SiteSettings } from './findings';
import type { Frame } from './parser';

export interface ExportSite {
  settings: SiteSettings;
  filename: string;
  frame: Frame;
  metrics: SiteMetrics;
}

/** Excel caps sheet names at 31 characters and bans a few symbols. */
function sheetName(base: string, used: Set<string>): string {
  const clean = base.replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 28) || 'Site';
  let name = clean;
  for (let i = 2; used.has(name.toLowerCase()); i++) name = `${clean.slice(0, 26)} ${i}`;
  used.add(name.toLowerCase());
  return name;
}

export function buildWorkbook(sites: ExportSite[]): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  const used = new Set<string>();

  const summary: (string | number)[][] = [[
    'Site', 'File', 'Building type', 'Opening hours', 'From', 'To', 'Days',
    'Rate (p/kWh)', 'Annual kWh', 'Annual cost (£)', 'Peak kW', 'Average kW', 'Load factor',
    'Base load kW', 'Base load share', 'Out-of-hours share', 'Out-of-hours cost (£)',
    'Out-of-hours above base (£)', 'Findings',
  ]];
  for (const s of sites) {
    const m = s.metrics;
    summary.push([
      s.settings.name, s.filename, SITE_TYPES[s.settings.type].label, describeHours(s.settings.hours),
      m.dateFrom, m.dateTo, m.days, m.rateP, m.annualKwh, m.annualCost, m.peakKw, m.averageKw,
      m.loadFactor, m.baseKw, m.baseShare, m.hasOutOfHours ? m.oohShare : '',
      m.hasOutOfHours ? m.oohCost : '', m.hasOutOfHours ? m.oohExcessCost : '',
      m.findings.filter((f) => f.level !== 'info').length,
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
      ['Month', 'kWh', 'Day kWh', 'Night kWh (00:00-07:00)', 'Cost (£)'],
    ];
    const dn = dayNightSplit(s.frame);
    monthlyTotals(s.frame).forEach((mt, i) => {
      const d = dn.months[i];
      rows.push([mt.month, mt.kwh, d?.day_kwh ?? '', d?.night_kwh ?? '', round((mt.kwh * m.rateP) / 100)]);
    });
    rows.push([], ['Average kW by half hour', ...labels]);
    for (const series of dayOfWeekProfile(s.frame).series) rows.push([series.name, ...series.values]);
    rows.push([], ['Date', 'Daily kWh', ...labels.map((l) => `${l} kWh`)]);
    s.frame.dates.forEach((d, i) => {
      const r = s.frame.rows[i];
      rows.push([d, round(r.reduce((a, b) => a + b, 0), 3), ...r.map((v) => round(v, 4))]);
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), sheetName(s.settings.name, used));
  }

  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}
