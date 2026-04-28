import type { SolarSizeResponse } from '../types';

interface Props {
  result: SolarSizeResponse;
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-slate-50 rounded-lg p-4 text-center">
      <p className="text-2xl font-bold text-emerald-600">{value}</p>
      <p className="text-xs font-medium text-slate-700 mt-1">{label}</p>
      {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
    </div>
  );
}

export default function SolarResultsPanel({ result }: Props) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 space-y-4">
      <div className="flex justify-between items-start">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">Recommended System</h2>
          <p className="text-sm text-slate-500">{result.location.postcode}</p>
        </div>
        <div className="text-right">
          <p className="text-4xl font-bold text-emerald-600">{result.recommended_kwp} kWp</p>
          <p className="text-xs text-slate-400">Peak capacity</p>
        </div>
      </div>

      {result.warning && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
          ⚠ {result.warning}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label="Self-Consumption"
          value={`${(result.sc_rate * 100).toFixed(0)}%`}
          sub="of generation used on-site"
        />
        <StatCard
          label="Annual Generation"
          value={`${result.annual_generation_kwh.toLocaleString()} kWh`}
        />
        <StatCard
          label="Annual Export"
          value={`${result.exported_kwh.toLocaleString()} kWh`}
          sub={`${((result.exported_kwh / result.annual_generation_kwh) * 100).toFixed(0)}% of generation`}
        />
        <StatCard
          label="Summer Export"
          value={`${result.summer_export_kwh.toLocaleString()} kWh`}
          sub="Jun–Aug"
        />
      </div>
    </div>
  );
}
