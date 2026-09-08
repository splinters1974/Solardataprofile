import axios, { AxiosError } from 'axios';
import type {
  UploadResponse, SolarSizeResponse, SizingValues,
  AnalyserOverview, DayProfileResponse, LoadDurationResponse,
  DayNightResponse, WeekResponse, ScatterResponse,
} from '../types';
import { rememberUpload, recallUpload, forgetUpload } from './sessionCache';

const API_BASE = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL}/api`
  : '/api';

const HEALTH_URL = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL}/healthz`
  : '/healthz';

const api = axios.create({
  baseURL: API_BASE,
  timeout: 120_000, // 2 min — covers Render cold start (~30s) + PVGIS call (~30s)
});

// Ping /healthz to wake the Render backend. Retries up to 3 times with
// increasing timeouts to handle Render free-tier cold starts (~50–70 s).
export async function warmupBackend(): Promise<boolean> {
  const attempts = [90_000, 60_000, 30_000]; // ms per attempt
  for (const timeout of attempts) {
    try {
      await axios.get(HEALTH_URL, { timeout });
      return true;
    } catch {
      // continue to next attempt
    }
  }
  return false;
}

export async function uploadHHFile(file: File): Promise<UploadResponse> {
  const form = new FormData();
  form.append('file', file);
  const { data } = await api.post<UploadResponse>('/upload', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  await rememberUpload(file, data.session_id);
  return data;
}

/** Tell the server to forget an upload. Best effort: the UI resets either way. */
export async function forgetSession(sessionId: string): Promise<void> {
  try {
    await api.delete(`/session/${sessionId}`, { timeout: 15_000 });
  } catch {
    // The session may already be gone, or the server asleep. Either way the
    // user asked to start again, and the local reset is what they will see.
  }
  await forgetUpload();
}

function isMissingSession(e: unknown): boolean {
  const err = e as AxiosError<{ detail?: string }>;
  return (
    err.response?.status === 404 &&
    (err.response?.data?.detail ?? '').toLowerCase().includes('session')
  );
}

/**
 * Run a request; if the server has forgotten the session, re-upload the
 * cached file and try once more with the new session id.
 *
 * Render's free tier drops the instance (and its disk) when it sleeps, so a
 * session going missing is routine rather than exceptional. The user should
 * not have to go and find their spreadsheet again because of it.
 */
export async function withSessionRecovery<T>(
  sessionId: string,
  run: (id: string) => Promise<T>,
  onNewSession: (upload: UploadResponse) => void,
): Promise<T> {
  try {
    return await run(sessionId);
  } catch (e) {
    if (!isMissingSession(e)) throw e;

    const file = await recallUpload(sessionId);
    if (!file) throw e;

    const upload = await uploadHHFile(file);
    onNewSession(upload);
    return await run(upload.session_id);
  }
}

export async function sizeSystem(
  payload: SizingValues & { session_id: string },
): Promise<SolarSizeResponse> {
  const { data } = await api.post<SolarSizeResponse>('/solar/size', payload);
  return data;
}

// The PDF is built server-side so the report and the on-screen numbers can
// never drift apart.
export async function downloadReport(sessionId: string, siteName: string) {
  const { data } = await api.get('/report/pdf', {
    params: { session_id: sessionId },
    responseType: 'blob',
  });

  const slug = (siteName || 'site').replace(/[^a-zA-Z0-9 _-]/g, '').trim()
    .replace(/\s+/g, '-') || 'site';
  const url = URL.createObjectURL(new Blob([data], { type: 'application/pdf' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${slug}-solar-appraisal.pdf`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function friendlyError(e: unknown, fallback: string): string {
  const err = e as AxiosError<{ detail?: string }>;
  if (err.response?.data?.detail) return err.response.data.detail;
  if (err.code === 'ECONNABORTED' || err.message?.includes('timeout')) {
    return 'Request timed out — the server may be waking up. Please try again in 30 seconds.';
  }
  if (!err.response) {
    return 'Could not reach the server. Please try again in a moment — it may be starting up.';
  }
  return fallback;
}

// --- Ameresco HH Analyser --------------------------------------------------

type Params = Record<string, string | number | boolean | undefined>;

async function analyserGet<T>(path: string, params: Params): Promise<T> {
  const { data } = await api.get<T>(`/analyser/${path}`, { params });
  return data;
}

export const getAnalyserOverview = (session_id: string) =>
  analyserGet<AnalyserOverview>('overview', { session_id });

export const getDayProfile = (
  session_id: string, date_from?: string, date_to?: string,
  exclude_holidays = true,
) => analyserGet<DayProfileResponse>('day-profile',
  { session_id, date_from, date_to, exclude_holidays });

export const getLoadDuration = (
  session_id: string, date_from?: string, date_to?: string,
) => analyserGet<LoadDurationResponse>('load-duration',
  { session_id, date_from, date_to });

export const getDayNight = (
  session_id: string, date_from?: string, date_to?: string,
  night_start_slot = 0, night_end_slot = 14,
) => analyserGet<DayNightResponse>('day-night',
  { session_id, date_from, date_to, night_start_slot, night_end_slot });

export const getWeek = (session_id: string, week_commencing?: string) =>
  analyserGet<WeekResponse>('week', { session_id, week_commencing });

export const getScatter = (session_id: string, exclude_holidays = true) =>
  analyserGet<ScatterResponse>('scatter', { session_id, exclude_holidays });
