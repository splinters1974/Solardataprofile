import { useState } from 'react';
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from 'recharts';
import type { ScatterResponse } from '../../types';
import Panel from './Panel';

const GROUPS = [
  { type: 'Weekday', colour: '#0f766e' },
  { type: 'Weekend', colour: '#f59e0b' },
  { type: 'Bank holiday', colour: '#db2777' },
];

interface Props {
  data: ScatterResponse;
}

export default function LoadScatterChart({ data }: Props) {
  const [hidden, setHidden] = useState<string[]>([]);

  return (
    <Panel
      title="Every half-hourly reading"
      subtitle="Load against time of day for the whole period. The spread around the average is what a line chart hides: a tight band means a predictable site, a wide one means the average is not much use on its own."
    >
      <div className="flex flex-wrap gap-1.5 mb-4">
        {GROUPS.map((g) => {
          const on = !hidden.includes(g.type);
          return (
            <button
              key={g.type}
              onClick={() =>
                setHidden((h) =>
                  h.includes(g.type) ? h.filter((t) => t !== g.type) : [...h, g.type],
                )
              }
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                on ? 'text-white border-transparent' : 'bg-white text-slate-500 border-slate-300'
              }`}
              style={on ? { backgroundColor: g.colour } : undefined}
            >
              {g.type}
            </button>
          );
        })}
      </div>

      <ResponsiveContainer width="100%" height={360}>
        <ScatterChart margin={{ top: 8, right: 12, left: 0, bottom: 28 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis
            type="number" dataKey="hour" domain={[0, 24]}
            ticks={[0, 3, 6, 9, 12, 15, 18, 21, 24]}
            tickFormatter={(v) => `${String(v).padStart(2, '0')}:00`}
            tick={{ fontSize: 11, fill: '#64748b' }}
            label={{
              value: 'Time of day', position: 'insideBottom', offset: -20,
              style: { fontSize: 12, fill: '#94a3b8' },
            }}
          />
          <YAxis
            type="number" dataKey="kw"
            tick={{ fontSize: 11, fill: '#64748b' }}
            label={{
              value: 'kW', angle: -90, position: 'insideLeft',
              style: { fontSize: 12, fill: '#94a3b8' },
            }}
          />
          <Tooltip
            cursor={{ strokeDasharray: '3 3' }}
            contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 13 }}
            formatter={(v, name) =>
              name === 'kw' ? [`${Number(v).toLocaleString()} kW`, 'Load'] : [v, name]
            }
            labelFormatter={() => ''}
          />
          <Legend
            verticalAlign="top"
            align="left"
            height={28}
            iconSize={10}
            wrapperStyle={{ fontSize: 12, paddingBottom: 6 }}
          />
          {GROUPS.filter((g) => !hidden.includes(g.type)).map((g) => (
            <Scatter
              key={g.type}
              name={g.type}
              data={data.points.filter((p) => p.type === g.type)}
              fill={g.colour}
              fillOpacity={0.28}
              shape="circle"
            />
          ))}
        </ScatterChart>
      </ResponsiveContainer>

      {data.sampled && (
        <p className="text-xs text-slate-400 mt-2">
          Showing {data.points.length.toLocaleString()} of{' '}
          {data.total_readings.toLocaleString()} readings, evenly sampled so the
          chart stays responsive. The shape is the same; individual outliers may not be shown.
        </p>
      )}
    </Panel>
  );
}
