/**
 * One document for a whole estate: a ranked table of where to start, then a
 * page per site with its findings and year heatmap.
 */
import { fmtDayMonYear, fmtLong } from '../dates';
import { RAMP_HEX } from '../carpet';
import { describeHours, SITE_TYPES, type SiteMetrics, type SiteSettings } from '../findings';
import { carpetImage, findingsList, fmt, hex, Report } from './common';

const BRAND = hex('#1d4ed8');

export interface PortfolioSite {
  settings: SiteSettings;
  filename: string;
  metrics: SiteMetrics;
  carpet: { canvas: HTMLCanvasElement; maxKw: number; dates: string[] } | null;
}

const money = (v: number) => `£${fmt(v)}`;

/** Ranked by the addressable out-of-hours cost: the clearest place to start. */
export function rankSites<T extends { metrics: SiteMetrics }>(sites: T[]): T[] {
  return [...sites].sort((a, b) =>
    b.metrics.oohExcessCost - a.metrics.oohExcessCost || b.metrics.annualCost - a.metrics.annualCost);
}

export function buildPortfolioReport(title: string, sites: PortfolioSite[]): ArrayBuffer {
  const r = new Report({
    orientation: 'landscape', brand: BRAND, margin: 15,
    footer: `${title} — portfolio energy review`,
    title: `${title} — Portfolio Energy Review`,
  });
  const ranked = rankSites(sites);
  const sum = (f: (m: SiteMetrics) => number) => ranked.reduce((a, s) => a + f(s.metrics), 0);
  const highs = sum((m) => m.findings.filter((f) => f.level === 'high').length);
  const rates = [...new Set(ranked.map((s) => s.metrics.rateP))];

  r.title('Portfolio Energy Review',
    `${title}  ·  ${ranked.length} site${ranked.length === 1 ? '' : 's'}  ·  issued ${fmtLong(new Date())}`);
  r.tiles([
    [String(ranked.length), 'SITES'],
    [fmt(sum((m) => m.annualKwh)), 'kWh A YEAR'],
    [money(sum((m) => m.annualCost)), 'ANNUAL COST'],
    [money(sum((m) => m.oohExcessCost)), 'OUT OF HOURS ABOVE BASE'],
    [String(highs), 'HIGH FINDINGS'],
  ]);
  r.paragraph('Sites are ranked by what out-of-hours use above base load costs each year: energy '
    + 'used when the building should be closed, beyond what never switches off. It is usually the '
    + 'cheapest consumption to remove, through controls and schedules rather than capital works.');

  r.h2('Where to start', 40);
  r.y = r.table(
    ['#', 'Site', 'Type', 'kWh a year', 'Annual cost', 'Peak kW', 'Base kW', 'Out of hours',
      'Above base £/yr', 'High', 'Top finding'],
    ranked.map((s, k) => {
      const m = s.metrics;
      const top = m.findings.find((f) => f.level !== 'info');
      return [
        String(k + 1), s.settings.name, SITE_TYPES[s.settings.type].label, fmt(m.annualKwh),
        money(m.annualCost), fmt(m.peakKw, 1), fmt(m.baseKw, 1),
        m.hasOutOfHours ? `${Math.round(m.oohShare * 100)}%` : '24-7',
        m.hasOutOfHours ? money(m.oohExcessCost) : '-',
        String(m.findings.filter((f) => f.level === 'high').length),
        top ? top.title : 'Nothing significant',
      ];
    }),
    { widths: [0.03, 0.15, 0.1, 0.07, 0.07, 0.055, 0.055, 0.065, 0.075, 0.04, 0.285], fontSize: 7, leftCols: [1, 2, 10] },
  ) + 3;
  r.small(`Costs use ${rates.map((p) => `${p}p`).join(' / ')} per kWh fully delivered and are scaled to a `
    + 'year from the days of data each site supplied. They show what each pattern costs now, not a '
    + 'guaranteed saving. Base load is the 5th percentile of half-hourly demand.');

  for (const s of ranked) {
    const m = s.metrics;
    r.newPage();
    r.title(s.settings.name,
      `${SITE_TYPES[s.settings.type].label}  ·  ${fmtDayMonYear(m.dateFrom)} to ${fmtDayMonYear(m.dateTo)} `
      + `(${m.days} days)  ·  ${s.filename}`);
    r.tiles([
      [money(m.annualCost), 'ANNUAL COST'],
      [fmt(m.annualKwh), 'kWh A YEAR'],
      [`${fmt(m.peakKw, 1)} kW`, 'PEAK DEMAND'],
      [`${fmt(m.baseKw, 1)} kW`, 'BASE LOAD'],
      [m.hasOutOfHours ? `${Math.round(m.oohShare * 100)}%` : 'n/a', 'OUT OF HOURS'],
    ]);
    findingsList(r, m.findings);
    r.small(`Opening hours: ${describeHours(s.settings.hours)}. Rate ${m.rateP}p/kWh.`);
    if (s.carpet) {
      // Keep each site to one page: shrink the heatmap into the space left,
      // down to a height that still reads.
      const height = Math.max(26, Math.min(40, r.remaining() - 20));
      carpetImage(r, {
        title: 'The year at a glance (kW)', canvas: s.carpet.canvas, dates: s.carpet.dates,
        maxKw: s.carpet.maxKw, ramp: RAMP_HEX, height,
      });
    }
  }

  return r.finish();
}
