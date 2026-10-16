import { useState } from 'react';
import { getCarbon, setCarbon } from '../local/localClient';
import { CARBON_PRESETS } from '../local/site';

/**
 * Carbon factor, reporting year and source. All three can be typed in any
 * order; carbon is only shown once a factor above zero is entered. There is
 * no silent default: the published UK Government factors are offered as
 * one-click suggestions that fill in the year and source too.
 */
export default function CarbonFields({ onChange }: { onChange: () => void }) {
  const start = getCarbon();
  const [factor, setFactor] = useState(start ? String(start.kgPerKwh) : '');
  const [year, setYear] = useState(start?.year ?? '');
  const [source, setSource] = useState(start?.source ?? '');

  const commit = (f: string, y: string, src: string) => {
    setFactor(f); setYear(y); setSource(src);
    const v = Number(f);
    setCarbon(f.trim() !== '' && Number.isFinite(v) && v > 0 ? { kgPerKwh: v, year: y, source: src } : null);
    onChange();
  };
  const field = 'w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400';

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-40">
          <label className="block text-xs font-medium text-slate-600 mb-1">Carbon factor (kgCO2e/kWh)</label>
          <input type="number" min={0} step="any" value={factor} placeholder="Not entered" className={field}
            onChange={(e) => commit(e.target.value, year, source)} />
        </div>
        <div className="w-28">
          <label className="block text-xs font-medium text-slate-600 mb-1">Reporting year</label>
          <input value={year} placeholder="e.g. 2026" className={field} onChange={(e) => commit(factor, e.target.value, source)} />
        </div>
        <div className="flex-1 min-w-48">
          <label className="block text-xs font-medium text-slate-600 mb-1">Source</label>
          <input value={source} placeholder="e.g. UK Government GHG conversion factors 2026" className={field} onChange={(e) => commit(factor, year, e.target.value)} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-slate-500">Suggested:</span>
        {CARBON_PRESETS.map((p) => (
          <button key={p.year} type="button" onClick={() => commit(String(p.kgPerKwh), p.year, p.source)}
            className="border border-[#008540] text-[#008540] rounded-full px-3 py-1 font-medium hover:bg-green-50"
            title={p.note}>
            UK Government {p.year}: {p.kgPerKwh} kgCO2e/kWh
          </button>
        ))}
        {factor && <button type="button" onClick={() => commit('', '', '')} className="text-slate-400 hover:text-red-600 underline">Clear</button>}
      </div>
      <p className="text-xs text-slate-400">
        Use the factor for the year you are reporting. These are the UK Government location-based factors for grid electricity
        (Scope 2, generation only; transmission and distribution losses are a separate Scope 3 factor). Check them against gov.uk before
        formal reporting. Carbon is kWh x factor: an estimate from one annual factor, not time-of-day grid carbon, so it shows no
        benefit from moving load in time.
      </p>
    </div>
  );
}
