export interface MonthlyTotal {
  month: string;
  kwh: number;
}

export interface HeatmapData {
  dow_labels: string[];
  hh_labels: string[];
  matrix: number[][];
}

export interface DailyPoint {
  date: string;  // "2024-01-01"
  kwh: number;
}

export interface HHPoint {
  datetime: string;  // "2024-01-01T00:00"
  kwh: number;
}

export interface UploadResponse {
  session_id: string;
  detected_format: string;
  days_parsed: number;
  annual_kwh: number;
  filename: string;
  date_from?: string;
  date_to?: string;
  monthly_totals: MonthlyTotal[];
  heatmap: HeatmapData;
  daily_series: DailyPoint[];
  hh_series: HHPoint[];
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
  offset_rate: number;
  annual_generation_kwh: number;
  self_consumed_kwh: number;
  exported_kwh: number;
  summer_export_kwh: number;
  capex: number;
  year_one_saving: number;
  simple_payback_years: number | null;
  npv: number;
  irr: number | null;
}

export interface Economics {
  capex: number;
  capex_per_kwp: number;
  year_one_saving: number;
  year_one_import_saving: number;
  year_one_export_income: number;
  annual_opex: number;
  lifetime_saving: number;
  npv: number;
  irr: number | null;
  simple_payback_years: number | null;
  discounted_payback_years: number | null;
  lcoe_p_kwh: number | null;
  carbon_saved_tonnes_year: number;
  cashflow: number[];
}

export interface EconomicAssumptions {
  import_price_p_kwh: number;
  export_price_p_kwh: number;
  capex_per_kwp: number;
  opex_per_kwp_year: number;
  import_price_inflation: number;
  export_price_inflation: number;
  opex_inflation: number;
  discount_rate: number;
  system_life_years: number;
  degradation_rate: number;
  carbon_factor: number;
}

export interface SolarSizeResponse {
  recommended_kwp: number;
  sc_rate: number;
  offset_rate: number;
  annual_consumption_kwh: number;
  annual_generation_kwh: number;
  self_consumed_kwh: number;
  exported_kwh: number;
  summer_export_kwh: number;
  days_analysed: number;
  economics: Economics;
  location: { lat: number; lon: number; postcode: string };
  monthly_chart: MonthlySolarPoint[];
  sizing_curve: SizingCurvePoint[];
  alternative_max_onsite?: SizingCurvePoint | null;
  warning?: string;
}

export interface SizingValues {
  postcode: string;
  site_name: string;
  target_sc_min: number;
  target_sc_max: number;
  roof_tilt: number;
  roof_aspect: number;
  assumptions: EconomicAssumptions;
}

// ---------------------------------------------------------------------------
// Ameresco HH Analyser
// ---------------------------------------------------------------------------

export interface AnalyserSummary {
  days: number;
  total_kwh: number;
  peak_kw: number;
  peak_when: string;
  average_kw: number;
  base_kw: number;
  load_factor: number;
  highest_day_kwh: number;
  highest_day: string;
  lowest_day_kwh: number;
  lowest_day: string;
  average_day_kwh: number;
}

export interface WeekOption {
  value: string;
  label: string;
}

export interface AnalyserOverview {
  summary: AnalyserSummary;
  weeks: WeekOption[];
  date_from: string | null;
  date_to: string | null;
  site_name: string;
  filename: string;
}

export interface ProfileSeries {
  name: string;
  group: 'day' | 'summary';
  values: number[];
}

export interface DayProfileResponse {
  labels: string[];
  series: ProfileSeries[];
  day_counts: Record<string, number>;
}

export interface LoadDurationPoint {
  hours: number;
  kw: number;
}

export interface LoadDurationResponse {
  curve: LoadDurationPoint[];
  peak_kw: number;
  base_kw: number;
  average_kw: number;
  load_factor: number;
  hours_covered: number;
}

export interface DayNightMonth {
  month: string;
  day_kwh: number;
  night_kwh: number;
  days: number;
  complete: boolean;
}

export interface DayNightResponse {
  months: DayNightMonth[];
  night_window: string;
  totals: { day_kwh: number; night_kwh: number; night_share: number };
}

export interface WeekDay {
  date: string;
  label: string;
  values: number[];
  total_kwh: number;
}

export interface WeekResponse {
  labels: string[];
  days: WeekDay[];
  week_commencing: string | null;
}

export interface ScatterPoint {
  hour: number;
  kw: number;
  type: string;
  date: string;
}

export interface ScatterResponse {
  points: ScatterPoint[];
  sampled: boolean;
  total_readings: number;
}
