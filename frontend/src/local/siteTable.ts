/**
 * The columns of the "Where to start" sites table. Shared by the screen
 * (for sorting) and the Excel export, so both always list the same things.
 *
 * Observed figures cover each file's own period. Annual figures are
 * estimates and are blank for a site with too little data to annualise.
 */
import { SITE_TYPES, type SiteSettings } from './site';
import type { SiteMetrics } from './findings';
import { VERDICT_TEXT, type QualityReport } from './dataQuality';
import type { HeadroomResult } from './headroom';

export interface TableSite {
  settings: SiteSettings;
  metrics: SiteMetrics;
  quality: QualityReport;
  headroom: HeadroomResult | null;
  /** Position in the "Where to start" ranking, from 1; null when not ranked (not annualised). */
  rank: number | null;
}

export type ColumnKey =
  | 'rank' | 'site' | 'type' | 'days' | 'coverage' | 'observed' | 'kwh' | 'cost' | 'base' | 'closed' | 'above'
  | 'headroom' | 'data' | 'findings';

export interface SiteColumn {
  key: ColumnKey;
  label: string;
  /** Shorter heading for the screen, where width is tight. */
  short?: string;
  /** Text columns sort A to Z first; number columns largest first. */
  numeric: boolean;
  /** What the column sorts by. Null sorts last whichever way round. */
  sortValue: (s: TableSite) => string | number | null;
  /** What goes in the spreadsheet cell. */
  exportValue: (s: TableSite) => string | number;
}

const VERDICT_RANK = { good: 0, check: 1, poor: 2 } as const;
const findingCounts = (m: SiteMetrics) =>
  (['high', 'medium', 'low'] as const).map((l) => m.findings.filter((f) => f.level === l).length);

export const SITE_COLUMNS: SiteColumn[] = [
  { key: 'rank', label: '#', numeric: true, sortValue: (s) => (s.rank === null ? null : -s.rank), exportValue: (s) => s.rank ?? '' },
  {
    key: 'site', label: 'Site', numeric: false, sortValue: (s) => s.settings.name.toLowerCase(),
    exportValue: (s) => s.settings.name,
  },
  {
    key: 'type', label: 'Type', numeric: false,
    sortValue: (s) => SITE_TYPES[s.settings.type].label.toLowerCase(), exportValue: (s) => SITE_TYPES[s.settings.type].label,
  },
  {
    key: 'days', label: 'Valid days', short: 'Days', numeric: true,
    sortValue: (s) => s.metrics.coverage.validDays, exportValue: (s) => Math.round(s.metrics.coverage.validDays),
  },
  {
    key: 'coverage', label: 'Coverage', short: 'Cover', numeric: true,
    sortValue: (s) => s.metrics.coverage.share, exportValue: (s) => `${(s.metrics.coverage.share * 100).toFixed(0)}%`,
  },
  {
    key: 'observed', label: 'Observed kWh', short: 'Observed kWh', numeric: true,
    sortValue: (s) => s.metrics.observed.kwh, exportValue: (s) => Math.round(s.metrics.observed.kwh),
  },
  {
    key: 'kwh', label: 'kWh a year (estimate)', short: 'kWh/yr est.', numeric: true,
    sortValue: (s) => s.metrics.annual?.kwh ?? null, exportValue: (s) => (s.metrics.annual ? Math.round(s.metrics.annual.kwh) : 'not annualised'),
  },
  {
    key: 'cost', label: 'Energy cost a year (estimate, £)', short: '£/yr est.', numeric: true,
    sortValue: (s) => s.metrics.annual?.cost ?? null, exportValue: (s) => (s.metrics.annual ? Math.round(s.metrics.annual.cost) : 'not annualised'),
  },
  {
    key: 'base', label: 'Base kW (all-period reference)', short: 'Base kW', numeric: true,
    sortValue: (s) => s.metrics.baseAll.kw, exportValue: (s) => Math.round(s.metrics.baseAll.kw * 10) / 10,
  },
  {
    key: 'closed', label: 'Closed-hours share', short: 'Closed', numeric: true,
    sortValue: (s) => (s.metrics.hasClosed ? s.metrics.closed.share : null),
    exportValue: (s) => (s.metrics.hasClosed ? `${Math.round(s.metrics.closed.share * 100)}%` : '24-7'),
  },
  {
    key: 'above', label: 'Closed-hours excess, associated cost a year (£)', short: 'Excess £/yr', numeric: true,
    sortValue: (s) => s.metrics.excess?.annual?.cost ?? null,
    exportValue: (s) => (!s.metrics.excess ? '' : s.metrics.excess.annual ? Math.round(s.metrics.excess.annual.cost) : 'not annualised'),
  },
  {
    key: 'headroom', label: 'Firm headroom kW', short: 'Headroom', numeric: true,
    sortValue: (s) => s.headroom?.firmHeadroomKw ?? null,
    exportValue: (s) => (s.headroom ? Math.round(s.headroom.firmHeadroomKw) : ''),
  },
  {
    key: 'data', label: 'Data', numeric: false,
    sortValue: (s) => VERDICT_RANK[s.quality.verdict], exportValue: (s) => VERDICT_TEXT[s.quality.verdict].label,
  },
  {
    key: 'findings', label: 'Findings', numeric: true,
    sortValue: (s) => { const [h, m, l] = findingCounts(s.metrics); return h * 10000 + m * 100 + l; },
    exportValue: (s) => {
      const [h, m, l] = findingCounts(s.metrics);
      return [[h, 'High'], [m, 'Medium'], [l, 'Low']].filter(([c]) => c).map(([c, t]) => `${c} ${t}`).join(', ') || 'None';
    },
  },
];

export interface SortState { key: ColumnKey; dir: 'asc' | 'desc' }

/** First click on a column: A to Z for text, largest first for numbers. */
export const firstDir = (c: SiteColumn): 'asc' | 'desc' => (c.numeric ? 'desc' : 'asc');

export function sortSites<T extends TableSite>(sites: T[], sort: SortState | null): T[] {
  if (!sort) return sites;
  const col = SITE_COLUMNS.find((c) => c.key === sort.key);
  if (!col) return sites;
  const sign = sort.dir === 'asc' ? 1 : -1;
  const r = (x: T) => x.rank ?? 1e9;
  return [...sites].sort((a, b) => {
    const x = col.sortValue(a);
    const y = col.sortValue(b);
    if (x === null || y === null) return x === y ? r(a) - r(b) : x === null ? 1 : -1;
    const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'en-GB');
    return c * sign || r(a) - r(b);
  });
}
