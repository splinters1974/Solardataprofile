import {
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
  ReferenceArea,
  ResponsiveContainer,
} from 'recharts';
import type { SizingCurvePoint } from '../types';

interface Props {
  data: SizingCurvePoint[];
  recommendedKwp: number;
  bandMin: number;
  bandMax: number;
}

export default function SizingCurveChart({
  data,
  recommendedKwp,
  bandMin,
  bandMax,
}: Props) {
  const chartData = data.map((d) => ({
    kwp: d.kwp,
    sc_pct: Math.round(d.sc_rate * 100),
    payback: d.simple_payback_years,
    npv: Math.round(d.npv / 1000),
  }));

  // The band is where the recommendation is allowed to live. Showing it as a
  // shaded region on the kWp axis makes the constraint visible, not implied.
  const inBand = data.filter(
    (d) => d.sc_rate >= bandMin && d.sc_rate <= bandMax,
  );
  const bandFrom = inBand.length ? Math.min(...inBand.map((d) => d.kwp)) : null;
  const bandTo = inBand.length ? Math.max(...inBand.map((d) => d.kwp)) : null;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-slate-800">Why this size</h2>
        <p className="text-sm text-slate-500">
          Payback improves with scale until the site can no longer absorb what the
          array makes. The shaded band is your {Math.round(bandMin * 100)}–
          {Math.round(bandMax * 100)}% self-consumption constraint.
        </p>
      </div>
      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 16 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          {bandFrom !== null && bandTo !== null && (
            <ReferenceArea x1={bandFrom} x2={bandTo} fill="#10b981" fillOpacity={0.07} />
          )}
          <XAxis
            dataKey="kwp"
            type="number"
            domain={['dataMin', 'dataMax']}
            tick={{ fontSize: 12, fill: '#64748b' }}
            label={{
              value: 'System size (kWp)',
              position: 'insideBottom',
              offset: -12,
              style: { fontSize: 12, fill: '#94a3b8' },
            }}
          />
          <YAxis
            yAxisId="left"
            tick={{ fontSize: 12, fill: '#64748b' }}
            tickFormatter={(v) => `${v}y`}
            label={{
              value: 'Payback',
              angle: -90,
              position: 'insideLeft',
              style: { fontSize: 12, fill: '#94a3b8' },
            }}
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            domain={[0, 100]}
            tick={{ fontSize: 12, fill: '#64748b' }}
            tickFormatter={(v) => `${v}%`}
          />
          <Tooltip
            formatter={(value, name) => {
              if (name === 'Simple payback')
                return [value === null ? 'Never' : `${value} years`, name];
              if (name === 'Self-consumption') return [`${value}%`, name];
              return [`£${Number(value).toLocaleString()}k`, name];
            }}
            labelFormatter={(label) => `${Number(label).toLocaleString()} kWp`}
            contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 13 }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <ReferenceLine
            yAxisId="left"
            x={recommendedKwp}
            stroke="#0f766e"
            strokeDasharray="4 2"
            strokeWidth={2}
            label={{
              value: `${recommendedKwp.toLocaleString()} kWp`,
              position: 'top',
              fill: '#0f766e',
              fontSize: 12,
            }}
          />
          <Line
            yAxisId="left"
            type="monotone"
            dataKey="payback"
            name="Simple payback"
            stroke="#0f766e"
            strokeWidth={2.5}
            dot={false}
            activeDot={{ r: 4 }}
            connectNulls={false}
          />
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="sc_pct"
            name="Self-consumption"
            stroke="#94a3b8"
            strokeWidth={1.5}
            strokeDasharray="4 3"
            dot={false}
          />
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="npv"
            name="NPV (£k)"
            stroke="#f59e0b"
            strokeWidth={1.5}
            dot={false}
            hide
          />
        </ComposedChart>
      </ResponsiveContainer>
      <p className="text-xs text-slate-400 mt-2 text-center">
        Click a legend item to show or hide it. NPV is hidden by default.
      </p>
    </div>
  );
}
