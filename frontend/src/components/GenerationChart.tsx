import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import type { MonthlySolarPoint } from '../types';

interface Props {
  data: MonthlySolarPoint[];
  systemKwp: number;
}

export default function GenerationChart({ data, systemKwp }: Props) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-slate-800">Generation vs Consumption</h2>
        <p className="text-sm text-slate-500">{systemKwp} kWp system — monthly breakdown</p>
      </div>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis dataKey="month" tick={{ fontSize: 13, fill: '#64748b' }} />
          <YAxis
            tick={{ fontSize: 12, fill: '#64748b' }}
            tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
            label={{ value: 'kWh', angle: -90, position: 'insideLeft', offset: 10, style: { fontSize: 12, fill: '#94a3b8' } }}
          />
          <Tooltip
            formatter={(value: number, name: string) => [
              `${value.toLocaleString()} kWh`,
              name === 'consumption_kwh' ? 'Consumption'
                : name === 'self_consumed_kwh' ? 'Self-consumed'
                : 'Exported',
            ]}
            contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 13 }}
          />
          <Legend
            formatter={(value) =>
              value === 'consumption_kwh' ? 'Consumption'
                : value === 'self_consumed_kwh' ? 'Self-consumed'
                : 'Exported'
            }
          />
          <Bar dataKey="consumption_kwh" fill="#94a3b8" radius={[4, 4, 0, 0]} name="consumption_kwh" />
          <Bar dataKey="self_consumed_kwh" fill="#10b981" radius={[4, 4, 0, 0]} name="self_consumed_kwh" />
          <Bar dataKey="exported_kwh" fill="#f59e0b" radius={[4, 4, 0, 0]} name="exported_kwh" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
