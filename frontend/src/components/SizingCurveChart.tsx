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
  maxPaybackYears: number;
  minScRate: number;
}

export default function SizingCurveChart({
  data,
  recommendedKwp,
  maxPaybackYears,
  minScRate,
}: Props) {
  const chartData = data.map((d) => ({
    kwp: d.kwp,
    sc_pct: Math.round(d.sc_rate * 100),
    payback: d.simple_payback_years,
    npv: Math.round(d.npv / 1000),
  }));

  // Shade every size that clears both constraints, so the reason the
  // recommendation stops where it does is visible rather than implied.
  const eligible = data.filter(
    (d) =>
      d.sc_rate >= minScRate &&
      d.simple_payback_years !== null &&
      d.simple_payback_years <= maxPaybackYears,
  );
  const bandFrom = eligible.length ? Math.min(...eligible.map((d) => d.kwp)) : null;
  const bandTo = eligible.length ? Math.max(...eligible.map((d) => d.kwp)) : null;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-slate-800">Why this size</h2>
        <p className="text-sm text-slate-500">
          Every extra kWp is worth less than the one before it, because the
          surplus is exported rather than displacing import. The shaded region
          is every size paying back within {maxPaybackYears} years while keeping
          at least {Math.round(minScRate * 100)}% of output on site. The
          recommendation is the largest of those.
        </p>
      </div>
      <ResponsiveContainer width="100%" height={340}>
        <ComposedChart data={chartData} margin={{ top: 24, right: 12, left: 0, bottom: 28 }}>
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
              offset: -20,
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
          <Legend
            verticalAlign="top"
            align="left"
            height={30}
            iconSize={10}
            wrapperStyle={{ fontSize: 12, paddingBottom: 6 }}
          />
          <ReferenceLine
            yAxisId="left"
            x={recommendedKwp}
            stroke="#0f766e"
            strokeDasharray="4 2"
            strokeWidth={2}
            label={{
              value: `Recommended ${recommendedKwp.toLocaleString()} kWp`,
              position: 'insideTopRight',
              fill: '#0f766e',
              fontSize: 11,
              offset: 8,
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
