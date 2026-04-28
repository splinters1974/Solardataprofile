import { useState } from 'react';
import { uploadHHFile, sizeSystem } from './api/client';
import type { UploadResponse, SolarSizeResponse } from './types';
import FileUpload from './components/FileUpload';
import MonthlyBarChart from './components/MonthlyBarChart';
import UsageHeatmap from './components/UsageHeatmap';
import SolarSizingForm from './components/SolarSizingForm';
import SolarResultsPanel from './components/SolarResultsPanel';
import GenerationChart from './components/GenerationChart';
import SizingCurveChart from './components/SizingCurveChart';

export default function App() {
  const [uploadResult, setUploadResult] = useState<UploadResponse | null>(null);
  const [solarResult, setSolarResult] = useState<SolarSizeResponse | null>(null);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [solarLoading, setSolarLoading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [solarError, setSolarError] = useState<string | null>(null);

  async function handleUpload(file: File) {
    setUploadLoading(true);
    setUploadError(null);
    setSolarResult(null);
    try {
      const result = await uploadHHFile(file);
      setUploadResult(result);
    } catch (e: any) {
      setUploadError(e?.response?.data?.detail ?? 'Failed to parse file. Please check the format.');
    } finally {
      setUploadLoading(false);
    }
  }

  async function handleSizingSubmit(values: {
    postcode: string;
    target_sc_min: number;
    target_sc_max: number;
    roof_tilt: number;
    roof_aspect: number;
  }) {
    if (!uploadResult) return;
    setSolarLoading(true);
    setSolarError(null);
    try {
      const result = await sizeSystem({ session_id: uploadResult.session_id, ...values });
      setSolarResult(result);
    } catch (e: any) {
      setSolarError(e?.response?.data?.detail ?? 'Sizing failed. Check your postcode and try again.');
    } finally {
      setSolarLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center gap-3">
          <div className="w-8 h-8 bg-emerald-500 rounded-lg flex items-center justify-center">
            <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z" clipRule="evenodd" />
            </svg>
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-800">Solar Data Profile</h1>
            <p className="text-xs text-slate-400">HH consumption analysis & solar sizing</p>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        {/* Step 1: Upload */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <span className="w-6 h-6 bg-emerald-600 text-white rounded-full text-xs flex items-center justify-center font-bold">1</span>
            <h2 className="font-semibold text-slate-700">Upload 12-Month HH Data</h2>
          </div>
          <FileUpload onUpload={handleUpload} loading={uploadLoading} />
          {uploadError && (
            <p className="mt-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-2">
              {uploadError}
            </p>
          )}
        </section>

        {/* Step 2: Usage Profile */}
        {uploadResult && (
          <section>
            <div className="flex items-center gap-2 mb-3">
              <span className="w-6 h-6 bg-emerald-600 text-white rounded-full text-xs flex items-center justify-center font-bold">2</span>
              <h2 className="font-semibold text-slate-700">Usage Profile</h2>
              <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">
                Format {uploadResult.detected_format} · {uploadResult.days_parsed} days
              </span>
            </div>
            {uploadResult.warnings.length > 0 && (
              <div className="mb-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2 text-sm text-amber-700">
                {uploadResult.warnings.map((w, i) => <p key={i}>{w}</p>)}
              </div>
            )}
            <div className="space-y-4">
              <MonthlyBarChart
                data={uploadResult.monthly_totals}
                annualKwh={uploadResult.annual_kwh}
              />
              <UsageHeatmap data={uploadResult.heatmap} />
            </div>
          </section>
        )}

        {/* Step 3: Solar Sizing */}
        {uploadResult && (
          <section>
            <div className="flex items-center gap-2 mb-3">
              <span className="w-6 h-6 bg-emerald-600 text-white rounded-full text-xs flex items-center justify-center font-bold">3</span>
              <h2 className="font-semibold text-slate-700">Size Solar System</h2>
            </div>
            <SolarSizingForm onSubmit={handleSizingSubmit} loading={solarLoading} />
            {solarError && (
              <p className="mt-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-2">
                {solarError}
              </p>
            )}
          </section>
        )}

        {/* Step 4: Solar Results */}
        {solarResult && (
          <section>
            <div className="flex items-center gap-2 mb-3">
              <span className="w-6 h-6 bg-emerald-600 text-white rounded-full text-xs flex items-center justify-center font-bold">4</span>
              <h2 className="font-semibold text-slate-700">Solar Sizing Results</h2>
            </div>
            <div className="space-y-4">
              <SolarResultsPanel result={solarResult} />
              <GenerationChart
                data={solarResult.monthly_chart}
                systemKwp={solarResult.recommended_kwp}
              />
              <SizingCurveChart
                data={solarResult.sizing_curve}
                recommendedKwp={solarResult.recommended_kwp}
              />
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
