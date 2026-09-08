import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from 'recharts';
import type { WeekResponse, WeekOption } from '../../types';
import Panel from './Panel';

const DAY_COLOURS = [
  '#0f766e', '#0d9488', '#14b8a6', '#2dd4bf', '#5eead4', '#f59e0b', '#ef4444',
];

interface Props {
  data: WeekResponse;
  weeks: WeekOption[];
  selected: string | undefined;
  onSelect: (week: string) => void;
  title: string;
}

export default function WeekChart({ data, weeks, selected, onSelect, title }: Props) {
  const rows = data.labels.map((label, i) => {
    const row: Record<string, string | number> = { time: label };
    for (const d of data.days) row[d.label] = d.values[i];
    return row;
  });

  const total = data.days.reduce((sum, d) => sum + d.total_kwh, 0);

  return (
    <Panel
      title={title}
      subtitle={
        data.days.length
          ? `${data.days.length} days · ${Math.round(total).toLocaleString()} kWh across the week`
          : 'No data in this week'
      }
      action={
        <select
          value={selected ?? data.week_commencing ?? ''}
          onChange={(e) => onSelect(e.target.value)}
          className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
        >
          {weeks.map((w) => (
            <option key={w.value} value={w.value}>w/c {w.label}</option>
          ))}
        </select>
      }
    >
      <ResponsiveContainer width="100%" height={320}>
        <LineChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 24 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis
            dataKey="time"
            tick={{ fontSize: 11, fill: '#64748b' }}
            interval={3}
            label={{
              value: 'Time of day', position: 'insideBottom', offset: -18,
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
            formatter={(v, name) => [`${Number(v).toLocaleString()} kW`, name]}
            contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 13 }}
          />
          <Legend
            verticalAlign="top"
            align="left"
            height={40}
            iconSize={9}
            wrapperStyle={{ fontSize: 11, paddingBottom: 8, lineHeight: '20px' }}
          />
          {data.days.map((d, i) => (
            <Line
              key={d.date}
              type="monotone"
              dataKey={d.label}
              stroke={DAY_COLOURS[i % DAY_COLOURS.length]}
              strokeWidth={1.8}
              dot={false}
              activeDot={{ r: 3 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </Panel>
  );
}
