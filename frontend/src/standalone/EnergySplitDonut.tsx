import { useState } from 'react';
import type { EnergySplit } from '../local/chartData';
import { CHART } from '../local/chartColours';
import { ChartCard } from './ChartCard';
import { chartFileName } from './chartDownload';
import { gbp, kw, kwh, pct } from './format';

const SEGMENTS = [
  { key: 'base', label: 'Base load', colour: CHART.green, note: 'never switches off' },
  { key: 'openAbove', label: 'Open hours', colour: CHART.blue, note: 'above base load' },
  { key: 'closedAbove', label: 'Closed-hours excess', colour: CHART.orange, note: 'above base load, site shut' },
] as const;

/**
 * Where the energy goes: total consumption split into the load that never
 * switches off, use while open, and use while shut beyond the base load.
 * The three parts add up to the observed total.
 */
export default function EnergySplitDonut({ split, refKw, siteName, costPerKwh }: {
  split: EnergySplit; refKw: number; siteName: string; costPerKwh: number;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const R = 92; const r = 62; const C = 110;
  const shares = SEGMENTS.map((seg) => (split.total > 0 ? split[seg.key] / split.total : 0));
  const arcs = SEGMENTS.map((seg, k) => {
    const before = shares.slice(0, k).reduce((x, y) => x + y, 0);
    const a0 = -Math.PI / 2 + before * Math.PI * 2;
    return { ...seg, v: split[seg.key], share: shares[k], a0, a1: a0 + shares[k] * Math.PI * 2 };
  });
  const arcPath = (a0: number, a1: number) => {
    const gap = 0.012; // a thin white gap between segments
    const s = a0 + gap; const e = Math.max(s, a1 - gap);
    const large = e - s > Math.PI ? 1 : 0;
    const p = (rad: number, a: number) => `${(C + rad * Math.cos(a)).toFixed(2)},${(C + rad * Math.sin(a)).toFixed(2)}`;
    return `M${p(R, s)}A${R},${R} 0 ${large} 1 ${p(R, e)}L${p(r, e)}A${r},${r} 0 ${large} 0 ${p(r, s)}Z`;
  };
  const focus = arcs.find((a) => a.key === hover);
  return (
    <ChartCard
      title="Where the energy goes"
      subtitle={`Observed consumption, split at the base load reference of ${kw(refKw)}`}
      file={chartFileName(siteName, 'where-the-energy-goes')}
      footer="Base load is the all-period reference in every half hour (capped at what was used). Open hours and closed-hours excess are use above it. The closed-hours excess is the figure the ranking uses."
    >
      <div className="flex flex-wrap items-center gap-6">
        <svg viewBox="0 0 220 220" className="w-52 h-52 shrink-0" role="img"
          aria-label={arcs.map((a) => `${a.label} ${pct(a.share)}`).join(', ')}>
          {arcs.map((a) => a.share > 0 && (
            <path key={a.key} d={a.share >= 0.999 ? '' : arcPath(a.a0, a.a1)} fill={a.colour}
              opacity={hover && hover !== a.key ? 0.35 : 1}
              onMouseEnter={() => setHover(a.key)} onMouseLeave={() => setHover(null)} />
          ))}
          <text x={C} y={C - 6} textAnchor="middle" fontSize="12" fill="#64748b">{focus ? focus.label : 'Total'}</text>
          <text x={C} y={C + 16} textAnchor="middle" fontSize="20" fontWeight="700" fill="#0f172a">
            {focus ? pct(focus.share) : kwh(split.total)}
          </text>
        </svg>
        <ul className="flex-1 min-w-56 space-y-2">
          {arcs.map((a) => (
            <li key={a.key} className={`flex items-start gap-3 rounded-lg px-2 py-1.5 ${hover === a.key ? 'bg-slate-50' : ''}`}
              onMouseEnter={() => setHover(a.key)} onMouseLeave={() => setHover(null)}>
              <span className="mt-1 w-3.5 h-3.5 rounded-sm shrink-0" style={{ background: a.colour }} />
              <span className="flex-1">
                <span className="block text-sm font-semibold text-slate-800">{a.label} <span className="font-normal text-slate-500">{a.note}</span></span>
                <span className="block text-sm text-slate-700">
                  <strong className="text-lg">{pct(a.share)}</strong> · {kwh(a.v)} · {gbp(a.v * costPerKwh)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </ChartCard>
  );
}
