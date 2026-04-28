import axios from 'axios';
import type { UploadResponse, SolarSizeResponse } from '../types';

// In dev: Vite proxies /api → localhost:8000
// In production: set VITE_API_URL to your deployed backend URL (e.g. https://your-app.onrender.com)
const API_BASE = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL}/api`
  : '/api';

const api = axios.create({ baseURL: API_BASE });

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
