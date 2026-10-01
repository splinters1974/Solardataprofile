import type { Finding, SiteMetrics } from '../local/findings';
import { LEVEL_UI } from './levelUi';

const gbp = (v: number) => `£${Math.round(v).toLocaleString('en-GB')}`;

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 px-4 py-3">
      <p className="text-xl font-bold text-slate-800 tabular-nums">{value}</p>
      <p className="text-xs font-medium text-slate-600 mt-0.5">{label}</p>
      {hint && <p className="text-xs text-slate-400 mt-0.5">{hint}</p>}
    </div>
  );
}

function FindingRow({ f }: { f: Finding }) {
  const ui = LEVEL_UI[f.level];
  return (
    <li className="flex gap-3 py-3 border-b border-slate-100 last:border-0">
      <span className={`w-1 rounded-full shrink-0 ${ui.bar}`} aria-hidden />
      <div className="min-w-0">
        <p className="text-sm">
          <span className={`text-[11px] font-bold uppercase tracking-wide mr-2 ${ui.text}`}>{ui.label}</span>
          <span className="font-semibold text-slate-800">{f.title}</span>
        </p>
        <p className="text-sm text-slate-600 mt-0.5 leading-relaxed">{f.detail}</p>
      </div>
    </li>
  );
}

export default function FindingsPanel({ metrics: m }: { metrics: SiteMetrics }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile label="Annual cost" value={gbp(m.annualCost)}
          hint={`${m.annualKwh.toLocaleString('en-GB')} kWh at ${m.rateP}p`} />
        <Tile label="Out of hours" value={m.hasOutOfHours ? `${Math.round(m.oohShare * 100)}%` : '24-7 site'}
          hint={m.hasOutOfHours ? `${gbp(m.oohExcessCost)} a year above base load` : 'no closed hours set'} />
        <Tile label="Base load" value={`${m.baseKw.toLocaleString('en-GB')} kW`}
          hint={`${Math.round(m.baseShare * 100)}% of consumption, ${gbp(m.baseCost)} a year`} />
        <Tile label="Peak demand" value={`${m.peakKw.toLocaleString('en-GB')} kW`} hint={m.peakWhen} />
      </div>
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
        <h3 className="text-base font-semibold text-slate-800">What stands out</h3>
        <p className="text-sm text-slate-500 mt-0.5">
          Priced at {m.rateP}p/kWh and scaled to a year from {m.days} days. Each figure is what the
          pattern costs now, not a guaranteed saving.
        </p>
        <ul className="mt-2">
          {m.findings.map((f) => <FindingRow key={f.key} f={f} />)}
        </ul>
      </div>
    </div>
  );
}
