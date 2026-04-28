import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import type { MonthlyTotal } from '../types';

interface Props {
  data: MonthlyTotal[];
  annualKwh: number;
}

const MONTH_ABBR: Record<string, string> = {
  '01': 'Jan', '02': 'Feb', '03': 'Mar', '04': 'Apr',
  '05': 'May', '06': 'Jun', '07': 'Jul', '08': 'Aug',
  '09': 'Sep', '10': 'Oct', '11': 'Nov', '12': 'Dec',
};

export default function MonthlyBarChart({ data, annualKwh }: Props) {
  const chartData = data.map((d) => ({
    month: MONTH_ABBR[d.month.slice(5)] ?? d.month,
    kwh: d.kwh,
  }));

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
      <div className="flex justify-between items-start mb-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">Monthly Usage Profile</h2>
          <p className="text-sm text-slate-500">Half-hourly consumption aggregated by month</p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold text-emerald-600">{annualKwh.toLocaleString()} kWh</p>
          <p className="text-xs text-slate-400">Annual total</p>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis dataKey="month" tick={{ fontSize: 13, fill: '#64748b' }} />
          <YAxis
            tick={{ fontSize: 12, fill: '#64748b' }}
            tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
            label={{ value: 'kWh', angle: -90, position: 'insideLeft', offset: 10, style: { fontSize: 12, fill: '#94a3b8' } }}
          />
          <Tooltip
            formatter={(value: number) => [`${value.toLocaleString()} kWh`, 'Consumption']}
            contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 13 }}
          />
          <Bar dataKey="kwh" fill="#10b981" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
