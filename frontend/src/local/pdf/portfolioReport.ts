/**
 * One document for a whole estate: a ranked table of where to start, then a
 * page per site with its top investigations and year heatmap, then every
 * opportunity across the estate. The one-page site summary is the same page
 * for one site, followed by its opportunities appendix.
 */
import { fmtDayMonYear, fmtLong } from '../dates';
import { pdfFooter } from '../edition';
import { RAMP_HEX } from '../carpet';
import { AMERESCO_LOGO, BRAND_BLUE } from '../brand';
import { SITE_TYPES } from '../site';
import { describeCalendar } from '../calendar';
import { VERDICT_TEXT } from '../dataQuality';
import type { CarbonFactor, SiteMetrics } from '../findings';
import type { ScenarioRun } from '../scenarios';
import type { Opportunity } from '../actions';
import { STATUS_LABEL } from '../actions';
import type { SiteSummary } from '../localClient';
import { carpetImage, fmt, hex, Report } from './common';
import { estateOpportunities, opportunitiesAppendix, topThree } from './appendix';

const BRAND = hex(BRAND_BLUE);

export interface PortfolioSite {
  site: SiteSummary;
  scenarioRun: ScenarioRun | null;
  carpet: { canvas: HTMLCanvasElement; maxKw: number; dates: string[] } | null;
  carbon: CarbonFactor | null;
}

const money = (v: number) => `£${fmt(v)}`;

function headlineTiles(r: Report, m: SiteMetrics) {
  r.tiles([
    m.annual ? [money(m.annual.cost), 'EST. ENERGY COST A YEAR'] : [money(m.observed.cost), 'ENERGY COST, PERIOD'],
    m.annual ? [fmt(m.annual.kwh), 'kWh A YEAR (EST.)'] : [fmt(m.observed.kwh), 'kWh, OBSERVED PERIOD'],
    [`${fmt(m.peak.kw, 1)} kW`, 'HIGHEST HALF HOUR'],
    [`${fmt(m.baseAll.kw, 1)} kW`, 'BASE LOAD REFERENCE'],
    [m.hasClosed ? `${Math.round(m.closed.share * 100)}%` : '24-7', 'USE IN CLOSED HOURS'],
  ]);
}

function drawSitePage(r: Report, p: PortfolioSite, note?: string) {
  const s = p.site;
  const m = s.metrics;
  r.title(s.settings.name,
    `${SITE_TYPES[s.settings.type].label}  ·  ${fmtDayMonYear(m.coverage.from)} to ${fmtDayMonYear(m.coverage.to)} `
    + `(${Math.round(m.coverage.validDays)} valid days, ${(m.coverage.share * 100).toFixed(0)}% coverage)  ·  ${s.filename}`
    + `${s.settings.meterId ? `  ·  meter ${s.settings.meterId}` : ''}`);
  headlineTiles(r, m);
  r.small(`${m.annual ? `Annual figures are ${m.annualisation.mode === 'full' ? 'estimates' : 'indicative estimates'} scaled from valid hours. `
    + `Observed: ${fmt(m.observed.kwh)} kWh, ${money(m.observed.cost)}.` : m.annualisation.method} Rates: ${m.rate.description}.`);
  r.h2('Top investigations', 30);
  topThree(r, s);
  r.small(`Calendar: ${describeCalendar(s.settings.calendar)}`
    + `${s.headroom ? ` Supply ${fmt(s.headroom.capacityKva)} kVA, highest ${fmt(s.headroom.peakKva)} kVA at an assumed power factor of ${s.headroom.powerFactor}, firm headroom ${fmt(s.headroom.firmHeadroomKw)} kW.` : ''}`
    + ` Data quality: ${VERDICT_TEXT[s.quality.verdict].label}.`);
  if (note) r.small(note);
  if (p.carpet) {
    // Keep each site to one page: shrink the heatmap into the space left.
    const height = Math.max(20, Math.min(40, r.remaining() - 19));
    if (r.remaining() > 40) {
      carpetImage(r, {
        title: 'The year at a glance (kW). Grey hatching: no valid reading.', canvas: p.carpet.canvas, dates: p.carpet.dates,
        maxKw: p.carpet.maxKw, ramp: RAMP_HEX, height,
      });
    }
  }
}

/** Ranked by the estimated annual cost associated with closed-hours excess. Unannualised sites follow, unranked. */
export function rankSites<T extends { metrics: SiteMetrics }>(sites: T[]): T[] {
  return [...sites].sort((a, b) => {
    const x = a.metrics.rankValue;
    const y = b.metrics.rankValue;
    if (x === null || y === null) return x === y ? b.metrics.observed.cost - a.metrics.observed.cost : x === null ? 1 : -1;
    return y - x || b.metrics.observed.cost - a.metrics.observed.cost;
  });
}

export function buildPortfolioReport(title: string, sites: PortfolioSite[], opportunities: Opportunity[], opts: { includeNotes: boolean }): ArrayBuffer {
  const r = new Report({
    orientation: 'landscape', brand: BRAND, margin: 15, logo: AMERESCO_LOGO,
    footer: pdfFooter(title, 'portfolio energy review'),
    title: `${title} - Portfolio Energy Review`,
  });
  const counted = sites.filter((p) => p.site.settings.role !== 'sub');
  const annualised = counted.filter((p) => p.site.metrics.annual);
  const sum = (list: PortfolioSite[], f: (m: SiteMetrics) => number) => list.reduce((a, p) => a + f(p.site.metrics), 0);
  const highs = sum(counted, (m) => m.findings.filter((f) => f.level === 'high').length);

  r.title('Portfolio Energy Review',
    `${title}  ·  ${sites.length} meter${sites.length === 1 ? '' : 's'}  ·  issued ${fmtLong(new Date())}`);
  r.tiles([
    [String(counted.length), 'METERS IN TOTALS'],
    [fmt(sum(counted, (m) => m.observed.kwh)), 'kWh OBSERVED'],
    [money(sum(annualised, (m) => m.annual!.cost)), `EST. COST A YEAR (${annualised.length} OF ${counted.length})`],
    [money(sum(annualised, (m) => m.excess?.annual?.cost ?? 0)), 'CLOSED-HOURS EXCESS A YEAR'],
    [String(highs), 'HIGH-IMPACT FINDINGS'],
  ]);
  r.paragraph('Meters are ranked by the estimated annual energy cost associated with closed-hours use above the reference: energy '
    + 'used when the building should be closed, beyond what never switches off. It is usually the cheapest consumption to look '
    + 'at first, through controls and schedules. It is an associated cost, not a guaranteed saving. Meters with too little data '
    + 'to annualise are listed after the ranked ones. Submeters are excluded from totals.');

  r.h2('Where to start', 40);
  let rank = 0;
  r.y = r.table(
    ['#', 'Site', 'Type', 'Valid days', 'kWh observed', 'Est. cost a year', 'Base kW', 'Closed hours',
      'Excess £/yr (est.)', 'Headroom kW', 'Data', 'Top investigation'],
    rankSites(sites.map((p) => ({ ...p, metrics: p.site.metrics }))).map((p) => {
      const s = p.site;
      const m = s.metrics;
      const top = m.findings.find((f) => f.level !== 'info');
      return [
        m.rankValue === null ? '-' : String(++rank), `${s.settings.name}${s.settings.role === 'sub' ? ' (sub)' : ''}`,
        SITE_TYPES[s.settings.type].label, fmt(m.coverage.validDays),
        fmt(m.observed.kwh), m.annual ? money(m.annual.cost) : 'not annualised', fmt(m.baseAll.kw, 1),
        m.hasClosed ? `${Math.round(m.closed.share * 100)}%` : '24-7',
        m.excess?.annual ? money(m.excess.annual.cost) : '-',
        s.headroom ? fmt(s.headroom.firmHeadroomKw) : '-',
        VERDICT_TEXT[s.quality.verdict].label,
        top ? top.title : 'Nothing significant',
      ];
    }),
    { widths: [0.03, 0.13, 0.09, 0.05, 0.07, 0.08, 0.05, 0.05, 0.07, 0.06, 0.05, 0.27], fontSize: 6.8, leftCols: [1, 2, 10, 11] },
  ) + 3;
  r.small('Annual figures are estimates scaled from each meter\'s valid hours; observed kWh covers each file\'s own period, so '
    + 'periods differ between meters. Base kW is the all-period 5th percentile. Costs are estimated energy cost at the rates '
    + 'entered, excluding fixed charges.');

  for (const p of rankSites(sites.map((x) => ({ ...x, metrics: x.site.metrics })))) {
    r.newPage();
    drawSitePage(r, p);
  }

  r.newPage();
  estateOpportunities(r, opportunities.map((o) => ({ siteName: o.siteName, finding: o.finding, status: STATUS_LABEL[o.action.status] })));
  void opts;
  return r.finish();
}

/**
 * The one-page site summary, then its opportunities appendix: observed and
 * annual figures, every investigation, scenarios, method, calendar, evidence.
 */
export function buildSiteSummary(p: PortfolioSite & { includeNotes?: boolean }): ArrayBuffer {
  const s = p.site;
  const r = new Report({
    orientation: 'landscape', brand: BRAND, margin: 15, logo: AMERESCO_LOGO,
    footer: pdfFooter(s.settings.name, 'site summary'),
    title: `${s.settings.name} - Site Summary`,
  });
  drawSitePage(r, p, `Issued ${fmtLong(new Date())}. Costs are estimated energy cost at the rates shown, associated with a `
    + 'pattern of use, not a guaranteed saving. Base load is the 5th percentile of valid half-hourly demand.');
  r.newPage();
  opportunitiesAppendix(r, { site: s, scenarioRun: p.scenarioRun, carbon: p.carbon, includeNotes: p.includeNotes });
  return r.finish();
}
