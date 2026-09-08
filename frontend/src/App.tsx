import { useState, useEffect, useCallback } from 'react';
import {
  uploadHHFile,
  sizeSystem,
  friendlyError,
  warmupBackend,
  downloadReport,
  withSessionRecovery,
  forgetSession,
  resetRecoveryBudget,
} from './api/client';
import type { UploadResponse, SolarSizeResponse, SizingValues } from './types';
import FileUpload from './components/FileUpload';
import MonthlyBarChart from './components/MonthlyBarChart';
import UsageHeatmap from './components/UsageHeatmap';
import DailyLineChart from './components/DailyLineChart';
import SolarSizingForm from './components/SolarSizingForm';
import SolarResultsPanel from './components/SolarResultsPanel';
import GenerationChart from './components/GenerationChart';
import SizingCurveChart from './components/SizingCurveChart';
import LoadedDataBar from './components/LoadedDataBar';
import BrandHeader from './components/BrandHeader';
import HHAnalyser from './components/analyser/HHAnalyser';

type BackendStatus = 'connecting' | 'ready' | 'unreachable';
type Area = 'analyser' | 'solar';

const AREAS: {
  id: Area; label: string; blurb: string;
  active: string; idle: string;
}[] = [
  {
    id: 'analyser',
    label: 'Half Hourly Data Analyser',
    blurb: 'Demand profiles, load duration and day/night split',
    active: 'bg-blue-700 border-blue-700',
    idle: 'bg-white border-slate-200 hover:border-blue-300',
  },
  {
    id: 'solar',
    label: 'Solar Sizing Analyser',
    blurb: 'Economics-led array sizing and client report',
    active: 'bg-emerald-600 border-emerald-600',
    idle: 'bg-white border-slate-200 hover:border-emerald-300',
  },
];

export default function App() {
  const [backendStatus, setBackendStatus] = useState<BackendStatus>('connecting');
  const [uploadResult, setUploadResult] = useState<UploadResponse | null>(null);
  const [solarResult, setSolarResult] = useState<SolarSizeResponse | null>(null);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [solarLoading, setSolarLoading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [solarError, setSolarError] = useState<string | null>(null);
  const [lastSizingValues, setLastSizingValues] = useState<SizingValues | null>(null);
  const [clearing, setClearing] = useState(false);
  const [area, setArea] = useState<Area>('analyser');

  // Everything downstream of an upload. Reset as one so a new file can never
  // leave a previous site's charts, sizing or session id on the page.
  const resetAnalysis = useCallback(() => {
    setUploadResult(null);
    setSolarResult(null);
    setUploadError(null);
    setSolarError(null);
    setLastSizingValues(null);
  }, []);

  async function handleClearData() {
    const previous = uploadResult?.session_id;
    setClearing(true);
    resetAnalysis();
    try {
      if (previous) await forgetSession(previous);
    } finally {
      setClearing(false);
    }
  }

  const pingBackend = useCallback(async () => {
    setBackendStatus('connecting');
    const ok = await warmupBackend();
    setBackendStatus(ok ? 'ready' : 'unreachable');
    return ok;
  }, []);

  useEffect(() => { pingBackend(); }, [pingBackend]);

  // Every session-bound request goes through here. Keeping one recovery
  // path is the point: the analyser previously called the API directly and
  // so was the only part of the app that could not survive a lost session,
  // while the solar side silently re-uploaded and looked fine.
  const runWithSession = useCallback(
    <T,>(run: (id: string) => Promise<T>): Promise<T> => {
      if (!uploadResult) return Promise.reject(new Error('No data loaded.'));
      return withSessionRecovery(uploadResult.session_id, run, setUploadResult);
    },
    [uploadResult],
  );

  async function handleUpload(file: File) {
    // Clear first, not on success. If the new file fails to parse, the old
    // site's charts must not be left on screen under an error message —
    // that reads as "it analysed my new data" when it did nothing of the sort.
    const previous = uploadResult?.session_id;
    resetAnalysis();
    setUploadLoading(true);

    if (previous) void forgetSession(previous);

    try {
      const result = await uploadHHFile(file);
      resetRecoveryBudget(); // a deliberate upload is not a recovery attempt
      setUploadResult(result);
      setBackendStatus('ready'); // successful response = backend is alive
    } catch (e: any) {
      if (!e?.response) setBackendStatus('unreachable');
      setUploadError(friendlyError(e, 'Failed to parse file. Please check the format.'));
    } finally {
      setUploadLoading(false);
    }
  }

  async function handleSizingSubmit(values: SizingValues) {
    if (!uploadResult) return;
    setLastSizingValues(values);
    setSolarLoading(true);
    setSolarError(null);
    try {
      // If the server has forgotten the session (Render sleeps and takes its
      // disk with it), the cached upload is re-sent behind the scenes.
      const result = await runWithSession(
        (id) => sizeSystem({ session_id: id, ...values }),
      );
      setSolarResult(result);
      setBackendStatus('ready');
    } catch (e: any) {
      if (!e?.response) setBackendStatus('unreachable');
      setSolarError(friendlyError(e, 'Sizing failed. Check your postcode and try again.'));
    } finally {
      setSolarLoading(false);
    }
  }

  async function retrySizing() {
    if (lastSizingValues) await handleSizingSubmit(lastSizingValues);
  }

  async function handleDownloadReport() {
    if (!uploadResult) return;
    await runWithSession(
      async (id) => {
        // A recovered session has no sizing behind it yet, so re-run it
        // before asking for the report.
        if (id !== uploadResult.session_id && lastSizingValues) {
          const result = await sizeSystem({ session_id: id, ...lastSizingValues });
          setSolarResult(result);
        }
        await downloadReport(id, lastSizingValues?.site_name ?? '');
      },
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center gap-3">
          <BrandHeader />
          <div className="flex-1" />

          {/* Backend status indicator */}
          {backendStatus === 'connecting' && (
            <div className="flex items-center gap-2 text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-full px-3 py-1">
              <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
              </svg>
              Server starting…
            </div>
          )}
          {backendStatus === 'unreachable' && (
            <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-full px-3 py-1">
              <span>Server offline</span>
              <button
                onClick={pingBackend}
                className="underline font-medium hover:text-red-800"
              >
                Retry
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Banner when unreachable */}
      {backendStatus === 'unreachable' && (
        <div className="bg-red-50 border-b border-red-200 px-6 py-3">
          <div className="max-w-5xl mx-auto flex items-center justify-between gap-4">
            <p className="text-sm text-red-700">
              The server is sleeping (Render free tier). It usually wakes within 30–60 seconds.
              Click <strong>Retry</strong> to check again, then try your request.
            </p>
            <button
              onClick={pingBackend}
              className="shrink-0 text-sm font-medium text-red-700 bg-red-100 hover:bg-red-200 border border-red-300 rounded-lg px-4 py-1.5 transition-colors"
            >
              Retry connection
            </button>
          </div>
        </div>
      )}

      {backendStatus === 'connecting' && (
        <div className="bg-amber-50 border-b border-amber-200 px-6 py-3">
          <div className="max-w-5xl mx-auto">
            <p className="text-sm text-amber-700">
              Connecting to server — this can take up to 60 seconds on first load. Please wait before uploading your file.
            </p>
          </div>
        </div>
      )}

      <main className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        {/* Step 1: Upload */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <span className="w-6 h-6 bg-emerald-600 text-white rounded-full text-xs flex items-center justify-center font-bold">1</span>
            <h2 className="font-semibold text-slate-700">Upload 12-Month HH Data</h2>
          </div>
          <FileUpload
            onUpload={handleUpload}
            loading={uploadLoading}
            fileName={uploadResult?.filename ?? null}
          />
          {uploadResult && (
            <div className="mt-3">
              <LoadedDataBar
                upload={uploadResult}
                onClear={handleClearData}
                clearing={clearing}
              />
            </div>
          )}
          {uploadError && (
            <div className="mt-2 flex items-start gap-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-2">
              <span className="flex-1">{uploadError}</span>
              {backendStatus === 'unreachable' && (
                <button
                  onClick={pingBackend}
                  className="shrink-0 font-medium underline hover:text-red-800"
                >
                  Retry connection
                </button>
              )}
            </div>
          )}
        </section>

        {/* Two areas over one upload: analyse the data, or size an array. */}
        {uploadResult && (
          <nav className="grid gap-3 sm:grid-cols-2">
            {AREAS.map((a) => {
              const on = area === a.id;
              return (
                <button
                  key={a.id}
                  onClick={() => setArea(a.id)}
                  aria-pressed={on}
                  className={`text-left px-5 py-4 rounded-xl border-2 transition-all ${
                    on ? `${a.active} shadow-md` : `${a.idle} shadow-sm`
                  }`}
                >
                  <span className={`block text-base font-bold ${
                    on ? 'text-white' : 'text-slate-800'
                  }`}>{a.label}</span>
                  <span className={`block text-xs mt-0.5 ${
                    on ? 'text-white/80' : 'text-slate-500'
                  }`}>{a.blurb}</span>
                </button>
              );
            })}
          </nav>
        )}

        {uploadResult && uploadResult.warnings.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2 text-sm text-amber-700">
            {uploadResult.warnings.map((w, i) => <p key={i}>{w}</p>)}
          </div>
        )}

        {uploadResult && area === 'analyser' && (
          <HHAnalyser
            sessionId={uploadResult.session_id}
            runWithSession={runWithSession}
          />
        )}

        {/* Consumption overview: shared context for both areas */}
        {uploadResult && area === 'solar' && (
          <section>
            <div className="flex items-center gap-2 mb-3">
              <span className="w-6 h-6 bg-emerald-600 text-white rounded-full text-xs flex items-center justify-center font-bold">2</span>
              <h2 className="font-semibold text-slate-700">Usage Profile</h2>
              <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">
                Format {uploadResult.detected_format} · {uploadResult.days_parsed} days
              </span>
            </div>
            <div className="space-y-4">
              <MonthlyBarChart
                data={uploadResult.monthly_totals}
                annualKwh={uploadResult.annual_kwh}
              />
              <DailyLineChart
                hhSeries={uploadResult.hh_series}
                dailySeries={uploadResult.daily_series}
                monthlyTotals={uploadResult.monthly_totals}
              />
              <UsageHeatmap data={uploadResult.heatmap} />
            </div>
          </section>
        )}

        {/* Step 3: Solar Sizing */}
        {uploadResult && area === 'solar' && (
          <section>
            <div className="flex items-center gap-2 mb-3">
              <span className="w-6 h-6 bg-emerald-600 text-white rounded-full text-xs flex items-center justify-center font-bold">3</span>
              <h2 className="font-semibold text-slate-700">Size Solar System</h2>
            </div>
            <SolarSizingForm onSubmit={handleSizingSubmit} loading={solarLoading} />
            {solarError && (
              <div className="mt-2 flex items-start gap-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-2">
                <span className="flex-1">{solarError}</span>
                {lastSizingValues && (
                  <button
                    onClick={retrySizing}
                    disabled={solarLoading}
                    className="shrink-0 font-medium underline hover:text-red-800 disabled:opacity-50"
                  >
                    Try again
                  </button>
                )}
              </div>
            )}
          </section>
        )}

        {/* Step 4: Solar Results */}
        {solarResult && area === 'solar' && (
          <section>
            <div className="flex items-center gap-2 mb-3">
              <span className="w-6 h-6 bg-emerald-600 text-white rounded-full text-xs flex items-center justify-center font-bold">4</span>
              <h2 className="font-semibold text-slate-700">Solar Sizing Results</h2>
            </div>
            <div className="space-y-4">
              <SolarResultsPanel
                result={solarResult}
                sessionId={uploadResult!.session_id}
                onDownloadReport={handleDownloadReport}
              />
              <GenerationChart
                data={solarResult.monthly_chart}
                systemKwp={solarResult.recommended_kwp}
              />
              <SizingCurveChart
                data={solarResult.sizing_curve}
                recommendedKwp={solarResult.recommended_kwp}
                bandMin={lastSizingValues?.target_sc_min ?? 0.7}
                bandMax={lastSizingValues?.target_sc_max ?? 0.9}
              />
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
