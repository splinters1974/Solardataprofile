import axios, { AxiosError } from 'axios';
import type { UploadResponse, SolarSizeResponse } from '../types';

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

export async function sizeSystem(payload: {
  session_id: string;
  postcode: string;
  target_sc_min: number;
  target_sc_max: number;
  roof_tilt: number;
  roof_aspect: number;
}): Promise<SolarSizeResponse> {
  const { data } = await api.post<SolarSizeResponse>('/solar/size', payload);
  return data;
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

