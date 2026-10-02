/**
 * Drop-in replacement for src/api/client.ts in the standalone build.
 *
 * Same exports, same shapes, but everything runs in the browser: the file
 * is parsed here, the maths runs here and the PDFs are drawn here. Nothing
 * about the site's data leaves the machine, and it makes no network calls.
 *
 * vite.config.ts swaps this in for api/client.ts when building with
 * `--mode standalone`, so the React screens do not know the difference.
 */
import type {
  UploadResponse, SolarSizeResponse, SizingValues, AnalyserOverview,
  DayProfileResponse, LoadDurationResponse, DayNightResponse, WeekResponse,
  ScatterResponse,
} from '../types';
import { parseHHFile, type Frame } from './parser';
import {
  availableWeeks, dailySeries, dayNightSplit, dayOfWeekProfile, fullYearScatter,
  heatmapMatrix, hhSeries, loadDurationCurve, monthlyTotals, round, slice,
  summaryStats, weekProfile,
} from './analytics';
import { buildAnalyserReport, buildAnalyserSectionPdfs, type AnalyserReportInput } from './pdf/analyserReport';
import { zipSync } from 'fflate';
import { drawTimeSeries } from './timeseries';
import { buildPortfolioReport, buildSiteSummary, rankSites } from './pdf/portfolioReport';
import { fmtDayMonYear } from './dates';
import { analyseSite, DEFAULT_RATE_P, defaultSettings, type SiteMetrics, type SiteSettings } from './findings';
import { drawCarpet } from './carpet';
import { buildWorkbook } from './excelExport';
import { checkQuality, type QualityReport } from './dataQuality';
import { analyseHeadroom, type HeadroomResult } from './headroom';

const ACCEPTED_EXTENSIONS = ['.xlsx', '.xlsm', '.xls', '.csv', '.txt'];

interface Session {
  frame: Frame;
  filename: string;
  warnings: string[];
  format: 'A' | 'B';
  settings: SiteSettings;
}

const sessions = new Map<string, Session>();

function session(id: string): Session {
  const s = sessions.get(id);
  if (!s) throw new Error('No data loaded. Please drop your HH file on the box above.');
  return s;
}

/** Let the browser paint the loading state before a long synchronous job. */
const yieldToUi = () => new Promise((r) => setTimeout(r, 30));

const newId = () => (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);

export async function warmupBackend(): Promise<boolean> {
  return true;
}

export async function uploadHHFile(file: File): Promise<UploadResponse> {
  const name = file.name || '';
  if (!ACCEPTED_EXTENSIONS.some((ext) => name.toLowerCase().endsWith(ext))) {
    throw new Error('Unsupported file type. Please upload an Excel (.xlsx, .xlsm, .xls) or CSV (.csv) file.');
  }
  const bytes = await file.arrayBuffer();
  if (!bytes.byteLength) throw new Error('Uploaded file is empty.');
  await yieldToUi();

  const { frame, format, warnings } = parseHHFile(bytes, name);
  const id = newId();
  const siteName = name.replace(/\.(xlsx|xlsm|xls|csv|txt)$/i, '');
  sessions.set(id, { frame, filename: name, warnings, format, settings: defaultSettings(siteName) });

  const total = frame.rows.reduce((s, r) => s + r.reduce((a, b) => a + b, 0), 0);
  return {
    session_id: id,
    detected_format: format,
    days_parsed: frame.dates.length,
    date_from: frame.dates[0],
    date_to: frame.dates[frame.dates.length - 1],
    annual_kwh: round(total, 1),
    filename: name,
    monthly_totals: monthlyTotals(frame),
    heatmap: heatmapMatrix(frame),
    daily_series: dailySeries(frame),
    hh_series: hhSeries(frame),
    warnings,
  };
}

export async function forgetSession(sessionId: string): Promise<void> {
  sessions.delete(sessionId);
}

/** Nothing to recover locally: the data never leaves this page. */
export async function withSessionRecovery<T>(
  sessionId: string,
  run: (id: string) => Promise<T>,
  onNewSession: (upload: UploadResponse) => void,
): Promise<T> {
  void onNewSession; // same signature as the server client; never needed here
  return run(sessionId);
}

export function resetRecoveryBudget() {}

export function friendlyError(e: unknown, fallback: string): string {
  const message = (e as Error)?.message;
  return message && message.length < 600 ? message : fallback;
}

// --- Solar ----------------------------------------------------------------
// The standalone file is the HH Analyser only; App hides the solar area.
// These exist so the shared screens still compile against this client.

export async function sizeSystem(
  payload: SizingValues & { session_id: string },
): Promise<SolarSizeResponse> {
  void payload;
  throw new Error('Solar sizing is not part of the standalone analyser.');
}

export async function downloadReport(sessionId: string, siteName: string): Promise<void> {
  void sessionId; void siteName;
  throw new Error('Solar sizing is not part of the standalone analyser.');
}

function saveBlob(bytes: ArrayBuffer, filename: string, type = 'application/pdf') {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const slug = (name: string) =>
  (name || 'site').replace(/[^a-zA-Z0-9 _-]/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'site';

// --- HH Analyser ----------------------------------------------------------

export async function getAnalyserOverview(sessionId: string): Promise<AnalyserOverview> {
  const s = session(sessionId);
  return {
    summary: summaryStats(s.frame),
    weeks: availableWeeks(s.frame),
    date_from: s.frame.dates[0] ?? null,
    date_to: s.frame.dates[s.frame.dates.length - 1] ?? null,
    site_name: s.settings.name,
    filename: s.filename,
  };
}

export const getDayProfile = async (
  id: string, from?: string, to?: string, excludeHolidays = true,
): Promise<DayProfileResponse> => dayOfWeekProfile(session(id).frame, from, to, excludeHolidays);

export const getLoadDuration = async (
  id: string, from?: string, to?: string,
): Promise<LoadDurationResponse> => loadDurationCurve(session(id).frame, from, to);

export const getDayNight = async (
  id: string, from?: string, to?: string, nightStart = 0, nightEnd = 14,
): Promise<DayNightResponse> => dayNightSplit(session(id).frame, from, to, nightStart, nightEnd);

export const getWeek = async (id: string, weekCommencing?: string): Promise<WeekResponse> =>
  weekProfile(session(id).frame, weekCommencing);

export const getScatter = async (id: string, excludeHolidays = true): Promise<ScatterResponse> =>
  fullYearScatter(session(id).frame, excludeHolidays);

export type ReportOptions = {
  date_from?: string; date_to?: string; exclude_holidays: boolean;
  night_end_slot: number; week_a?: string; week_b?: string;
};

/** Everything the site report needs, for the filters on screen. */
async function reportInput(sessionId: string, opts: ReportOptions) {
  const s = session(sessionId);
  const df = s.frame;
  const window = slice(df, opts.date_from, opts.date_to);
  if (!window.dates.length) throw new Error('No data falls inside the selected dates. Widen the range.');
  await yieldToUi();

  // The site's own settings win: the screen may hold a name from before a rename.
  const name = s.settings.name || 'Unnamed site';
  const whole = window.dates.length === df.dates.length;
  const input: AnalyserReportInput = {
    siteName: name,
    filename: s.filename,
    dateFrom: fmtDayMonYear(window.dates[0]),
    dateTo: fmtDayMonYear(window.dates[window.dates.length - 1]),
    summary: summaryStats(window),
    profile: dayOfWeekProfile(df, opts.date_from, opts.date_to, opts.exclude_holidays),
    ldc: loadDurationCurve(df, opts.date_from, opts.date_to),
    dayNight: dayNightSplit(df, opts.date_from, opts.date_to, 0, opts.night_end_slot),
    weekA: weekProfile(df, opts.week_a),
    weekB: opts.week_b ? weekProfile(df, opts.week_b) : null,
    // Fewer points for print, thinned by whole days.
    scatter: fullYearScatter(window, opts.exclude_holidays, 2400),
    excludeHolidays: opts.exclude_holidays,
    site: {
      metrics: analyseSite(window, s.settings, defaultRateP),
      settings: s.settings,
      carpet: carpetFor(window),
      quality: checkQuality(window),
      headroom: s.settings.capacityKva ? analyseHeadroom(window, {
        capacityKva: s.settings.capacityKva, powerFactor: s.settings.powerFactor,
        marginPct: s.settings.headroomMarginPct, test: s.settings.testLoad,
      }) : null,
      series: seriesFor(window),
    },
    filterNote: whole
      ? `Covers the whole uploaded period, ${window.dates.length} days.`
      : `Filtered to ${window.dates.length} days of the ${df.dates.length} uploaded.`,
  };
  return { input, name };
}

export async function downloadAnalyserReport(sessionId: string, siteName: string, opts: ReportOptions) {
  void siteName;
  const { input, name } = await reportInput(sessionId, opts);
  saveBlob(buildAnalyserReport(input), `${slug(name)}-hh-analysis.pdf`);
}

/** The same report as one PDF per chart, zipped so it arrives as one download. */
export async function downloadAnalyserChartsZip(sessionId: string, opts: ReportOptions) {
  const { input, name } = await reportInput(sessionId, opts);
  const files: Record<string, Uint8Array> = {};
  buildAnalyserSectionPdfs(input).forEach((section, k) => {
    files[`${String(k + 1).padStart(2, '0')}-${slug(name)}-${section.key}.pdf`] = new Uint8Array(section.pdf);
  });
  // PDFs are already compressed; storing them is faster and barely bigger.
  const zipped = zipSync(files, { level: 0 });
  saveBlob(zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer,
    `${slug(name)}-charts.zip`, 'application/zip');
}

// --- Portfolio ------------------------------------------------------------
// Used only by the standalone portfolio screen.

let defaultRateP = DEFAULT_RATE_P;

export const getDefaultRate = () => defaultRateP;

/** Back to an empty app with the house defaults, as if freshly opened. */
export function clearAll() {
  sessions.clear();
  defaultRateP = DEFAULT_RATE_P;
}
export function setDefaultRate(p: number) {
  if (Number.isFinite(p) && p > 0) defaultRateP = p;
}

export interface SiteSummary {
  id: string;
  filename: string;
  warnings: string[];
  settings: SiteSettings;
  frame: Frame;
  metrics: SiteMetrics;
  quality: QualityReport;
  /** Null until an agreed supply capacity is entered. */
  headroom: HeadroomResult | null;
}

// Quality depends only on the readings, so it is worked out once per file.
const qualityCache = new WeakMap<Frame, QualityReport>();
const qualityFor = (f: Frame) => {
  let q = qualityCache.get(f);
  if (!q) { q = checkQuality(f); qualityCache.set(f, q); }
  return q;
};

const headroomCache = new WeakMap<SiteSettings, HeadroomResult | null>();
export function headroomFor(frame: Frame, st: SiteSettings): HeadroomResult | null {
  if (headroomCache.has(st)) return headroomCache.get(st)!;
  const h = st.capacityKva && st.capacityKva > 0
    ? analyseHeadroom(frame, {
      capacityKva: st.capacityKva, powerFactor: st.powerFactor,
      marginPct: st.headroomMarginPct, test: st.testLoad,
    })
    : null;
  headroomCache.set(st, h);
  return h;
}

// Findings take ~30 ms a site. Recompute only when that site's settings or
// the default rate change, not for every site on every edit.
const metricsCache = new WeakMap<SiteSettings, { rate: number; metrics: SiteMetrics }>();

function metricsFor(s: Session): SiteMetrics {
  const hit = metricsCache.get(s.settings);
  if (hit && hit.rate === defaultRateP) return hit.metrics;
  const metrics = analyseSite(s.frame, s.settings, defaultRateP);
  metricsCache.set(s.settings, { rate: defaultRateP, metrics });
  return metrics;
}

export function listSites(): SiteSummary[] {
  return [...sessions.entries()].map(([id, s]) => ({
    id, filename: s.filename, warnings: s.warnings, settings: s.settings, frame: s.frame,
    metrics: metricsFor(s),
    quality: qualityFor(s.frame),
    headroom: headroomFor(s.frame, s.settings),
  }));
}

export function updateSiteSettings(id: string, settings: SiteSettings) {
  session(id).settings = settings;
}

function carpetFor(frame: Frame) {
  if (typeof document === 'undefined' || !frame.dates.length) return null;
  const canvas = document.createElement('canvas');
  const maxKw = drawCarpet(canvas, frame, 3, 6);
  return { canvas, maxKw, dates: frame.dates };
}

/** Whole-period charts for the PDF: every half hour, and daily totals. */
function seriesFor(frame: Frame) {
  if (typeof document === 'undefined' || !frame.dates.length) return null;
  const hh = document.createElement('canvas');
  const daily = document.createElement('canvas');
  drawTimeSeries(hh, frame, 'hh', 1100, 300, 2);
  drawTimeSeries(daily, frame, 'daily', 1100, 240, 2);
  return { hh, daily };
}

/** The portfolio's one-page site summary, for one site on its own. */
export async function downloadSiteSummary(id: string) {
  const s = listSites().find((x) => x.id === id);
  if (!s) throw new Error('That site is no longer loaded.');
  await yieldToUi();
  const pdf = buildSiteSummary({
    settings: s.settings, filename: s.filename, metrics: s.metrics, carpet: carpetFor(s.frame),
    quality: s.quality, headroom: s.headroom,
  });
  saveBlob(pdf, `${slug(s.settings.name)}-site-summary.pdf`);
}

export async function downloadPortfolioReport(title: string) {
  const sites = listSites();
  if (!sites.length) throw new Error('Load at least one site first.');
  await yieldToUi();
  const pdf = buildPortfolioReport(title || 'Portfolio', rankSites(sites).map((s) => ({
    settings: s.settings, filename: s.filename, metrics: s.metrics, carpet: carpetFor(s.frame),
    quality: s.quality, headroom: s.headroom,
  })));
  saveBlob(pdf, `${slug(title || 'portfolio')}-portfolio-review.pdf`);
}

export async function downloadExcel(title: string, ids?: string[]) {
  const sites = rankSites(listSites().filter((s) => !ids || ids.includes(s.id)));
  if (!sites.length) throw new Error('Load at least one site first.');
  await yieldToUi();
  const book = buildWorkbook(sites);
  saveBlob(book, `${slug(title || 'portfolio')}-hh-data.xlsx`,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}
