import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from 'recharts';
import type { DayNightResponse } from '../../types';
import Panel from './Panel';

interface Props {
  data: DayNightResponse;
  nightEndSlot: number;
  onNightEndChange: (slot: number) => void;
}

// Common UK night-rate windows. All start at midnight, which is the
// contiguous reading; a supplier-specific window can be added if needed.
const NIGHT_OPTIONS = [
  { label: '00:00–06:00', slot: 12 },
  { label: '00:00–07:00', slot: 14 },
  { label: '00:00–07:30', slot: 15 },
  { label: '00:00–08:00', slot: 16 },
];

export default function DayNightChart({ data, nightEndSlot, onNightEndChange }: Props) {
  const complete = data.months.filter((m) => m.complete);
  const partial = data.months.length - complete.length;

  return (
    <Panel
      title="Day and night consumption by month"
      subtitle={`Night is ${data.night_window}. ${(data.totals.night_share * 100).toFixed(0)}% of the year's kWh falls in the night window.`}
      action={
        <select
          value={nightEndSlot}
          onChange={(e) => onNightEndChange(Number(e.target.value))}
          className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
        >
          {NIGHT_OPTIONS.map((o) => (
            <option key={o.slot} value={o.slot}>Night: {o.label}</option>
          ))}
        </select>
      }
    >
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data.months} margin={{ top: 4, right: 12, left: 0, bottom: 16 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis
            dataKey="month"
            tick={{ fontSize: 11, fill: '#64748b' }}
            angle={-35}
            textAnchor="end"
            height={56}
          />
          <YAxis
            tick={{ fontSize: 11, fill: '#64748b' }}
            tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v))}
            label={{
              value: 'kWh', angle: -90, position: 'insideLeft',
              style: { fontSize: 12, fill: '#94a3b8' },
            }}
          />
          <Tooltip
            formatter={(v, name) => [`${Number(v).toLocaleString()} kWh`, name]}
            labelFormatter={(l) => {
              const m = data.months.find((x) => x.month === l);
              return m && !m.complete ? `${l} (only ${m.days} days)` : String(l);
            }}
            contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 13 }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="day_kwh" name="Day" stackId="a" fill="#f59e0b" />
          <Bar dataKey="night_kwh" name="Night" stackId="a" fill="#1e293b" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>

      {partial > 0 && (
        <p className="text-xs text-slate-400 mt-2">
          {partial} month{partial > 1 ? 's are' : ' is'} partial — the upload
          starts or ends mid-month, so those bars are short by design.
        </p>
      )}
      <p className="text-xs text-slate-500 mt-2">
        A high night share on a site that is closed overnight usually means
        plant left running. Worth checking before sizing anything.
      </p>
    </Panel>
  );
}
