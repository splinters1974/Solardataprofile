import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import type { DailyPoint } from '../types';

interface Props {
  data: DailyPoint[];
}

const MONTH_STARTS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function monthLabel(date: string): string | undefined {
  // Return month name only on the 1st of each month
  if (date.endsWith('-01')) {
    const m = parseInt(date.slice(5, 7), 10) - 1;
    return MONTH_STARTS[m];
  }
  return undefined;
}

export default function DailyLineChart({ data }: Props) {
  // Annotate each point with a tick label (only shown on 1st of month)
  const chartData = data.map((d) => ({
    ...d,
    label: monthLabel(d.date),
  }));

  // Reference lines at the 1st of each month for visual separation
  const monthBoundaries = data
    .filter((d) => d.date.endsWith('-01'))
    .map((d) => d.date);

  const peak = Math.max(...data.map((d) => d.kwh));
  const avg = data.reduce((s, d) => s + d.kwh, 0) / data.length;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
      <div className="flex justify-between items-start mb-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">Daily Consumption Trend</h2>
          <p className="text-sm text-slate-500">
            Every day's total kWh — {data.length} days shown
          </p>
        </div>
        <div className="flex gap-4 text-right">
          <div>
            <p className="text-lg font-bold text-slate-700">{peak.toLocaleString(undefined, { maximumFractionDigits: 0 })} kWh</p>
            <p className="text-xs text-slate-400">Peak day</p>
          </div>
          <div>
            <p className="text-lg font-bold text-emerald-600">{avg.toLocaleString(undefined, { maximumFractionDigits: 0 })} kWh</p>
            <p className="text-xs text-slate-400">Daily avg</p>
          </div>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />

          {/* Faint vertical lines at month boundaries */}
          {monthBoundaries.map((d) => (
            <ReferenceLine key={d} x={d} stroke="#e2e8f0" strokeWidth={1} />
          ))}

          {/* Average line */}
          <ReferenceLine
            y={avg}
            stroke="#10b981"
            strokeDasharray="4 2"
            strokeWidth={1.5}
            label={{ value: 'Avg', position: 'right', fill: '#10b981', fontSize: 11 }}
          />

          <XAxis
            dataKey="date"
            tick={({ x, y, payload }) => {
              const label = monthLabel(payload.value);
              if (!label) return <g />;
              return (
                <text x={x} y={(y as number) + 12} textAnchor="middle" fontSize={12} fill="#64748b">
                  {label}
                </text>
              );
            }}
            interval={0}
            height={24}
          />
          <YAxis
            tick={{ fontSize: 12, fill: '#64748b' }}
            label={{ value: 'kWh/day', angle: -90, position: 'insideLeft', offset: 10, style: { fontSize: 12, fill: '#94a3b8' } }}
          />
          <Tooltip
            labelFormatter={(label) => label}
            formatter={(value) => [`${(value as number).toFixed(1)} kWh`, 'Daily total']}
            contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 13 }}
          />
          <Line
            type="monotone"
            dataKey="kwh"
            stroke="#3b82f6"
            strokeWidth={1.5}
            dot={false}
            activeDot={{ r: 3, fill: '#3b82f6' }}
          />
        </LineChart>
      </ResponsiveContainer>
      <p className="text-xs text-slate-400 mt-1 text-center">
        Green dashed line = daily average · Vertical lines = month boundaries
      </p>
    </div>
  );
}
