import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
  ResponsiveContainer,
} from 'recharts';
import type { LoadDurationResponse } from '../../types';
import Panel from './Panel';

interface Props {
  data: LoadDurationResponse;
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="bg-slate-50 rounded-lg px-4 py-3">
      <p className="text-lg font-bold text-emerald-700">{value}</p>
      <p className="text-xs font-medium text-slate-700">{label}</p>
      {hint && <p className="text-xs text-slate-400 mt-0.5">{hint}</p>}
    </div>
  );
}

export default function LoadDurationChart({ data }: Props) {
  return (
    <Panel
      title="Load duration curve"
      subtitle="Load in kW against the hours per year the site sits at or above it. The tail on the left is the expensive peak; the flat right-hand end is base load running all year."
    >
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <Stat label="Peak" value={`${data.peak_kw.toLocaleString()} kW`} />
        <Stat label="Average" value={`${data.average_kw.toLocaleString()} kW`} />
        <Stat label="Base" value={`${data.base_kw.toLocaleString()} kW`} hint="lowest reading" />
        <Stat
          label="Load factor"
          value={`${(data.load_factor * 100).toFixed(0)}%`}
          hint="average ÷ peak"
        />
      </div>

      <ResponsiveContainer width="100%" height={300}>
        <AreaChart data={data.curve} margin={{ top: 4, right: 12, left: 0, bottom: 16 }}>
          <defs>
            <linearGradient id="ldc" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#0f766e" stopOpacity={0.35} />
              <stop offset="100%" stopColor="#0f766e" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis
            dataKey="hours"
            type="number"
            domain={[0, 8766]}
            ticks={[0, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 8766]}
            tick={{ fontSize: 11, fill: '#64748b' }}
            tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
            label={{
              value: 'Hours per year at or above this load',
              position: 'insideBottom', offset: -12,
              style: { fontSize: 12, fill: '#94a3b8' },
            }}
          />
          <YAxis
            tick={{ fontSize: 11, fill: '#64748b' }}
            label={{
              value: 'kW', angle: -90, position: 'insideLeft',
              style: { fontSize: 12, fill: '#94a3b8' },
            }}
          />
          <Tooltip
            formatter={(v) => [`${Number(v).toLocaleString()} kW`, 'Load']}
            labelFormatter={(l) => `${Number(l).toLocaleString()} hours/year`}
            contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 13 }}
          />
          <ReferenceLine
            y={data.average_kw}
            stroke="#f59e0b"
            strokeDasharray="4 3"
            label={{
              value: `Average ${data.average_kw.toLocaleString()} kW`,
              position: 'right', fill: '#b45309', fontSize: 11,
            }}
          />
          <Area
            type="monotone" dataKey="kw" stroke="#0f766e"
            strokeWidth={2} fill="url(#ldc)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </Panel>
  );
}
