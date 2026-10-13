import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { beforeAfter, type ExcessResult } from '../local/findings';
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

/** Base load references, closed-hours use by day class, the monthly trend and a before/after comparison. */
export default function BaseloadTab({ site, onChange, locked }: { site: SiteSummary; onChange: (s: SiteSettings) => void; locked: boolean }) {
  const m = site.metrics;
  const st = site.settings;
  const plans = useMemo(() => planDays(st.calendar, site.frame.dates), [st.calendar, site.frame]);
  const mid = site.frame.dates[Math.floor(site.frame.dates.length / 2)] ?? '';
  const [split, setSplit] = useState(mid);
  const ba = useMemo(() => (split ? beforeAfter(site.frame, plans, split, st.basePercentile) : null), [site.frame, plans, split, st.basePercentile]);
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
              <YAxis tick={{ fontSize: 11, fill: '#64748b' }} />
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

      <Card title="Before and after" subtitle="Compare measured base load before and after a date you choose, such as a controls change. Describes the change in demand; it does not establish the cause.">
        <label className="text-sm text-slate-600">Split at <input type="date" className={smallInput} value={split} min={site.frame.dates[0]} max={site.frame.dates[site.frame.dates.length - 1]} onChange={(e) => setSplit(e.target.value)} /></label>
        {ba && (
          <table className="w-full text-sm mt-3">
            <thead><tr className="text-left text-xs text-slate-500"><th className="py-1 font-medium" /><th className="text-right font-medium">Before {fmtDayMonYear(split)}</th><th className="text-right font-medium">From {fmtDayMonYear(split)}</th><th className="text-right font-medium">Change</th></tr></thead>
            <tbody>
              {([['All-period reference', ba.before.allKw, ba.after.allKw, ba.before.allSamples, ba.after.allSamples],
                ['Closed-hours reference', ba.before.closedKw, ba.after.closedKw, ba.before.closedSamples, ba.after.closedSamples]] as const).map(([label, a, b, na, nb]) => (
                <tr key={label} className="border-t border-slate-100">
                  <td className="py-1.5">{label}</td>
                  <td className="text-right tabular-nums">{a === null ? 'n/a' : kw(a)} <span className="text-xs text-slate-400">({num(na)})</span></td>
                  <td className="text-right tabular-nums">{b === null ? 'n/a' : kw(b)} <span className="text-xs text-slate-400">({num(nb)})</span></td>
                  <td className="text-right tabular-nums">{a !== null && b !== null && a > 0 ? `${b >= a ? '+' : ''}${pct(b / a - 1, 1)}` : 'n/a'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="text-xs text-slate-400 mt-2">Numbers in brackets are valid half hours behind each figure. Seasons differ either side of most dates, so compare like periods where you can.</p>
      </Card>
    </div>
  );
}
