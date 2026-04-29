import { useState, useMemo } from 'react';
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
import type { HHPoint, DailyPoint, MonthlyTotal } from '../types';

type Granularity = 'halfhourly' | 'hourly' | 'daily' | 'weekly' | 'monthly';

interface Props {
  hhSeries: HHPoint[];
  dailySeries: DailyPoint[];
  monthlyTotals: MonthlyTotal[];
}

interface ChartPoint {
  x: string;
  kwh: number;
  tickLabel?: string;
}

const GRANULARITIES: { key: Granularity; label: string }[] = [
  { key: 'halfhourly', label: 'Half-hourly' },
  { key: 'hourly',     label: 'Hourly' },
  { key: 'daily',      label: 'Daily' },
  { key: 'weekly',     label: 'Weekly' },
  { key: 'monthly',    label: 'Monthly' },
];

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function monthAbbr(yyyyMM: string): string {
  return MONTH_ABBR[parseInt(yyyyMM.slice(5, 7), 10) - 1] ?? '';
}

function isoWeekKey(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00Z');
  const thu = new Date(d);
  thu.setUTCDate(d.getUTCDate() + (4 - (d.getUTCDay() || 7)));
  const jan1 = new Date(Date.UTC(thu.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((thu.getTime() - jan1.getTime()) / 86400000 + 1) / 7);
  return `${thu.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function buildChartData(
  granularity: Granularity,
  hhSeries: HHPoint[],
  dailySeries: DailyPoint[],
  monthlyTotals: MonthlyTotal[],
): ChartPoint[] {
  switch (granularity) {
    case 'halfhourly':
      return hhSeries.map((p) => ({
        x: p.datetime,
        kwh: p.kwh,
        tickLabel: p.datetime.endsWith('T00:00') ? monthAbbr(p.datetime) : undefined,
      }));

    case 'hourly': {
      const map = new Map<string, number>();
      for (const p of hhSeries) {
        const key = p.datetime.slice(0, 13); // "YYYY-MM-DDTHH"
        map.set(key, (map.get(key) ?? 0) + p.kwh);
      }
      return Array.from(map.entries()).map(([x, kwh]) => ({
        x,
        kwh: Math.round(kwh * 1000) / 1000,
        tickLabel: x.endsWith('T00') ? monthAbbr(x) : undefined,
      }));
    }

    case 'daily':
      return dailySeries.map((p) => ({
        x: p.date,
        kwh: p.kwh,
        tickLabel: p.date.endsWith('-01') ? monthAbbr(p.date) : undefined,
      }));

    case 'weekly': {
      // Group daily points by ISO week; keep the Monday date for labelling
      const map = new Map<string, { kwh: number; date: string }>();
      for (const p of dailySeries) {
        const wk = isoWeekKey(p.date);
        const entry = map.get(wk);
        if (!entry) {
          map.set(wk, { kwh: p.kwh, date: p.date });
        } else {
          entry.kwh += p.kwh;
        }
      }
      const sorted = Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
      // Show month label when this week is the first to touch a new month
      let lastMonth = '';
      return sorted.map(([x, v]) => {
        const mo = v.date.slice(0, 7);
        const label = mo !== lastMonth ? monthAbbr(mo) : undefined;
        if (label) lastMonth = mo;
        return { x, kwh: Math.round(v.kwh * 10) / 10, tickLabel: label };
      });
    }

    case 'monthly':
      return monthlyTotals.map((p) => ({
        x: p.month,
        kwh: p.kwh,
        tickLabel: monthAbbr(p.month),
      }));
  }
}

const Y_LABELS: Record<Granularity, string> = {
  halfhourly: 'kWh / hh',
  hourly:     'kWh / hr',
  daily:      'kWh / day',
  weekly:     'kWh / wk',
  monthly:    'kWh / mo',
};

function formatTooltipLabel(x: string, granularity: Granularity): string {
  switch (granularity) {
    case 'halfhourly': return x.replace('T', '  ');
    case 'hourly':     return x.replace('T', '  ') + ':00';
    case 'daily':      return x;
    case 'weekly': {
      const [yr, wk] = x.split('-W');
      return `Week ${parseInt(wk, 10)}, ${yr}`;
    }
    case 'monthly': {
      const [yr, mo] = x.split('-');
      return `${MONTH_ABBR[parseInt(mo, 10) - 1]} ${yr}`;
    }
  }
}

export default function DailyLineChart({ hhSeries, dailySeries, monthlyTotals }: Props) {
  const [granularity, setGranularity] = useState<Granularity>('daily');

  const chartData = useMemo(
    () => buildChartData(granularity, hhSeries, dailySeries, monthlyTotals),
    [granularity, hhSeries, dailySeries, monthlyTotals],
  );

  const xTicks = useMemo(
    () => chartData.filter((p) => p.tickLabel).map((p) => p.x),
    [chartData],
  );

  const labelMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const p of chartData) {
      if (p.tickLabel) m[p.x] = p.tickLabel;
    }
    return m;
  }, [chartData]);

  const peak = chartData.length ? Math.max(...chartData.map((p) => p.kwh)) : 0;
  const avg  = chartData.length ? chartData.reduce((s, p) => s + p.kwh, 0) / chartData.length : 0;

  const countLabel = {
    halfhourly: `${chartData.length.toLocaleString()} readings`,
    hourly:     `${chartData.length.toLocaleString()} hours`,
    daily:      `${chartData.length} days`,
    weekly:     `${chartData.length} weeks`,
    monthly:    `${chartData.length} months`,
  }[granularity];

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
      {/* Header row */}
      <div className="flex flex-wrap justify-between items-start gap-3 mb-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">Consumption Trend</h2>
          <p className="text-sm text-slate-500">{countLabel} shown</p>
        </div>
        <div className="flex gap-4 text-right">
          <div>
            <p className="text-lg font-bold text-slate-700">
              {peak.toLocaleString(undefined, { maximumFractionDigits: peak < 10 ? 2 : 0 })} kWh
            </p>
            <p className="text-xs text-slate-400">Peak</p>
          </div>
          <div>
            <p className="text-lg font-bold text-emerald-600">
              {avg.toLocaleString(undefined, { maximumFractionDigits: avg < 10 ? 2 : 0 })} kWh
            </p>
            <p className="text-xs text-slate-400">Average</p>
          </div>
        </div>
      </div>

      {/* Granularity toggle */}
      <div className="flex flex-wrap gap-1 mb-4">
        {GRANULARITIES.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setGranularity(key)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              granularity === key
                ? 'bg-emerald-600 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />

          {/* Average reference line */}
          <ReferenceLine
            y={avg}
            stroke="#10b981"
            strokeDasharray="4 2"
            strokeWidth={1.5}
            label={{ value: 'Avg', position: 'right', fill: '#10b981', fontSize: 11 }}
          />

          <XAxis
            dataKey="x"
            ticks={xTicks}
            tickFormatter={(v) => labelMap[v] ?? ''}
            tick={{ fontSize: 12, fill: '#64748b' }}
            height={24}
          />
          <YAxis
            tick={{ fontSize: 12, fill: '#64748b' }}
            label={{
              value: Y_LABELS[granularity],
              angle: -90,
              position: 'insideLeft',
              offset: 10,
              style: { fontSize: 12, fill: '#94a3b8' },
            }}
            width={52}
          />
          <Tooltip
            labelFormatter={(label) => formatTooltipLabel(String(label), granularity)}
            formatter={(value) => [`${(value as number).toFixed(granularity === 'halfhourly' || granularity === 'hourly' ? 3 : 1)} kWh`, 'Usage']}
            contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 13 }}
          />
          <Line
            type="monotone"
            dataKey="kwh"
            stroke="#3b82f6"
            strokeWidth={1.5}
            dot={false}
            activeDot={{ r: 3, fill: '#3b82f6' }}
            isAnimationActive={chartData.length < 1000}
          />
        </LineChart>
      </ResponsiveContainer>

      <p className="text-xs text-slate-400 mt-1 text-center">
        Green dashed line = average · Switch granularity using the buttons above
      </p>
    </div>
  );
}
