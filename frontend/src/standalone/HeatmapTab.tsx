import { useMemo, useState } from 'react';
import {
  CartesianGrid, ComposedChart, Legend, Line, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { addDays, dayOfWeek, fmtDayMonYear, fmtDowDayMon } from '../local/dates';
import { cellKind, EXCLUDED_CSS, MISSING_CSS, rampColor, RAMP_CSS, scaleMax } from '../local/carpet';
import { dayKwh, dayValid, FLAG_TEXT, flagAt, INTERVAL_HOURS } from '../local/frame';
import { DAY_CLASS_LABEL, planDay, planDays, slotTime } from '../local/calendar';
import { comparePeriods, dayKeyLabel, referenceProfile } from '../local/findings';
import type { SiteSummary } from '../local/localClient';
import CarpetPlot from './CarpetPlot';
import { Card, Note } from './ui';
import { kw, kwh, num, pct, smallInput } from './format';

const DAYS_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** One week as a grid: days as rows, half hours as columns, on the same colour scale as the whole period. */
function WeekGrid({ site, weekStart, onPick, selected }: { site: SiteSummary; weekStart: string; onPick: (d: string) => void; selected: string }) {
  const f = site.frame;
  const max = useMemo(() => scaleMax(f), [f]);
  const index = useMemo(() => new Map(f.dates.map((d, i) => [d, i])), [f]);
  const [tip, setTip] = useState<string | null>(null);
  const days = Array.from({ length: 7 }, (_, k) => addDays(weekStart, k));
  return (
    <div>
      <div className="overflow-x-auto">
        <div className="min-w-[640px]">
          <div className="grid" style={{ gridTemplateColumns: '5.5rem repeat(48, minmax(0, 1fr))' }}>
            <span />
            {Array.from({ length: 48 }, (_, s) => (
              <span key={s} className="text-[9px] text-slate-400 text-center">{s % 6 === 0 ? slotTime(s) : ''}</span>
            ))}
            {days.map((d) => {
              const i = index.get(d) ?? -1;
              const plan = planDay(site.settings.calendar, d);
              return [
                <button key={`${d}-l`} onClick={() => onPick(d)} className={`text-xs text-left pr-1 truncate ${d === selected ? 'font-bold text-[#0065a5]' : 'text-slate-600 hover:text-[#0065a5]'}`}>
                  {fmtDowDayMon(d)}
                </button>,
                ...Array.from({ length: 48 }, (_, s) => {
                  const k = cellKind(f, i, s);
                  const v = i >= 0 ? f.rows[i][s] : 0;
                  const bg = k === 'value' ? `rgb(${rampColor(v / INTERVAL_HOURS / max).join(',')})`
                    : k === 'missing' ? MISSING_CSS : k === 'excluded' ? EXCLUDED_CSS : '#fff';
                  const open = plan.open[s];
                  const edgeL = open && (s === 0 || !plan.open[s - 1]);
                  const edgeR = open && (s === 47 || !plan.open[s + 1]);
                  const text = `${fmtDayMonYear(d)} ${slotTime(s)}: ${k === 'value' ? `${num(v, 2)} kWh, ${num(v / INTERVAL_HOURS, 1)} kW` : i < 0 ? 'day missing' : FLAG_TEXT[flagAt(f, i, s)]}`
                    + ` · ${open ? 'open' : 'closed'}${site.quality.suspectDays.get(d) ? ` · data question: ${site.quality.suspectDays.get(d)!.join('; ')}` : ''}`;
                  return (
                    <button
                      key={`${d}-${s}`}
                      onClick={() => onPick(d)}
                      onMouseEnter={() => setTip(text)}
                      onFocus={() => setTip(text)}
                      title={text}
                      aria-label={text}
                      className="h-6"
                      style={{
                        background: bg,
                        borderTop: open ? '2px solid #b45309' : '2px solid transparent',
                        borderBottom: open ? '2px solid #b45309' : '2px solid transparent',
                        borderLeft: edgeL ? '2px solid #b45309' : undefined,
                        borderRight: edgeR ? '2px solid #b45309' : undefined,
                      }}
                    />
                  );
                }),
              ];
            })}
          </div>
        </div>
      </div>
      <p className="text-xs text-slate-600 mt-2 min-h-4">{tip ?? 'Hover or tab to a half hour for its reading; click to inspect the day.'}</p>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 mt-1 text-xs text-slate-500">
        <span className="flex items-center gap-2">0 kW <span className="h-2.5 w-32 rounded-sm border border-slate-200" style={{ background: RAMP_CSS }} /> {num(max, 1)} kW (same scale as above)</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-4 border" style={{ background: MISSING_CSS }} /> no valid reading</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-4 border" style={{ background: EXCLUDED_CSS }} /> excluded or held back</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-4 border-2 border-[#b45309]" /> opening hours</span>
      </div>
    </div>
  );
}

/** One day against its reference: the median of the previous comparable days. */
function DayInspector({ site, date, onPick }: { site: SiteSummary; date: string; onPick: (d: string) => void }) {
  const f = site.frame;
  const i = f.dates.indexOf(date);
  const plans = useMemo(() => planDays(site.settings.calendar, f.dates), [site.settings.calendar, f.dates]);
  const plan = planDay(site.settings.calendar, date);
  const ref = useMemo(() => (i >= 0 ? referenceProfile(f, plans, i, site.quality.suspectDays, site.settings.detection.baselineDays) : null),
    [f, plans, i, site.quality.suspectDays, site.settings.detection.baselineDays]);
  if (i < 0) return <Note>{fmtDayMonYear(date)} is not in the file: no readings for this day.</Note>;
  const data = Array.from({ length: 48 }, (_, s) => ({
    t: slotTime(s),
    recorded: cellKind(f, i, s) === 'value' ? f.rows[i][s] / INTERVAL_HOURS : null,
    reference: ref?.kw[s] ?? null,
  }));
  const blocks: [number, number][] = [];
  plan.open.forEach((o, s) => {
    if (!o) return;
    const last = blocks[blocks.length - 1];
    if (last && last[1] === s) last[1] = s + 1; else blocks.push([s, s + 1]);
  });
  const actual = dayKwh(f, i);
  const refTotal = ref ? ref.kw.reduce<number>((a, v) => a + (v ?? 0) * INTERVAL_HOURS, 0) : 0;
  const quality = site.quality.suspectDays.get(date);
  const anomaly = site.metrics.anomalies.events.find((e) => e.date === date);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-semibold text-slate-800">{fmtDayMonYear(date)} <span className="font-normal text-slate-500">· {dayKeyLabel(plans[i])} · {DAY_CLASS_LABEL[plan.cls]}{plan.label ? ` (${plan.label})` : ''}</span></p>
          <p className="text-xs text-slate-500">
            {num(dayValid(f, i))} valid readings · {kwh(actual)} recorded
            {ref && ref.samples ? ` · reference ${kwh(refTotal)} (${refTotal ? pct(actual / refTotal - 1, 0).replace(/^(?!-)/, '+') : 'n/a'})` : ''}
          </p>
        </div>
        <div className="flex gap-2">
          <button className="text-xs border border-slate-300 rounded px-2 py-1 hover:border-[#0065a5]" onClick={() => onPick(addDays(date, -1))}>← Previous day</button>
          <button className="text-xs border border-slate-300 rounded px-2 py-1 hover:border-[#0065a5]" onClick={() => onPick(addDays(date, 1))}>Next day →</button>
        </div>
      </div>
      {quality && <Note tone="warn">Data question on this day: {quality.join('; ')}. It is not used as anyone else's reference until reviewed.</Note>}
      {anomaly && <Note tone="warn">Unusual {anomaly.direction} day: {kwh(anomaly.actualKwh)} against {kwh(anomaly.expectedKwh)} expected ({pct(anomaly.deviation)}).</Note>}
      <div style={{ height: 280 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
            <CartesianGrid vertical={false} stroke="#f1f5f9" />
            {blocks.map(([a, b]) => (
              <ReferenceArea key={a} x1={slotTime(a)} x2={slotTime(Math.min(47, b - 1))} fill="#fde7c7" fillOpacity={0.6} ifOverflow="extendDomain" />
            ))}
            <XAxis dataKey="t" tick={{ fontSize: 10, fill: '#64748b' }} interval={5} />
            <YAxis tick={{ fontSize: 11, fill: '#64748b' }} unit=" kW" width={56} />
            <Tooltip formatter={(v, n) => [v === null ? 'missing' : `${Number(v).toFixed(1)} kW`, n]} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
            <Legend wrapperStyle={{ fontSize: 11 }} iconSize={10} />
            <Line dataKey="reference" name={`Reference (median of ${ref?.samples ?? 0} comparable days)`} stroke="#94a3b8" strokeDasharray="4 3" dot={false} isAnimationActive={false} connectNulls={false} />
            <Line dataKey="recorded" name="Recorded" stroke="#0065a5" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p className="text-xs text-slate-500">
        Shaded: opening hours under the calendar. Reference: median kW in each half hour across the previous {ref?.samples ?? 0} comparable days
        (same weekday and calendar class, complete, no data question){ref?.from ? `, ${fmtDayMonYear(ref.from)} to ${fmtDayMonYear(ref.to!)}` : ''}.
        {ref && ref.samples < site.settings.detection.minDays && ' Fewer comparable days than the minimum, so treat the reference with care.'}
      </p>
    </div>
  );
}

/** A chosen range against the previous equal period and the same weeks a year earlier, on matched days only. */
function PeriodCompare({ site }: { site: SiteSummary }) {
  const last = site.frame.dates[site.frame.dates.length - 1] ?? '';
  const [from, setFrom] = useState(last ? addDays(last, -27) : '');
  const [to, setTo] = useState(last);
  const comps = useMemo(() => (from && to && from <= to ? comparePeriods(site.frame, from, to) : []), [site.frame, from, to]);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3 text-sm">
        <label>From <input type="date" className={smallInput} value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label>To <input type="date" className={smallInput} value={to} onChange={(e) => setTo(e.target.value)} /></label>
      </div>
      <table className="w-full text-sm">
        <thead><tr className="text-left text-xs text-slate-500"><th className="py-1 font-medium">Compared with</th><th className="font-medium">Period</th><th className="text-right font-medium">Coverage then / now</th><th className="text-right font-medium">Matched days</th><th className="text-right font-medium">kWh now vs then</th><th className="text-right font-medium">Change</th></tr></thead>
        <tbody>
          {comps.map((c) => (
            <tr key={c.label} className="border-t border-slate-100 align-top">
              <td className="py-1.5 pr-2">{c.label}</td>
              <td className="pr-2 whitespace-nowrap">{fmtDayMonYear(c.other.from)} to {fmtDayMonYear(c.other.to)}</td>
              <td className="text-right tabular-nums">{pct(c.other.coverage)} / {pct(c.current.coverage)}</td>
              <td className="text-right tabular-nums">{c.matchedDays} of {c.current.daysInRange}</td>
              <td className="text-right tabular-nums">{c.matchedDays ? `${kwh(c.matchedNowKwh)} vs ${kwh(c.matchedThenKwh)}` : '-'}</td>
              <td className="text-right tabular-nums font-semibold">{c.change === null ? 'n/a' : `${c.change >= 0 ? '+' : ''}${pct(c.change, 1)}`}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {comps.map((c) => <p key={c.label} className="text-xs text-slate-500">{c.label}: {c.note}</p>)}
      <p className="text-xs text-slate-400">Only days with complete readings in both periods are compared. Changes in measured demand; not weather-normalised.</p>
    </div>
  );
}

export default function HeatmapTab({ site, date, onDate }: { site: SiteSummary; date: string | null; onDate: (d: string) => void }) {
  const f = site.frame;
  const selected = date ?? f.dates[f.dates.length - 1] ?? '';
  const weekStart = selected ? addDays(selected, -dayOfWeek(selected)) : '';
  return (
    <div className="space-y-4">
      <CarpetPlot frame={f} calendar={site.settings.calendar} onPick={onDate} suspect={site.quality.suspectDays} />
      <Card
        title={`Week of ${weekStart ? fmtDayMonYear(weekStart) : ''}`}
        subtitle="Days as rows, half hours as columns, with opening hours outlined."
        action={(
          <div className="flex gap-2">
            <button className="text-xs border border-slate-300 rounded px-2 py-1 hover:border-[#0065a5]" onClick={() => onDate(addDays(weekStart, -7))}>← Week</button>
            <input type="date" className={smallInput} value={selected} min={f.dates[0]} max={f.dates[f.dates.length - 1]} onChange={(e) => e.target.value && onDate(e.target.value)} />
            <button className="text-xs border border-slate-300 rounded px-2 py-1 hover:border-[#0065a5]" onClick={() => onDate(addDays(weekStart, 7))}>Week →</button>
          </div>
        )}
      >
        {weekStart && <WeekGrid site={site} weekStart={weekStart} onPick={onDate} selected={selected} />}
      </Card>
      <Card title="Day inspector" subtitle={`Recorded demand for one day against its reference profile and opening hours. ${DAYS_SHORT.length ? '' : ''}`}>
        {selected ? <DayInspector site={site} date={selected} onPick={onDate} /> : null}
      </Card>
      <Card title="Compare periods" subtitle="A date range against the previous period of the same length and the same weeks a year earlier.">
        <PeriodCompare site={site} />
      </Card>
      <p className="text-xs text-slate-400">Peaks shown are half-hour averages (kW = kWh / 0.5 h), not instantaneous maxima. {kw(site.metrics.peak.kw)} was the highest.</p>
    </div>
  );
}
