/**
 * Drop-in replacement for src/api/client.ts in the standalone build.
 *
 * Same exports, same shapes, but everything runs in the browser: the file
 * is parsed here, the maths runs here and the PDFs are drawn here. Nothing
 * about the site's data leaves the machine. The only network calls are the
 * postcode lookup and PVGIS, and both have an offline fallback.
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
import { recommendSystemSize, type SizingResult } from './sizing';
import { getGeneration, locate, type Generation } from './irradiance';
import { buildAnalyserReport } from './pdf/analyserReport';
import { buildSolarReport } from './pdf/solarReport';
import { fmtDayMonYear } from './dates';

const ACCEPTED_EXTENSIONS = ['.xlsx', '.xlsm', '.xls', '.csv', '.txt'];

interface Session {
  frame: Frame;
  filename: string;
  warnings: string[];
  format: 'A' | 'B';
  siteName: string;
  last?: {
    values: SizingValues;
    sizing: SizingResult;
    generation: Generation;
    response: SolarSizeResponse;
  };
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
  sessions.clear(); // one site at a time, as on the server
  sessions.set(id, { frame, filename: name, warnings, format, siteName: '' });

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

export async function sizeSystem(
  payload: SizingValues & { session_id: string },
): Promise<SolarSizeResponse> {
  const s = session(payload.session_id);
  if (payload.target_sc_min > payload.target_sc_max) {
    throw new Error('Minimum self-consumption cannot be higher than the maximum.');
  }
  const { lat, lon } = await locate(payload.postcode);
  const generation = await getGeneration(lat, lon, payload.roof_tilt, payload.roof_aspect);
  await yieldToUi();

  const sizing = recommendSystemSize(
    s.frame, generation.profile, payload.target_sc_min, payload.target_sc_max,
    payload.assumptions,
  );
  const strip = (r: SizingResult['best']) => {
    const point: Partial<SizingResult['best']> = { ...r };
    delete point.economics;
    return point as Omit<SizingResult['best'], 'economics'>;
  };
  const best = sizing.best;

  const response: SolarSizeResponse = {
    recommended_kwp: best.kwp,
    sc_rate: best.sc_rate,
    offset_rate: best.offset_rate,
    annual_consumption_kwh: sizing.annualConsumptionKwh,
    annual_generation_kwh: best.annual_generation_kwh,
    self_consumed_kwh: best.self_consumed_kwh,
    exported_kwh: best.exported_kwh,
    summer_export_kwh: best.summer_export_kwh,
    days_analysed: sizing.days,
    economics: best.economics,
    location: { lat, lon, postcode: payload.postcode.toUpperCase() },
    monthly_chart: sizing.monthly,
    sizing_curve: sizing.curve.map(strip),
    alternative_max_onsite: sizing.alternative ? strip(sizing.alternative) : null,
    warning: sizing.warning ?? undefined,
    irradiance_source: generation.source,
    irradiance_label: generation.label,
  };

  if (payload.site_name) s.siteName = payload.site_name;
  s.last = { values: payload, sizing, generation, response };
  return response;
}

function saveBlob(bytes: ArrayBuffer, filename: string) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
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

export async function downloadReport(sessionId: string, siteName: string) {
  const s = session(sessionId);
  if (!s.last) throw new Error('Run the sizing first — there is nothing to report on yet.');
  await yieldToUi();
  const name = siteName || s.siteName || 'Unnamed site';
  const pdf = buildSolarReport({
    siteName: name,
    postcode: s.last.values.postcode.toUpperCase(),
    dateFrom: fmtDayMonYear(s.frame.dates[0]),
    dateTo: fmtDayMonYear(s.frame.dates[s.frame.dates.length - 1]),
    result: s.last.response,
    values: s.last.values,
    irradianceLabel: s.last.generation.label,
    estimated: s.last.generation.source === 'estimate',
    dataWarnings: s.warnings,
  });
  saveBlob(pdf, `${slug(name)}-solar-appraisal.pdf`);
}

// --- HH Analyser ----------------------------------------------------------

export async function getAnalyserOverview(sessionId: string): Promise<AnalyserOverview> {
  const s = session(sessionId);
  return {
    summary: summaryStats(s.frame),
    weeks: availableWeeks(s.frame),
    date_from: s.frame.dates[0] ?? null,
    date_to: s.frame.dates[s.frame.dates.length - 1] ?? null,
    site_name: s.siteName,
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

export async function downloadAnalyserReport(
  sessionId: string,
  siteName: string,
  opts: {
    date_from?: string; date_to?: string; exclude_holidays: boolean;
    night_end_slot: number; week_a?: string; week_b?: string;
  },
) {
  const s = session(sessionId);
  const df = s.frame;
  const window = slice(df, opts.date_from, opts.date_to);
  if (!window.dates.length) throw new Error('No data falls inside the selected dates. Widen the range.');
  await yieldToUi();

  const name = (siteName || s.siteName || s.filename || 'Unnamed site')
    .replace(/\.(xlsx|xlsm|xls|csv|txt)$/i, '');
  const whole = window.dates.length === df.dates.length;
  const pdf = buildAnalyserReport({
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
    filterNote: whole
      ? `Covers the whole uploaded period, ${window.dates.length} days.`
      : `Filtered to ${window.dates.length} days of the ${df.dates.length} uploaded.`,
  });
  saveBlob(pdf, `${slug(name)}-hh-analysis.pdf`);
}
