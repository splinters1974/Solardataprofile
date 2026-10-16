import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { beforeAfter, type BeforeAfterSide, type ExcessResult } from '../local/findings';
import { planDays } from '../local/calendar';
import { fmtDayMonYear } from '../local/dates';
import type { SiteSettings } from '../local/site';
import type { SiteSummary } from '../local/localClient';
import { Card, Kind, Note, Tile } from './ui';
import { gbp, kw, kwh, num, pct, smallInput } from './format';

function ExcessRow({ e, chosen }: { e: ExcessResult | null; chosen: boolean }) {
  if (!e) return null;
  return (
    <tr className={`border-t border-slate-100 ${chosen ? 'bg-blue-50/50' : ''}`}>
      <td className="py-2 pr-3">{e.label}{chosen && <span className="ml-2 text-[10px] font-semibold text-[#0065a5]">IN USE</span>}</td>
      <td className="pr-3 text-right tabular-nums">{kw(e.refKw)}</td>
      <td className="pr-3 text-right tabular-nums">{kwh(e.observed.kwh)}</td>
      <td className="pr-3 text-right tabular-nums">{gbp(e.observed.cost)}</td>
      <td className="text-right tabular-nums">{e.annual ? gbp(e.annual.cost) : 'not annualised'}</td>
    </tr>
  );
}

type BA = ReturnType<typeof beforeAfter>;

/** The before/after table plus a plain-English verdict and what the change is worth if it holds. */
function BeforeAfterResult({ ba, rateGbp, hasClosed }: { ba: BA; rateGbp: number; hasClosed: boolean }) {
  const { before: b, after: a } = ba;
  const enough = (x: BeforeAfterSide) => x.completeDays >= 7;
  if (!enough(b) || !enough(a)) {
    return <Note tone="warn">Not enough complete days on both sides ({b.completeDays} before, {a.completeDays} after; at least 7 each). Pick a date further from the start or end of the data, or a longer window.</Note>;
  }
  const rows: [string, number | null, number | null, string][] = [
    ['Average demand', b.avgKw, a.avgKw, 'all valid half hours'],
    ['Base load (load that never switches off)', b.baseKw, a.baseKw, 'reference percentile'],
    ...(hasClosed ? [['Average demand when closed', b.closedAvgKw, a.closedAvgKw, 'closed half hours under the calendar'] as [string, number | null, number | null, string]] : []),
  ];
  const yearly = (dKw: number) => ({ kwh: dKw * 8766, gbp: dKw * 8766 * rateGbp });
  const avgD = b.avgKw !== null && a.avgKw !== null ? a.avgKw - b.avgKw : null;
  const baseD = b.baseKw !== null && a.baseKw !== null ? a.baseKw - b.baseKw : null;
  const verdict = (() => {
    if (avgD === null || b.avgKw === null) return null;
    const rel = avgD / b.avgKw;
    if (Math.abs(rel) < 0.03) return `Average demand barely moved (${rel >= 0 ? '+' : ''}${pct(rel, 1)}). No clear change shows in the meter data.`;
    const y = yearly(Math.abs(avgD));
    return `Average demand ${avgD < 0 ? 'fell' : 'rose'} by ${Math.abs(avgD).toFixed(1)} kW (${pct(Math.abs(rel), 0)}). If that held all year it would be about `
      + `${kwh(y.kwh)} and ${gbp(y.gbp)} a year ${avgD < 0 ? 'less' : 'more'} at this site's average rate.`
      + (baseD !== null && Math.abs(baseD) >= 0.1 ? ` Base load ${baseD < 0 ? 'fell' : 'rose'} by ${Math.abs(baseD).toFixed(1)} kW, so part of the change is in load that runs all the time.` : '');
  })();
  return (
    <div className="mt-3 space-y-2">
      {verdict && <p className={`text-sm font-medium rounded-lg px-4 py-2.5 ${avgD !== null && avgD < 0 ? 'bg-[#ebf6ef] text-[#08621a]' : 'bg-slate-50 text-slate-700'}`}>{verdict}</p>}
      <table className="w-full text-sm">
        <thead><tr className="text-left text-xs text-slate-500">
          <th className="py-1 font-medium" />
          <th className="text-right font-medium">Before: {fmtDayMonYear(b.from)} to {fmtDayMonYear(b.to)}</th>
          <th className="text-right font-medium">After: {fmtDayMonYear(a.from)} to {fmtDayMonYear(a.to)}</th>
          <th className="text-right font-medium">Change</th>
        </tr></thead>
        <tbody>
          {rows.map(([label, x, y, note]) => (
            <tr key={label} className="border-t border-slate-100">
              <td className="py-1.5">{label}<span className="block text-xs text-slate-400">{note}</span></td>
              <td className="text-right tabular-nums">{x === null ? 'n/a' : `${x.toFixed(1)} kW`}</td>
              <td className="text-right tabular-nums">{y === null ? 'n/a' : `${y.toFixed(1)} kW`}</td>
              <td className="text-right tabular-nums font-semibold">{x !== null && y !== null && x > 0 ? `${y >= x ? '+' : ''}${pct(y / x - 1, 1)}` : 'n/a'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-slate-400">Based on {b.completeDays} complete days before and {a.completeDays} after ({num(b.samples)} and {num(a.samples)} valid half hours). Measured demand, not weather-normalised.</p>
    </div>
  );
}

/** Base load references, closed-hours use by day class, the monthly trend and a before/after comparison. */
export default function BaseloadTab({ site, onChange, locked }: { site: SiteSummary; onChange: (s: SiteSettings) => void; locked: boolean }) {
  const m = site.metrics;
  const st = site.settings;
  const plans = useMemo(() => planDays(st.calendar, site.frame.dates), [st.calendar, site.frame]);
  const mid = site.frame.dates[Math.floor(site.frame.dates.length / 2)] ?? '';
  const [split, setSplit] = useState(mid);
  const [weeks, setWeeks] = useState(8);
  const ba = useMemo(() => (split ? beforeAfter(site.frame, plans, split, st.basePercentile, weeks) : null), [site.frame, plans, split, st.basePercentile, weeks]);
  const trend = m.monthlyBase.map((x) => ({ ...x, label: x.month }));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile label={m.baseAll.label} tag="measured" value={kw(m.baseAll.kw)} hint={`${num(m.baseAll.samples)} valid half hours`} />
        <Tile label={m.baseClosed?.label ?? 'Closed-hours reference'} tag="measured" value={m.baseClosed ? kw(m.baseClosed.kw) : 'n/a'}
          tone={m.baseClosed ? undefined : 'muted'} hint={m.baseClosed ? `${num(m.baseClosed.samples)} half hours` : m.baseClosedNote} />
        <Tile label="Lowest recorded half hour" tag="measured" value={kw(m.lowestKw)} hint="Not used as base load: one dropout could set it" />
        <Tile label="Continuous load at the all-period reference" tag="estimate" value={m.base.annual ? `${gbp(m.base.annual.cost)} a year` : gbp(m.base.observed.cost)}
          hint={`${pct(m.base.share)} of consumption`} />
      </div>
      <p className="text-xs text-slate-500">{m.baseAll.method} {m.baseClosed?.method}</p>

      <Card title="Use in open and closed hours" subtitle="Valid readings only, split by the site calendar. Closed-hours use can include essential load (refrigeration, IT, process, security).">
        {m.hasClosed ? (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4 text-sm">
              <div><p className="text-xs text-slate-500">Total observed</p><p className="font-semibold tabular-nums">{kwh(m.observed.kwh)}</p></div>
              <div><p className="text-xs text-slate-500">Open hours</p><p className="font-semibold tabular-nums">{kwh(m.open.kwh)} <span className="text-slate-400 font-normal">in {num(m.open.hours)} h</span></p></div>
              <div><p className="text-xs text-slate-500">Closed hours</p><p className="font-semibold tabular-nums">{kwh(m.closed.kwh)} <span className="text-slate-400 font-normal">in {num(m.closed.hours)} h</span></p></div>
              <div><p className="text-xs text-slate-500">Closed-hours share</p><p className="font-semibold tabular-nums">{pct(m.closed.share, 1)}</p></div>
            </div>
            <table className="w-full text-sm mb-4">
              <thead><tr className="text-left text-xs text-slate-500"><th className="py-1 font-medium">Closed hours on</th><th className="text-right font-medium">kWh</th><th className="text-right font-medium">Hours</th><th className="text-right font-medium">Above all-period ref</th><th className="text-right font-medium">Above closed-hours ref</th></tr></thead>
              <tbody>
                {m.byClass.map((b) => (
                  <tr key={b.cls} className="border-t border-slate-100">
                    <td className="py-1.5">{b.label}</td><td className="text-right tabular-nums">{kwh(b.closedKwh)}</td>
                    <td className="text-right tabular-nums">{num(b.closedHours)}</td><td className="text-right tabular-nums">{kwh(b.excessAll)}</td>
                    <td className="text-right tabular-nums">{b.excessClosed === null ? 'n/a' : kwh(b.excessClosed)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-sm font-semibold text-slate-700 mb-1">Closed-hours excess above each reference <Kind kind="estimate" /></p>
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-slate-500"><th className="py-1 font-medium">Reference</th><th className="text-right font-medium">kW</th><th className="text-right font-medium">Excess kWh (observed)</th><th className="text-right font-medium">Associated cost (observed)</th><th className="text-right font-medium">A year (estimate)</th></tr></thead>
              <tbody>
                <ExcessRow e={m.excessAll} chosen={m.excess === m.excessAll} />
                <ExcessRow e={m.excessClosed} chosen={m.excess === m.excessClosed} />
              </tbody>
            </table>
            <p className="text-xs text-slate-500 mt-2">{m.excess?.method} Both results are shown; the one in use sets the ranking and is chosen in Settings, never switched silently.</p>
            {!locked && m.excessClosed && (
              <div className="mt-2 flex gap-3 text-sm">
                {(['all', 'closed'] as const).map((r) => (
                  <label key={r} className="flex items-center gap-1.5">
                    <input type="radio" checked={st.excessReference === r} onChange={() => onChange({ ...st, excessReference: r })} />
                    Use the {r === 'all' ? 'all-period' : 'closed-hours'} reference
                  </label>
                ))}
              </div>
            )}
          </>
        ) : <Note>No confirmed closed hours: the calendar has this site open all the time, so there is no closed-hours split. {m.baseClosedNote}</Note>}
      </Card>

      <Card title="Base load by month" subtitle={`${st.basePercentile}th percentile of each month's valid half hours. Paler bars have under 20 days of readings. Describes measured demand; it does not say why it changed.`}>
        <div style={{ height: 260 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={trend} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
              <CartesianGrid vertical={false} stroke="#f1f5f9" />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#64748b' }} interval={0} angle={-35} textAnchor="end" height={44} />
              <YAxis tick={{ fontSize: 11, fill: '#64748b' }} tickFormatter={(v) => `${v} kW`} width={52} />
              <Tooltip content={({ active, payload }) => {
                const p = payload?.[0]?.payload as (typeof trend)[number] | undefined;
                if (!active || !p) return null;
                return (
                  <div className="bg-white border border-slate-200 shadow rounded-lg px-3 py-2 text-xs">
                    <p className="font-semibold">{p.month}: {kw(p.kw)}</p>
                    <p>{num(p.samples)} valid half hours; {num(p.excluded)} missing or excluded</p>
                    {p.thin && <p className="text-[#8a6100]">Under 20 days of readings</p>}
                  </div>
                );
              }} />
              <ReferenceLine y={m.baseAll.kw} stroke="#334155" strokeDasharray="4 3" />
              <Bar dataKey="kw" isAnimationActive={false} radius={[3, 3, 0, 0]}>
                {trend.map((x) => <Cell key={x.key} fill={x.thin ? '#b9d3ef' : '#2a78d6'} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <p className="text-xs text-slate-400">Dashed line: the all-period reference ({kw(m.baseAll.kw)}).</p>
      </Card>

      <Card title="Did a change make a difference?" subtitle="Before and after: pick the date something changed on site and compare measured demand in the weeks either side.">
        <div className="text-sm text-slate-600 bg-slate-50 rounded-lg px-4 py-3 mb-3 space-y-1">
          <p><strong>Use it to check whether a known change showed up in the meter data</strong>: a new BMS or time-clock schedule, plant switched off,
            an LED or controls upgrade, a change in occupancy. Enter the date it happened. The app compares the weeks before with the same number of weeks after.</p>
          <p className="text-xs text-slate-500">Keep the window short (4 to 8 weeks) so the seasons don't swamp the result. It shows what changed in the meter
            data, not why: weather, occupancy and other works can all move it.</p>
        </div>
        <div className="flex flex-wrap items-center gap-4 text-sm text-slate-600">
          <label>Change made on <input type="date" className={smallInput} value={split} min={site.frame.dates[0]} max={site.frame.dates[site.frame.dates.length - 1]} onChange={(e) => setSplit(e.target.value)} /></label>
          <label>Compare
            <select className={`${smallInput} ml-1`} value={weeks} onChange={(e) => setWeeks(Number(e.target.value))}>
              {[2, 4, 8, 12].map((w) => <option key={w} value={w}>{w} weeks</option>)}
            </select> either side</label>
        </div>
        {ba && <BeforeAfterResult ba={ba} rateGbp={m.observed.kwh > 0 ? m.observed.cost / m.observed.kwh : 0} hasClosed={m.hasClosed} />}
      </Card>
    </div>
  );
}
