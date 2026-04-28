export interface MonthlyTotal {
  month: string;
  kwh: number;
}

export interface HeatmapData {
  dow_labels: string[];
  hh_labels: string[];
  matrix: number[][];
}

export interface UploadResponse {
  session_id: string;
  detected_format: string;
  days_parsed: number;
  annual_kwh: number;
  monthly_totals: MonthlyTotal[];
  heatmap: HeatmapData;
  warnings: string[];
}

export interface MonthlySolarPoint {
  month: string;
  generation_kwh: number;
  consumption_kwh: number;
  self_consumed_kwh: number;
  exported_kwh: number;
}

export interface SizingCurvePoint {
  kwp: number;
  sc_rate: number;
  annual_generation_kwh: number;
  exported_kwh: number;
  summer_export_kwh: number;
}

export interface SolarSizeResponse {
  recommended_kwp: number;
  sc_rate: number;
  annual_generation_kwh: number;
  self_consumed_kwh: number;
  exported_kwh: number;
  summer_export_kwh: number;
  location: { lat: number; lon: number; postcode: string };
  monthly_chart: MonthlySolarPoint[];
  sizing_curve: SizingCurvePoint[];
  warning?: string;
}
