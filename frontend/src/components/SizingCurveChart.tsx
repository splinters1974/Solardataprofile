import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from 'recharts';
import type { SizingCurvePoint } from '../types';

interface Props {
  data: SizingCurvePoint[];
  recommendedKwp: number;
}

export default function SizingCurveChart({ data, recommendedKwp }: Props) {
  const chartData = data.map((d) => ({
    kwp: d.kwp,
    sc_pct: Math.round(d.sc_rate * 100),
  }));

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-slate-800">Self-Consumption vs System Size</h2>
        <p className="text-sm text-slate-500">Trade-off curve — larger systems generate more but export more</p>
      </div>
      <ResponsiveContainer width="100%" height={250}>
        <LineChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis
            dataKey="kwp"
            tick={{ fontSize: 12, fill: '#64748b' }}
            label={{ value: 'System size (kWp)', position: 'insideBottom', offset: -2, style: { fontSize: 12, fill: '#94a3b8' } }}
          />
          <YAxis
            domain={[0, 100]}
            tick={{ fontSize: 12, fill: '#64748b' }}
            tickFormatter={(v) => `${v}%`}
          />
          <Tooltip
            formatter={(value) => [`${value}%`, 'Self-consumption']}
            labelFormatter={(label) => `${label} kWp`}
            contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 13 }}
          />
          <ReferenceLine x={recommendedKwp} stroke="#10b981" strokeDasharray="4 2" strokeWidth={2}
            label={{ value: `${recommendedKwp} kWp`, position: 'top', fill: '#10b981', fontSize: 12 }} />
          <ReferenceLine y={80} stroke="#94a3b8" strokeDasharray="3 3" />
          <ReferenceLine y={90} stroke="#94a3b8" strokeDasharray="3 3" />
          <Line
            type="monotone"
            dataKey="sc_pct"
            stroke="#10b981"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
          />
        </LineChart>
      </ResponsiveContainer>
      <p className="text-xs text-slate-400 mt-2 text-center">Dashed lines at 80% and 90% self-consumption targets</p>
    </div>
  );
}
