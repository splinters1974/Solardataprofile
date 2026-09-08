import { useState } from 'react';
import type { SolarSizeResponse } from '../types';

interface Props {
  result: SolarSizeResponse;
  sessionId: string;
  onDownloadReport: () => Promise<void>;
}

const money = (v: number) =>
  `${v < 0 ? '-' : ''}£${Math.abs(Math.round(v)).toLocaleString()}`;

const years = (v: number | null) => (v === null ? 'Never' : `${v.toFixed(1)} yrs`);

const pct = (v: number | null, dp = 0) =>
  v === null ? 'n/a' : `${(v * 100).toFixed(dp)}%`;

function StatCard({
  label,
  value,
  sub,
  tone = 'emerald',
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'emerald' | 'slate';
}) {
  return (
    <div className="bg-slate-50 rounded-lg p-4 text-center">
      <p
        className={`text-2xl font-bold ${
          tone === 'emerald' ? 'text-emerald-600' : 'text-slate-700'
        }`}
      >
        {value}
      </p>
      <p className="text-xs font-medium text-slate-700 mt-1">{label}</p>
      {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between py-1.5 border-b border-slate-100 last:border-0">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium text-slate-800 tabular-nums">{value}</span>
    </div>
  );
}

export default function SolarResultsPanel({ result, onDownloadReport }: Props) {
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const e = result.economics;
  const alt = result.alternative_max_onsite;

  async function handleDownload() {
    setDownloading(true);
    setDownloadError(null);
    try {
      await onDownloadReport();
    } catch {
      setDownloadError('Could not build the report. Please try again.');
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 space-y-5">
      <div className="flex justify-between items-start gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">Recommended System</h2>
          <p className="text-sm text-slate-500">
            {result.location.postcode} · sized on {result.days_analysed} days of
            metered data
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-4xl font-bold text-emerald-600">
            {result.recommended_kwp.toLocaleString()} kWp
          </p>
          <p className="text-xs text-slate-400">Peak capacity</p>
        </div>
      </div>

      {result.warning && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
          ⚠ {result.warning}
        </div>
      )}

      {/* Headline: economics first, because that is the decision */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Simple Payback" value={years(e.simple_payback_years)} />
        <StatCard label="Year 1 Saving" value={money(e.year_one_saving)} />
        <StatCard label="Capital Cost" value={money(e.capex)} />
        <StatCard
          label="Self-Consumption"
          value={pct(result.sc_rate)}
          sub={`meets ${pct(result.offset_rate)} of site demand`}
        />
      </div>

      <div className="grid gap-6 md:grid-cols-2 text-sm">
        <div>
          <h3 className="font-semibold text-slate-700 mb-2">Energy (per year)</h3>
          <Row label="Site consumption" value={`${result.annual_consumption_kwh.toLocaleString()} kWh`} />
          <Row label="Solar generation" value={`${result.annual_generation_kwh.toLocaleString()} kWh`} />
          <Row label="Used on site" value={`${result.self_consumed_kwh.toLocaleString()} kWh`} />
          <Row label="Exported" value={`${result.exported_kwh.toLocaleString()} kWh`} />
          <Row label="Summer export (Jun–Aug)" value={`${result.summer_export_kwh.toLocaleString()} kWh`} />
          <Row
            label="Yield"
            value={`${Math.round(result.annual_generation_kwh / result.recommended_kwp).toLocaleString()} kWh/kWp`}
          />
        </div>
        <div>
          <h3 className="font-semibold text-slate-700 mb-2">Financial</h3>
          <Row label="Year 1 import saving" value={money(e.year_one_import_saving)} />
          <Row label="Year 1 export income" value={money(e.year_one_export_income)} />
          <Row label="Annual O&M" value={money(-e.annual_opex)} />
          <Row label="Discounted payback" value={years(e.discounted_payback_years)} />
          <Row label="NPV" value={money(e.npv)} />
          <Row label="IRR" value={pct(e.irr, 1)} />
          <Row
            label="LCOE"
            value={e.lcoe_p_kwh === null ? 'n/a' : `${e.lcoe_p_kwh.toFixed(1)}p/kWh`}
          />
          <Row
            label="Carbon avoided"
            value={`${e.carbon_saved_tonnes_year.toLocaleString()} tCO2e/yr`}
          />
        </div>
      </div>

      {alt && (
        <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 text-sm">
          <p className="font-medium text-slate-700 mb-1">
            Alternative: maximum energy on site
          </p>
          <p className="text-slate-600">
            {alt.kwp.toLocaleString()} kWp is the largest array that still holds
            self-consumption at or above your minimum. It uses{' '}
            {alt.self_consumed_kwh.toLocaleString()} kWh on site against{' '}
            {result.self_consumed_kwh.toLocaleString()} kWh, at{' '}
            {years(alt.simple_payback_years)} payback and {money(alt.npv)} NPV.
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 pt-1">
        <button
          onClick={handleDownload}
          disabled={downloading}
          className="bg-slate-800 hover:bg-slate-900 disabled:bg-slate-300 text-white font-semibold px-5 py-2.5 rounded-lg text-sm transition-colors"
        >
          {downloading ? 'Building report…' : 'Download client report (PDF)'}
        </button>
        {downloadError && <span className="text-sm text-red-600">{downloadError}</span>}
      </div>

      <p className="text-xs text-slate-400">
        Indicative desktop appraisal. No allowance for roof area, structural
        capacity, shading survey or grid connection limits.
      </p>
    </div>
  );
}
