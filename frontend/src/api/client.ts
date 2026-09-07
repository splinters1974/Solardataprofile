import axios, { AxiosError } from 'axios';
import type { UploadResponse, SolarSizeResponse, SizingValues } from '../types';

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
  return data;
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

