/**
 * The columns of the "Where to start" sites table. Shared by the screen
 * (for sorting) and the Excel export, so both always list the same things.
 */
import { SITE_TYPES, type SiteMetrics, type SiteSettings } from './findings';
import { VERDICT_TEXT, type QualityReport } from './dataQuality';
import type { HeadroomResult } from './headroom';

export interface TableSite {
  settings: SiteSettings;
  metrics: SiteMetrics;
  quality: QualityReport;
  headroom: HeadroomResult | null;
  /** Position in the "Where to start" ranking, from 1. */
  rank: number;
}

export type ColumnKey =
  | 'rank' | 'site' | 'type' | 'days' | 'kwh' | 'cost' | 'base' | 'ooh' | 'above' | 'headroom' | 'data' | 'findings';

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
  { key: 'rank', label: '#', numeric: true, sortValue: (s) => -s.rank, exportValue: (s) => s.rank },
  { key: 'site', label: 'Site', numeric: false, sortValue: (s) => s.settings.name.toLowerCase(), exportValue: (s) => s.settings.name },
  {
    key: 'type', label: 'Type', numeric: false,
    sortValue: (s) => SITE_TYPES[s.settings.type].label.toLowerCase(), exportValue: (s) => SITE_TYPES[s.settings.type].label,
  },
  { key: 'days', label: 'Days of data', short: 'Days', numeric: true, sortValue: (s) => s.metrics.days, exportValue: (s) => s.metrics.days },
  { key: 'kwh', label: 'kWh a year', numeric: true, sortValue: (s) => s.metrics.annualKwh, exportValue: (s) => Math.round(s.metrics.annualKwh) },
  { key: 'cost', label: 'Annual cost (£)', short: 'Annual cost', numeric: true, sortValue: (s) => s.metrics.annualCost, exportValue: (s) => Math.round(s.metrics.annualCost) },
  { key: 'base', label: 'Base kW', numeric: true, sortValue: (s) => s.metrics.baseKw, exportValue: (s) => s.metrics.baseKw },
  {
    key: 'ooh', label: 'Out of hours', numeric: true,
    sortValue: (s) => (s.metrics.hasOutOfHours ? s.metrics.oohShare : null),
    exportValue: (s) => (s.metrics.hasOutOfHours ? `${Math.round(s.metrics.oohShare * 100)}%` : '24-7'),
  },
  {
    key: 'above', label: 'Above base £/yr', numeric: true,
    sortValue: (s) => (s.metrics.hasOutOfHours ? s.metrics.oohExcessCost : null),
    exportValue: (s) => (s.metrics.hasOutOfHours ? Math.round(s.metrics.oohExcessCost) : ''),
  },
  {
    key: 'headroom', label: 'Headroom kW', short: 'Headroom', numeric: true,
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
  return [...sites].sort((a, b) => {
    const x = col.sortValue(a);
    const y = col.sortValue(b);
    if (x === null || y === null) return x === y ? a.rank - b.rank : x === null ? 1 : -1;
    const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'en-GB');
    return c * sign || a.rank - b.rank;
  });
}
