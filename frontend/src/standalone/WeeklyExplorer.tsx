import { useMemo, useState } from 'react';
import {
  Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, LineChart, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { planDays, slotTime, type Calendar } from '../local/calendar';
import { weeklyTotals } from '../local/chartData';
import { CHART } from '../local/chartColours';
import { addDays, fmtDayMonYear } from '../local/dates';
import { INTERVAL_HOURS, isValid, SLOTS, type Frame } from '../local/frame';
import { ChartCard, Toggle } from './ChartCard';
import { chartFileName } from './chartDownload';
import { kwh, num } from './format';

const DAY = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * A year of weekly totals; click a week to see its half hours, with closed
 * hours shaded, the result of any active savings scenarios, and the unit
 * price in each half hour underneath.
 */
export default function WeeklyExplorer({ frame, calendar, siteName, after, prices }: {
  frame: Frame; calendar: Calendar; siteName: string;
  after: number[][] | null;
  /** £/kWh per half hour, same shape as the frame. */
  prices: ArrayLike<number>[];
}) {
  const [measure, setMeasure] = useState<'kwh' | 'gbp'>('kwh');
  const weeks = useMemo(() => {
    const w = weeklyTotals(frame);
    if (measure === 'kwh') return w.map((x) => ({ ...x, value: x.kwh }));
    const index = new Map(frame.dates.map((d, i) => [d, i]));
    return w.map((x) => {
      let gbp = 0;
      for (let k = 0; k < 7; k++) {
        const i = index.get(addDays(x.start, k));
        if (i === undefined) continue;
        for (let s = 0; s < SLOTS; s++) if (isValid(frame, i, s)) gbp += frame.rows[i][s] * prices[i][s];
      }
      return { ...x, value: gbp };
    });
  }, [frame, prices, measure]);
  // One tick per month: the first week starting in it.
  const monthTicks = weeks.filter((w, k) => k === 0 || w.start.slice(0, 7) !== weeks[k - 1].start.slice(0, 7)).map((w) => w.start);
  const peakWeek = weeks.reduce((a, b) => (b.value > (a?.value ?? -1) ? b : a), weeks[0]);
  const [selected, setSelected] = useState<string | null>(null);
  const week = selected ?? peakWeek?.start ?? null;
  const plans = useMemo(() => planDays(calendar, frame.dates), [calendar, frame]);
  const index = useMemo(() => new Map(frame.dates.map((d, i) => [d, i])), [frame]);

  const detail = useMemo(() => {
    if (!week) return null;
    const rows: { k: number; label: string; kw: number | null; after: number | null; price: number | null; closed: boolean }[] = [];
    for (let d = 0; d < 7; d++) {
      const date = addDays(week, d);
      const i = index.get(date);
      for (let s = 0; s < SLOTS; s++) {
        const ok = i !== undefined && isValid(frame, i, s);
        rows.push({
          k: d * SLOTS + s,
          label: `${DAY[d]} ${fmtDayMonYear(date)} ${slotTime(s)}`,
          kw: ok ? frame.rows[i!][s] / INTERVAL_HOURS : null,
          after: ok && after ? after[i!][s] / INTERVAL_HOURS : null,
          price: i !== undefined ? Math.round(prices[i][s] * 10000) / 100 : null,
          closed: i !== undefined ? !plans[i].open[s] : false,
        });
      }
    }
    const bands: [number, number][] = [];
    let start = -1;
    rows.forEach((r, k) => {
      if (r.closed && start < 0) start = k;
      if ((!r.closed || k === rows.length - 1) && start >= 0) { bands.push([start, r.closed ? k : k - 1]); start = -1; }
    });
    const total = rows.reduce((a, r) => a + (r.kw ?? 0) * INTERVAL_HOURS, 0);
    const totalAfter = after ? rows.reduce((a, r) => a + (r.after ?? 0) * INTERVAL_HOURS, 0) : null;
    const priceVaries = new Set(rows.map((r) => r.price)).size > 1;
    return { rows, bands, total, totalAfter, priceVaries };
  }, [week, index, frame, after, prices, plans]);

  const ticks = Array.from({ length: 7 }, (_, d) => d * SLOTS);
  const fmtV = (v: number) => (measure === 'kwh' ? kwh(v) : `£${num(v, 0)}`);

  return (
    <div className="space-y-4">
      <ChartCard
        title="Week by week"
        subtitle={`${measure === 'kwh' ? 'Electricity' : 'Energy cost at the rates entered'} each week (Monday to Sunday). Click a week to see its half hours.`}
        file={chartFileName(siteName, 'week-by-week')}
        controls={<Toggle value={measure} onChange={setMeasure} options={[['kwh', 'kWh'], ['gbp', '£']] as const} />}
        footer="Paler bars have less than 90% of the week's readings, so they read low. Missing readings are not counted as zero."
      >
        <div style={{ height: 220 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={weeks} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}
              onClick={(e) => { const p = (e as { activePayload?: { payload: { start: string } }[] })?.activePayload?.[0]?.payload; if (p) setSelected(p.start); }}>
              <CartesianGrid vertical={false} stroke={CHART.grid} />
              <XAxis dataKey="start" ticks={monthTicks} interval={0} tick={{ fontSize: 10, fill: CHART.axis }} tickFormatter={(d: string) => fmtDayMonYear(d).slice(3)} />
              <YAxis tick={{ fontSize: 11, fill: CHART.axis }} width={64} tickFormatter={(v: number) => (measure === 'kwh' ? `${num(v, 0)}` : `£${num(v, 0)}`)} />
              <Tooltip cursor={{ fill: '#e6f0f7' }} contentStyle={{ fontSize: 12, borderRadius: 8 }}
                labelFormatter={(d) => `Week of ${fmtDayMonYear(String(d))}`}
                formatter={(v, _n, item) => [`${fmtV(Number(v))} (${Math.round((item.payload as { coverage: number }).coverage * 100)}% of readings)`, measure === 'kwh' ? 'Electricity' : 'Cost']} />
              <Bar dataKey="value" isAnimationActive={false} radius={[3, 3, 0, 0]} style={{ cursor: 'pointer' }}>
                {weeks.map((w) => (
                  <Cell key={w.start} fill={w.start === week ? CHART.green : CHART.blue} fillOpacity={w.coverage < 0.9 ? 0.45 : 1} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>

      {detail && week && (
        <ChartCard
          title={`Week of ${fmtDayMonYear(week)}`}
          subtitle={`Every half hour, ${kwh(detail.total)}${detail.totalAfter !== null ? `, ${kwh(detail.totalAfter)} with active scenarios` : ''}${selected ? '' : ' (highest week shown first)'}`}
          file={chartFileName(siteName, `week-${week}`)}
          controls={(
            <div className="flex gap-1">
              <button type="button" className="text-xs border border-slate-300 rounded px-2 py-1 hover:border-[#0065a5]" onClick={() => setSelected(addDays(week, -7))}>← Week</button>
              <button type="button" className="text-xs border border-slate-300 rounded px-2 py-1 hover:border-[#0065a5]" onClick={() => setSelected(addDays(week, 7))}>Week →</button>
            </div>
          )}
          footer={<>Shaded: closed under the calendar. Bars are half-hour averages in kW.{after ? ' Green line: the same half hours with the active savings scenarios.' : ''}</>}
        >
          <div style={{ height: 260 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={detail.rows} margin={{ top: 8, right: 8, left: 0, bottom: 4 }} barCategoryGap={0}>
                {detail.bands.map(([a, b]) => <ReferenceArea key={a} x1={a} x2={b} fill={CHART.band} fillOpacity={1} strokeOpacity={0} ifOverflow="hidden" />)}
                <CartesianGrid vertical={false} stroke={CHART.grid} />
                <XAxis dataKey="k" type="number" domain={[0, 7 * SLOTS - 1]} ticks={ticks} tick={{ fontSize: 11, fill: CHART.axis }}
                  tickFormatter={(k: number) => `${DAY[Math.floor(k / SLOTS)]} ${fmtDayMonYear(addDays(week, Math.floor(k / SLOTS))).slice(0, 6)}`} />
                <YAxis tick={{ fontSize: 11, fill: CHART.axis }} unit=" kW" width={60} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} labelFormatter={(_k, p) => (p?.[0]?.payload as { label: string } | undefined)?.label ?? ''}
                  formatter={(v, n) => [v === null ? 'no reading' : `${num(Number(v), 1)} kW`, n]} />
                <Bar dataKey="kw" name="Measured" fill={CHART.blue} isAnimationActive={false} />
                {after && <Line dataKey="after" name="With scenarios" stroke={CHART.green} strokeWidth={1.5} dot={false} isAnimationActive={false} />}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          {detail.priceVaries && (
            <>
              <p className="text-xs font-semibold text-slate-600 mt-3">Unit rate in each half hour (p/kWh)</p>
              <div style={{ height: 90 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={detail.rows} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke={CHART.grid} />
                    <XAxis dataKey="k" type="number" domain={[0, 7 * SLOTS - 1]} ticks={ticks} hide />
                    <YAxis tick={{ fontSize: 10, fill: CHART.axis }} unit="p" width={60} />
                    <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} labelFormatter={(_k, p) => (p?.[0]?.payload as { label: string } | undefined)?.label ?? ''}
                      formatter={(v) => [`${num(Number(v), 2)}p/kWh`, 'Rate']} />
                    <Line dataKey="price" type="stepAfter" stroke={CHART.ink} strokeWidth={1.5} dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </ChartCard>
      )}
    </div>
  );
}
