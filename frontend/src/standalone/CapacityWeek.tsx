import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { slotTime } from '../local/calendar';
import { CHART } from '../local/chartColours';
import { addDays, dayOfWeek, fmtDayMonYear } from '../local/dates';
import { INTERVAL_HOURS, isValid, SLOTS, type Frame } from '../local/frame';
import { ChartCard } from './ChartCard';
import { chartFileName } from './chartDownload';
import { num } from './format';

const DAY = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * One week of half-hour demand in kVA against the agreed capacity, the
 * usable capacity after the safety margin, and any peak target from the
 * savings scenarios. Starts on the week of the highest half hour.
 */
export default function CapacityWeek({ frame, siteName, powerFactor, capacityKva, marginPct, peakDate, capKw }: {
  frame: Frame; siteName: string; powerFactor: number; capacityKva: number | null; marginPct: number;
  /** Date of the highest half hour, to open on that week. */
  peakDate: string;
  /** Target maximum demand from savings scenario D, if one is set. */
  capKw: number | null;
}) {
  const monday = (d: string) => addDays(d, -dayOfWeek(d));
  const [week, setWeek] = useState(() => monday(peakDate || frame.dates[0] || ''));
  const index = useMemo(() => new Map(frame.dates.map((d, i) => [d, i])), [frame]);
  const pf = powerFactor > 0 ? powerFactor : 1;
  const usable = capacityKva ? capacityKva * (1 - marginPct / 100) : null;
  const capKva = capKw ? capKw / pf : null;
  const rows = useMemo(() => {
    const out: { k: number; label: string; kva: number | null }[] = [];
    for (let d = 0; d < 7; d++) {
      const date = addDays(week, d);
      const i = index.get(date);
      for (let s = 0; s < SLOTS; s++) {
        const ok = i !== undefined && isValid(frame, i, s);
        out.push({ k: d * SLOTS + s, label: `${DAY[d]} ${fmtDayMonYear(date)} ${slotTime(s)}`, kva: ok ? frame.rows[i!][s] / INTERVAL_HOURS / pf : null });
      }
    }
    return out;
  }, [week, index, frame, pf]);
  const weekPeak = Math.max(0, ...rows.map((r) => r.kva ?? 0));
  const top = Math.max(weekPeak, capacityKva ?? 0, capKva ?? 0) * 1.08 || 1;
  const over = (v: number | null) => v !== null && ((usable !== null && v > usable) || (capKva !== null && v > capKva));

  return (
    <ChartCard
      title="Peak demand against capacity"
      subtitle={`Week of ${fmtDayMonYear(week)}: highest half hour ${num(weekPeak, 0)} kVA at power factor ${pf}`}
      file={chartFileName(siteName, `capacity-week-${week}`)}
      controls={(
        <div className="flex gap-1">
          <button type="button" className="text-xs border border-slate-300 rounded px-2 py-1 hover:border-[#0065a5]" onClick={() => setWeek(addDays(week, -7))}>← Week</button>
          <button type="button" className="text-xs border border-slate-300 rounded px-2 py-1 hover:border-[#0065a5]" onClick={() => setWeek(monday(peakDate))}>Peak week</button>
          <button type="button" className="text-xs border border-slate-300 rounded px-2 py-1 hover:border-[#0065a5]" onClick={() => setWeek(addDays(week, 7))}>Week →</button>
        </div>
      )}
      footer={(
        <>
          kVA = measured kW ÷ the power factor you entered, an assumption. Orange bars go over {capKva !== null ? 'the peak target or ' : ''}usable capacity.
          {capacityKva === null && ' Enter the agreed supply capacity above to draw the capacity lines.'}
        </>
      )}
    >
      <div style={{ height: 260 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 4 }} barCategoryGap={0}>
            <CartesianGrid vertical={false} stroke={CHART.grid} />
            <XAxis dataKey="k" type="number" domain={[0, 7 * SLOTS - 1]} ticks={Array.from({ length: 7 }, (_, d) => d * SLOTS)} tick={{ fontSize: 11, fill: CHART.axis }}
              tickFormatter={(k: number) => `${DAY[Math.floor(k / SLOTS)]} ${fmtDayMonYear(addDays(week, Math.floor(k / SLOTS))).slice(0, 6)}`} />
            <YAxis domain={[0, top]} tick={{ fontSize: 11, fill: CHART.axis }} unit=" kVA" width={70} tickFormatter={(v: number) => num(v, 0)} />
            <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} labelFormatter={(_k, p) => (p?.[0]?.payload as { label: string } | undefined)?.label ?? ''}
              formatter={(v) => [v === null ? 'no reading' : `${num(Number(v), 1)} kVA`, 'Demand']} />
            {capacityKva !== null && <ReferenceLine y={capacityKva} stroke={CHART.ink} strokeDasharray="6 4" label={{ value: `Agreed ${num(capacityKva, 0)} kVA`, position: 'insideTopRight', fontSize: 11, fill: CHART.ink }} />}
            {usable !== null && <ReferenceLine y={usable} stroke={CHART.ink} strokeDasharray="2 3" label={{ value: `Usable ${num(usable, 0)} kVA`, position: 'insideTopLeft', fontSize: 11, fill: CHART.ink }} />}
            {capKva !== null && <ReferenceLine y={capKva} stroke={CHART.green} strokeDasharray="6 4" label={{ value: `Peak target ${num(capKva, 0)} kVA`, position: 'insideBottomLeft', fontSize: 11, fill: CHART.green }} />}
            <Bar dataKey="kva" isAnimationActive={false}>
              {rows.map((r) => <Cell key={r.k} fill={over(r.kva) ? CHART.orange : CHART.blue} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}
