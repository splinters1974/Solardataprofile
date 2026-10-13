/**
 * Drop-in replacement for src/api/client.ts in the standalone build.
 *
 * Same exports, same shapes, but everything runs in the browser: the file
 * is parsed here, the maths runs here and the PDFs are drawn here. Nothing
 * about the site's data leaves the machine, and it makes no network calls.
 *
 * vite.config.ts swaps this in for api/client.ts when building with
 * `--mode standalone`, so the React screens do not know the difference.
 *
 * One calculation layer: each site's raw readings are turned into one
 * analysis frame (unit, duplicate choices and exclusions applied), and the
 * site screen, portfolio, charts, PDFs and spreadsheets all read from it and
 * from the one set of metrics worked out from it. Changing any setting
 * derives them again.
 */
import type {
  UploadResponse, SolarSizeResponse, SizingValues, AnalyserOverview,
  DayProfileResponse, LoadDurationResponse, DayNightResponse, WeekResponse,
  ScatterResponse,
} from '../types';
import { parseHHFile, regridLong, type LongSeries, type ParseInfo } from './parser';
import { calendarDays, deriveFrame, type Frame, type RawData } from './frame';
import {
  availableWeeks, dailySeries, dayNightSplit, dayOfWeekProfile, fullYearScatter,
  heatmapMatrix, hhSeries, loadDurationCurve, monthlyTotals, round, slice,
  summaryStats, weekProfile,
} from './analytics';
import { buildAnalyserReport, buildAnalyserSectionPdfs, type AnalyserReportInput } from './pdf/analyserReport';
import { zipSync } from 'fflate';
import { drawTimeSeries } from './timeseries';
import { getCustomerLogo, setCustomerLogo, type CustomerLogo } from './pdf/common';
import { editionHtml, readSealedEdition, seal, unseal, type EditionData } from './customerEdition';
import { buildPortfolioReport, buildSiteSummary, rankSites } from './pdf/portfolioReport';
import { fmtDayMonYear } from './dates';
import { analyseSite, pricesFor, type CarbonFactor, type SiteMetrics } from './findings';
import { DEFAULT_RATE_P, defaultSettings, type SiteSettings } from './site';
import { drawCarpet } from './carpet';
import { buildSitesTableWorkbook, buildWorkbook } from './excelExport';
import type { TableSite } from './siteTable';
import { checkQuality, type QualityReport } from './dataQuality';
import { analyseHeadroom, type HeadroomResult } from './headroom';
import { planDays } from './calendar';
import { newAction, sanitiseActions, type Action, type ActionStore, type Opportunity } from './actions';
import { runScenarios, type Scenario, type ScenarioRun } from './scenarios';
import {
  decodeProject, encodeProject, rawFromSerial, serialiseFrame, settingsFromSerial, type SerialSite,
} from './project';

const ACCEPTED_EXTENSIONS = ['.xlsx', '.xlsm', '.xls', '.csv', '.txt'];

interface Session {
  raw: RawData;
  info: ParseInfo;
  long?: LongSeries;
  filename: string;
  warnings: string[];
  format: 'A' | 'B';
  settings: SiteSettings;
  actions: ActionStore;
  scenarios: Scenario[];
  /** Fingerprint of the readings, to stop the same file being loaded twice. */
  fingerprint: string;
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

function fingerprintOf(f: Frame): string {
  let h = 2166136261;
  const mix = (x: number) => { h ^= x; h = Math.imul(h, 16777619) >>> 0; };
  f.dates.forEach((d, i) => {
    for (let k = 0; k < d.length; k++) mix(d.charCodeAt(k));
    mix(Math.round(f.rows[i].reduce((a, b) => a + b, 0) * 1000) | 0);
  });
  return `${f.dates.length}:${h.toString(16)}`;
}

// --- Portfolio state ---------------------------------------------------------------

let defaultRateP = DEFAULT_RATE_P;
let carbon: CarbonFactor | null = null;
let portfolioTitle = '';
/** True once a customer edition has been unlocked: summary-only exports. */
let customerMode = false;
let editionIncludesNotes = false;

export const getDefaultRate = () => defaultRateP;
export const getCarbon = () => carbon;
export const getTitle = () => portfolioTitle;
export const isCustomerMode = () => customerMode;
export const editionShowsNotes = () => editionIncludesNotes;

export function setDefaultRate(p: number) {
  if (Number.isFinite(p) && p > 0) defaultRateP = p;
}
export function setCarbon(c: CarbonFactor | null) {
  carbon = c && Number.isFinite(c.kgPerKwh) && c.kgPerKwh > 0 ? c : null;
}
export function setTitle(t: string) { portfolioTitle = t; }

// --- The analysis pipeline ------------------------------------------------------------

interface Derived { key: string; frame: Frame; quality: QualityReport }
const derivedCache = new WeakMap<Session, Derived>();
const regridCache = new WeakMap<Session, { convention: string; raw: RawData }>();

/** Raw data, re-read with a different time convention when the engineer has changed it. */
function rawFor(s: Session): RawData {
  const want = s.settings.convention;
  if (!s.long || !want || want === s.info.convention) return s.raw;
  const hit = regridCache.get(s);
  if (hit && hit.convention === want) return hit.raw;
  const g = regridLong(s.long, want);
  const raw: RawData = { frame: { dates: g.dates, rows: g.rows, flags: g.flags, dstExtraKwh: g.dstExtraKwh }, unit: s.raw.unit, conflicts: g.conflicts };
  regridCache.set(s, { convention: want, raw });
  return raw;
}

function derived(s: Session): Derived {
  const st = s.settings;
  const key = JSON.stringify([st.unit, st.review, st.convention, st.meterType]);
  const hit = derivedCache.get(s);
  if (hit && hit.key === key) return hit;
  const frame = deriveFrame(rawFor(s), st.unit, st.review);
  const quality = checkQuality(frame, { meterType: st.meterType, reviewedOk: st.review.reviewedOk });
  const d = { key, frame, quality };
  derivedCache.set(s, d);
  return d;
}

/** The analysis frame for a site: what every chart and figure is worked out from. */
export const analysisFrame = (id: string) => derived(session(id)).frame;

const metricsCache = new WeakMap<SiteSettings, { key: string; metrics: SiteMetrics }>();

function metricsFor(s: Session): SiteMetrics {
  const d = derived(s);
  const key = `${d.key}|${defaultRateP}|${JSON.stringify(carbon)}`;
  const hit = metricsCache.get(s.settings);
  if (hit && hit.key === key) return hit.metrics;
  const metrics = analyseSite({ frame: d.frame, settings: s.settings, defaultRateP, quality: d.quality, carbon });
  metricsCache.set(s.settings, { key, metrics });
  return metrics;
}

const headroomCache = new WeakMap<SiteSettings, { frame: Frame; h: HeadroomResult | null }>();
function headroomFor(frame: Frame, st: SiteSettings): HeadroomResult | null {
  const hit = headroomCache.get(st);
  if (hit && hit.frame === frame) return hit.h;
  const h = st.capacityKva && st.capacityKva > 0
    ? analyseHeadroom(frame, {
      capacityKva: st.capacityKva, powerFactor: st.powerFactor,
      marginPct: st.headroomMarginPct, test: st.testLoad,
    })
    : null;
  headroomCache.set(st, { frame, h });
  return h;
}

const scenarioCache = new WeakMap<Scenario[], { key: string; run: ScenarioRun }>();

export function scenarioRunFor(id: string): ScenarioRun {
  const s = session(id);
  const d = derived(s);
  const m = metricsFor(s);
  const key = `${d.key}|${defaultRateP}|${JSON.stringify(s.settings.calendar)}|${JSON.stringify(s.settings.tariff)}|${s.settings.rateP}|${JSON.stringify(carbon)}|${m.annualisation.factor}`;
  const hit = scenarioCache.get(s.scenarios);
  if (hit && hit.key === key) return hit.run;
  const run = runScenarios({
    frame: d.frame,
    plans: planDays(s.settings.calendar, d.frame.dates),
    prices: pricesFor(d.frame, s.settings, defaultRateP),
    refs: { all: m.baseAll.kw, closed: m.baseClosed?.kw ?? null },
    annualFactor: m.annualisation.factor,
    carbon,
  }, s.scenarios);
  scenarioCache.set(s.scenarios, { key, run });
  return run;
}

export interface SiteSummary {
  id: string;
  filename: string;
  warnings: string[];
  info: ParseInfo;
  settings: SiteSettings;
  /** The analysis frame (review applied). */
  frame: Frame;
  /** Changes whenever the analysis frame is derived again. */
  frameKey: string;
  metrics: SiteMetrics;
  quality: QualityReport;
  /** Null until an agreed supply capacity is entered. */
  headroom: HeadroomResult | null;
  actions: ActionStore;
  scenarios: Scenario[];
  /** Second rows for conflicting duplicate dates, for the review tab. */
  conflicts: RawData['conflicts'];
  hasLong: boolean;
}

export function listSites(): SiteSummary[] {
  return [...sessions.entries()].map(([id, s]) => {
    const d = derived(s);
    return {
      id, filename: s.filename, warnings: s.warnings, info: s.info, settings: s.settings,
      frame: d.frame, frameKey: d.key,
      metrics: metricsFor(s),
      quality: d.quality,
      headroom: headroomFor(d.frame, s.settings),
      actions: s.actions,
      scenarios: s.scenarios,
      conflicts: rawFor(s).conflicts,
      hasLong: !!s.long,
    };
  });
}

export function updateSiteSettings(id: string, settings: SiteSettings) {
  session(id).settings = settings;
}

export function updateAction(id: string, key: string, patch: Partial<Action>) {
  const s = session(id);
  const cur = s.actions[key] ?? newAction();
  s.actions = { ...s.actions, [key]: { ...cur, ...patch, updated: new Date().toISOString().slice(0, 10) } };
}

export function updateScenarios(id: string, scenarios: Scenario[]) {
  session(id).scenarios = scenarios;
}

/** Every finding on every site as an opportunity record, with its action. */
export function listOpportunities(sites = listSites()): Opportunity[] {
  return sites.flatMap((s) => s.metrics.findings.map((f) => ({
    siteId: s.id, siteName: s.settings.name, meterId: s.settings.meterId,
    finding: f, action: s.actions[f.key] ?? newAction(),
  })));
}

// --- Upload ----------------------------------------------------------------------

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

  const parsed = parseHHFile(bytes, name);
  const fingerprint = fingerprintOf(parsed.raw.frame);
  for (const other of sessions.values()) {
    if (other.fingerprint === fingerprint) {
      throw new Error(`These readings are already loaded as "${other.settings.name}". Not added again, so portfolio totals are not doubled.`);
    }
  }
  const warnings = [...parsed.warnings];
  const { frame } = parsed.raw;
  const from = frame.dates[0];
  const to = frame.dates[frame.dates.length - 1];
  if (parsed.info.meterId) {
    for (const other of sessions.values()) {
      const of = other.raw.frame;
      if (other.settings.meterId === parsed.info.meterId && of.dates[0] <= to && of.dates[of.dates.length - 1] >= from) {
        warnings.push(`Same meter reference (${parsed.info.meterId}) as "${other.settings.name}", with overlapping dates. `
          + 'Portfolio totals would count both: remove one, or set one as a submeter in the site settings.');
      }
    }
  }
  const id = newId();
  const siteName = name.replace(/\.(xlsx|xlsm|xls|csv|txt)$/i, '');
  const settings = { ...defaultSettings(siteName), unit: parsed.info.unit, meterId: parsed.info.meterId };
  sessions.set(id, {
    raw: parsed.raw, info: parsed.info, long: parsed.long, filename: name, warnings, format: parsed.format,
    settings, actions: {}, scenarios: [], fingerprint,
  });

  const f = analysisFrame(id);
  const total = f.rows.reduce((s, r) => s + r.reduce((a, b) => a + b, 0), 0);
  return {
    session_id: id,
    detected_format: parsed.format,
    days_parsed: f.dates.length,
    date_from: from,
    date_to: to,
    annual_kwh: round(total, 1),
    filename: name,
    monthly_totals: monthlyTotals(f),
    heatmap: heatmapMatrix(f),
    daily_series: dailySeries(f),
    hh_series: hhSeries(f),
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

function saveBlob(bytes: ArrayBuffer | Uint8Array, filename: string, type = 'application/pdf') {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
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

// --- HH Analyser (the explorer charts) ------------------------------------------------

export async function getAnalyserOverview(sessionId: string): Promise<AnalyserOverview> {
  const s = session(sessionId);
  const f = analysisFrame(sessionId);
  return {
    summary: summaryStats(f),
    weeks: availableWeeks(f),
    date_from: f.dates[0] ?? null,
    date_to: f.dates[f.dates.length - 1] ?? null,
    site_name: s.settings.name,
    filename: s.filename,
  };
}

export const getDayProfile = async (
  id: string, from?: string, to?: string, excludeHolidays = true,
): Promise<DayProfileResponse> => dayOfWeekProfile(analysisFrame(id), from, to, excludeHolidays);

export const getLoadDuration = async (
  id: string, from?: string, to?: string,
): Promise<LoadDurationResponse> => loadDurationCurve(analysisFrame(id), from, to);

export const getDayNight = async (
  id: string, from?: string, to?: string, nightStart = 0, nightEnd = 14,
): Promise<DayNightResponse> => dayNightSplit(analysisFrame(id), from, to, nightStart, nightEnd);

export const getWeek = async (id: string, weekCommencing?: string): Promise<WeekResponse> =>
  weekProfile(analysisFrame(id), weekCommencing);

export const getScatter = async (id: string, excludeHolidays = true): Promise<ScatterResponse> =>
  fullYearScatter(analysisFrame(id), excludeHolidays);

export type ReportOptions = {
  date_from?: string; date_to?: string; exclude_holidays: boolean;
  night_end_slot: number; week_a?: string; week_b?: string;
};

function carpetFor(s: SiteSummary | { frame: Frame; settings: SiteSettings }) {
  if (typeof document === 'undefined' || !s.frame.dates.length) return null;
  const canvas = document.createElement('canvas');
  const maxKw = drawCarpet(canvas, s.frame, 3, 6, { calendar: s.settings.calendar, overlay: false });
  return { canvas, maxKw, dates: calendarDays(s.frame).map((d) => d.date) };
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

/** Everything a site's PDFs need: the site as on screen, its scenarios and pictures. */
export function siteReportData(id: string) {
  const s = listSites().find((x) => x.id === id);
  if (!s) throw new Error('That site is no longer loaded.');
  return { site: s, scenarioRun: s.scenarios.some((x) => x.enabled) ? scenarioRunFor(id) : null, carpet: carpetFor(s), carbon };
}

/** Everything the explorer report needs, for the filters on screen. */
async function reportInput(sessionId: string, opts: ReportOptions) {
  const df = analysisFrame(sessionId);
  const window = slice(df, opts.date_from, opts.date_to);
  if (!window.dates.length) throw new Error('No data falls inside the selected dates. Widen the range.');
  await yieldToUi();
  const data = siteReportData(sessionId);
  const name = data.site.settings.name || 'Unnamed site';
  const whole = window.dates.length === df.dates.length;
  const input: AnalyserReportInput = {
    siteName: name,
    filename: data.site.filename,
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
      // Findings and headroom always use the full record, as on the site screen.
      summary: data.site,
      scenarioRun: data.scenarioRun,
      carbon: data.carbon,
      carpet: data.carpet,
      series: seriesFor(df),
    },
    filterNote: whole
      ? `Charts cover the whole uploaded period, ${window.dates.length} days. Findings use the full record.`
      : `Explorer charts filtered to ${window.dates.length} of ${df.dates.length} days (${fmtDayMonYear(window.dates[0])} to `
        + `${fmtDayMonYear(window.dates[window.dates.length - 1])}). Findings, costs and headroom use the full record.`,
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
  saveBlob(zipped, `${slug(name)}-charts.zip`, 'application/zip');
}

// --- Portfolio --------------------------------------------------------------------

/** Back to an empty app with the house defaults, as if freshly opened. */
export function clearAll() {
  sessions.clear();
  defaultRateP = DEFAULT_RATE_P;
  carbon = null;
  portfolioTitle = '';
  setCustomerLogo(null);
}

/**
 * Read a customer's logo file and convert it to PNG for the PDFs. Going
 * through a canvas means SVG, WebP, GIF and the rest all work, transparency
 * is kept, and an oversized file is scaled down so the PDFs stay small.
 */
export async function loadCustomerLogo(file: File): Promise<CustomerLogo> {
  if (!file.type.startsWith('image/')) throw new Error('Choose an image file (PNG, JPG or SVG).');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('That image could not be read. Try a PNG or JPG.'));
      el.src = url;
    });
    const w0 = img.naturalWidth || 600;
    const h0 = img.naturalHeight || 200;
    const scale = Math.min(1, 800 / w0, 400 / h0);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w0 * scale));
    canvas.height = Math.max(1, Math.round(h0 * scale));
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    const logo = { dataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height };
    setCustomerLogo(logo);
    return logo;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function removeCustomerLogo() {
  setCustomerLogo(null);
}

/** Sites counted in portfolio totals: submeters are left out so they are not double counted. */
export const countedInTotals = (s: SiteSummary) => s.settings.role !== 'sub';

/** The one-page site summary. */
export async function downloadSiteSummary(id: string) {
  await yieldToUi();
  const data = siteReportData(id);
  saveBlob(buildSiteSummary(data), `${slug(data.site.settings.name)}-site-summary.pdf`);
}

export async function downloadPortfolioReport(title: string) {
  const sites = listSites();
  if (!sites.length) throw new Error('Load at least one site first.');
  await yieldToUi();
  const ranked = rankSites(sites);
  const pdf = buildPortfolioReport(title || 'Portfolio', ranked.map((s) => ({
    site: s, scenarioRun: s.scenarios.some((x) => x.enabled) ? scenarioRunFor(s.id) : null,
    carpet: carpetFor(s), carbon,
  })), listOpportunities(ranked), { includeNotes: !customerMode || editionIncludesNotes });
  saveBlob(pdf, title ? `${slug(title)}-portfolio-review.pdf` : 'portfolio-review.pdf');
}

export async function downloadExcel(title: string, ids?: string[]) {
  const sites = rankSites(listSites().filter((s) => !ids || ids.includes(s.id)));
  if (!sites.length) throw new Error('Load at least one site first.');
  await yieldToUi();
  const book = buildWorkbook(sites.map((s) => ({
    site: s, scenarioRun: s.scenarios.some((x) => x.enabled) ? scenarioRunFor(s.id) : null,
  })), {
    halfHourly: !customerMode,
    includeNotes: !customerMode || editionIncludesNotes,
    carbon, defaultRateP, title,
  });
  saveBlob(book, `${slug(title || 'portfolio')}-${customerMode ? 'summary' : 'hh-data'}.xlsx`,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}

/** The sites table as shown, in the order shown, as a one-sheet workbook. */
export async function downloadSitesTable(title: string, sites: TableSite[]) {
  if (!sites.length) throw new Error('Load at least one site first.');
  await yieldToUi();
  saveBlob(buildSitesTableWorkbook(title, sites, defaultRateP), `${slug(title || 'portfolio')}-sites.xlsx`,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}

// --- Serialising sites: projects and editions -------------------------------------------

function serialSite(s: Session, internal: boolean, includeNotes: boolean): SerialSite {
  return {
    filename: s.filename, warnings: s.warnings, format: s.format, info: s.info, settings: s.settings,
    unit: s.raw.unit, ...serialiseFrame(s.raw.frame), conflicts: s.raw.conflicts,
    long: internal ? s.long : undefined,
    actions: sanitiseActions(s.actions, includeNotes),
    scenarios: s.scenarios,
  };
}

function loadSerialSites(list: SerialSite[]) {
  sessions.clear();
  for (const site of list) {
    const raw = rawFromSerial(site);
    const settings = settingsFromSerial(site);
    const info: ParseInfo = site.info ?? {
      layout: 'day-rows', meterId: settings.meterId, unit: raw.unit, unitEvidence: '',
      convention: 'start', conventionEvidence: '', clockNote: '',
    };
    sessions.set(newId(), {
      raw, info, long: site.long, filename: site.filename, warnings: site.warnings, format: site.format,
      settings, actions: site.actions ?? {}, scenarios: site.scenarios ?? [], fingerprint: fingerprintOf(raw.frame),
    });
  }
}

/** Save everything, raw readings included, as a project file to carry on later. */
export async function saveProject() {
  if (!sessions.size) throw new Error('Load at least one site first.');
  await yieldToUi();
  const bytes = encodeProject({
    title: portfolioTitle, defaultRateP, carbon, customerLogo: getCustomerLogo(),
    sites: [...sessions.values()].map((s) => serialSite(s, true, true)),
  });
  const stamp = new Date().toISOString().slice(0, 10);
  saveBlob(bytes, `${slug(portfolioTitle || 'data-analyser')}-${stamp}.adproject`, 'application/octet-stream');
}

/** Open a project file, replacing what is loaded. */
export async function openProject(file: File): Promise<{ title: string; sites: number }> {
  const p = decodeProject(new Uint8Array(await file.arrayBuffer()));
  await yieldToUi();
  loadSerialSites(p.sites);
  defaultRateP = p.defaultRateP || DEFAULT_RATE_P;
  carbon = p.carbon ?? null;
  portfolioTitle = p.title ?? '';
  setCustomerLogo(p.customerLogo ?? null);
  return { title: portfolioTitle, sites: p.sites.length };
}

// --- Customer editions -----------------------------------------------------

/** Seal the loaded sites into a password-protected copy of this app and download it. */
export async function downloadCustomerEdition(customer: string, password: string, opts: { includeNotes?: boolean } = {}) {
  if (!sessions.size) throw new Error('Load the customer\'s sites first.');
  if (!customer.trim()) throw new Error('Enter the customer name.');
  if (password.length < 8) throw new Error('Use a password of at least 8 characters.');
  await yieldToUi();
  const data: EditionData = {
    customer: customer.trim(),
    createdAt: new Date().toISOString().slice(0, 10),
    defaultRateP,
    customerLogo: getCustomerLogo(),
    carbon,
    includesInternalNotes: !!opts.includeNotes,
    sites: [...sessions.values()].map((x) => serialSite(x, false, !!opts.includeNotes)),
  };
  const html = editionHtml(await seal(data, password));
  saveBlob(new TextEncoder().encode(html), `${slug(customer)}-energy-dashboard.html`, 'text/html');
}

/** Unlock the sealed data in a customer edition and load its sites. */
export async function openCustomerEdition(password: string): Promise<EditionData> {
  const sealed = readSealedEdition();
  if (!sealed) throw new Error('This file has no customer data in it.');
  const data = await unseal(sealed, password);
  loadSerialSites(data.sites);
  defaultRateP = data.defaultRateP;
  carbon = data.carbon ?? null;
  portfolioTitle = data.customer;
  setCustomerLogo(data.customerLogo);
  customerMode = true;
  editionIncludesNotes = !!data.includesInternalNotes;
  return data;
}
