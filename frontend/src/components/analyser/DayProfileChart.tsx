import { useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from 'recharts';
import type { DayProfileResponse } from '../../types';
import Panel from './Panel';

// Weekdays share a warm ramp so the working week reads as one family;
// weekend and summary lines sit outside it deliberately.
const COLOURS: Record<string, string> = {
  Monday: '#0f766e', Tuesday: '#0d9488', Wednesday: '#14b8a6',
  Thursday: '#2dd4bf', Friday: '#5eead4',
  Saturday: '#f59e0b', Sunday: '#ef4444',
  Weekday: '#1e293b', Weekend: '#7c3aed', 'Bank holiday': '#db2777',
  Total: '#64748b',
};

const DEFAULT_ON = ['Weekday', 'Weekend'];

interface Props {
  data: DayProfileResponse;
}

export default function DayProfileChart({ data }: Props) {
  const [visible, setVisible] = useState<string[]>(DEFAULT_ON);

  const rows = data.labels.map((label, i) => {
    const row: Record<string, string | number> = { time: label };
    for (const s of data.series) row[s.name] = s.values[i];
    return row;
  });

  function toggle(name: string) {
    setVisible((v) =>
      v.includes(name) ? v.filter((n) => n !== name) : [...v, name],
    );
  }

  return (
    <Panel
      title="Average demand by day of week"
      subtitle="Mean kW in each half hour. Toggle any series on or off."
    >
      <div className="flex flex-wrap gap-1.5 mb-4">
        {data.series.map((s) => {
          const on = visible.includes(s.name);
          const count = data.day_counts[s.name];
          return (
            <button
              key={s.name}
              onClick={() => toggle(s.name)}
              title={count ? `${count} days` : undefined}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                on
                  ? 'text-white border-transparent'
                  : 'bg-white text-slate-500 border-slate-300 hover:border-slate-400'
              }`}
              style={on ? { backgroundColor: COLOURS[s.name] ?? '#334155' } : undefined}
            >
              {s.name}
              {count ? <span className="opacity-70"> · {count}</span> : null}
            </button>
          );
        })}
      </div>

      <ResponsiveContainer width="100%" height={320}>
        <LineChart data={rows} margin={{ top: 4, right: 12, left: 0, bottom: 16 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis
            dataKey="time"
            tick={{ fontSize: 11, fill: '#64748b' }}
            interval={3}
            label={{
              value: 'Time of day', position: 'insideBottom', offset: -12,
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
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {data.series
            .filter((s) => visible.includes(s.name))
            .map((s) => (
              <Line
                key={s.name}
                type="monotone"
                dataKey={s.name}
                stroke={COLOURS[s.name] ?? '#334155'}
                strokeWidth={s.group === 'summary' ? 2.5 : 1.5}
                dot={false}
                activeDot={{ r: 3 }}
              />
            ))}
        </LineChart>
      </ResponsiveContainer>
    </Panel>
  );
}
