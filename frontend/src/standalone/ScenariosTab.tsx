import { useState } from 'react';
import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { slotTime } from '../local/calendar';
import {
  describeScenario, newScenario, SCENARIO_LABEL, type Scenario, type ScenarioRun, type Window,
} from '../local/scenarios';
import type { SiteSummary } from '../local/localClient';
import { Card, Kind, Note, NumberInput } from './ui';
import { gbp, kw, kwh, smallInput } from './format';

const SLOTS = Array.from({ length: 49 }, (_, i) => i);
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function WindowPicker({ w, onChange, disabled }: { w: Window; onChange: (w: Window) => void; disabled?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1">
      <select disabled={disabled} className={smallInput} value={w.start} onChange={(e) => onChange({ ...w, start: Number(e.target.value) })}>
        {SLOTS.slice(0, 48).map((s) => <option key={s} value={s}>{slotTime(s)}</option>)}
      </select>
      <span className="text-xs text-slate-400">to</span>
      <select disabled={disabled} className={smallInput} value={w.end} onChange={(e) => onChange({ ...w, end: Number(e.target.value) })}>
        {SLOTS.map((s) => <option key={s} value={s % 48}>{s % 48 === w.start ? `${slotTime(s)} (all day)` : slotTime(s)}</option>)}
      </select>
    </span>
  );
}

function DayPicker({ days, onChange, disabled }: { days: boolean[]; onChange: (d: boolean[]) => void; disabled?: boolean }) {
  return (
    <span className="inline-flex gap-1">
      {DAYS.map((d, k) => (
        <label key={d} className={`text-[11px] border rounded px-1.5 py-0.5 cursor-pointer ${days[k] ? 'bg-[#0065a5] text-white border-[#0065a5]' : 'bg-white text-slate-500 border-slate-300'}`}>
          <input type="checkbox" disabled={disabled} className="sr-only" checked={days[k]} onChange={(e) => onChange(days.map((x, j) => (j === k ? e.target.checked : x)))} />{d}
        </label>
      ))}
    </span>
  );
}

/** What each scenario does, in a sentence, shown under its inputs. */
const SCENARIO_HELP: Record<Scenario['kind'], string> = {
  'closed-excess': 'Brings demand in closed half hours down towards the reference. The reference itself (the load that never switches off: fridges, servers, '
    + 'standby, security) stays, so even 100% leaves that level running overnight and at weekends. To test cutting it, add B.',
  base: 'Takes a fixed kW off every half hour in the window you choose, for example switching off a constant load. Never goes below the retained floor.',
  shoulders: 'Removes a share of demand in the hours just before opening and after closing, for example plant starting too early or running late.',
  peaks: 'Lowers maximum demand. This rarely saves much energy; its value is in capacity (kVA) and peak-time network charges, which are not priced here, '
    + 'and in electrification headroom. Shifting moves the energy to other hours instead of removing it.',
};

function ScenarioEditor({ sc, onChange, onRemove, locked, hasClosedRef, peakKw, refKw }: {
  sc: Scenario; onChange: (s: Scenario) => void; onRemove: () => void; locked: boolean; hasClosedRef: boolean; peakKw: number; refKw: number;
}) {
  const set = (patch: Partial<Scenario>) => onChange({ ...sc, ...patch } as Scenario);
  const pctInput = (v: number, k: 'share') => (
    <NumberInput value={Math.round(v * 100)} min={0} max={100} step={5} disabled={locked} className={`${smallInput} w-20`}
      onChange={(x) => set({ [k]: Math.max(0, Math.min(100, x ?? 0)) / 100 } as Partial<Scenario>)} />
  );
  return (
    <div className={`border rounded-lg p-3 space-y-2 ${sc.enabled ? 'border-slate-200' : 'border-dashed border-slate-300 opacity-70'}`}>
      <div className="flex flex-wrap items-center gap-2">
        <input type="checkbox" disabled={locked} checked={sc.enabled} onChange={(e) => set({ enabled: e.target.checked })} aria-label="Active" />
        <input disabled={locked} className={`${smallInput} font-semibold flex-1 min-w-48`} value={sc.label} onChange={(e) => set({ label: e.target.value })} />
        <span className="text-xs text-slate-400">{SCENARIO_LABEL[sc.kind].slice(0, 2)}</span>
        {!locked && <button className="text-xs text-slate-400 hover:text-red-600" onClick={onRemove}>Remove</button>}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-slate-600">
        {sc.kind === 'closed-excess' && (
          <>
            <span className="flex items-center gap-1.5">Reduce {pctInput(sc.share, 'share')}% of closed-hours demand above the</span>
            <select disabled={locked} className={smallInput} value={sc.reference} onChange={(e) => set({ reference: e.target.value as 'all' | 'closed' })}>
              <option value="all">all-period reference ({kw(refKw)})</option>
              <option value="closed" disabled={!hasClosedRef}>closed-hours reference</option>
            </select>
          </>
        )}
        {sc.kind === 'base' && (
          <>
            <span className="flex items-center gap-1.5">Reduce by <NumberInput value={sc.kw} min={0} disabled={locked} className={`${smallInput} w-20`} onChange={(v) => set({ kw: Math.max(0, v ?? 0) })} /> kW</span>
            <span className="flex items-center gap-1.5">from <WindowPicker w={sc.window} disabled={locked} onChange={(w) => set({ window: w })} /></span>
            <DayPicker days={sc.days} disabled={locked} onChange={(d) => set({ days: d })} />
            <span className="flex items-center gap-1.5">never below <NumberInput value={sc.floorKw} min={0} disabled={locked} className={`${smallInput} w-20`} onChange={(v) => set({ floorKw: Math.max(0, v ?? 0) })} /> kW retained</span>
          </>
        )}
        {sc.kind === 'shoulders' && (
          <>
            <span className="flex items-center gap-1.5">Remove {pctInput(sc.share, 'share')}% of demand above <NumberInput value={sc.floorKw} min={0} disabled={locked} className={`${smallInput} w-20`} onChange={(v) => set({ floorKw: Math.max(0, v ?? 0) })} /> kW in</span>
            {sc.windows.map((w, k) => (
              <span key={k} className="flex items-center gap-1">
                <WindowPicker w={w} disabled={locked} onChange={(nw) => set({ windows: sc.windows.map((x, j) => (j === k ? nw : x)) })} />
                {!locked && sc.windows.length > 1 && <button className="text-xs text-slate-400" onClick={() => set({ windows: sc.windows.filter((_, j) => j !== k) })}>×</button>}
              </span>
            ))}
            {!locked && <button className="text-xs text-[#0065a5]" onClick={() => set({ windows: [...sc.windows, { start: 40, end: 44 }] })}>+ window</button>}
            <DayPicker days={sc.days} disabled={locked} onChange={(d) => set({ days: d })} />
          </>
        )}
        {sc.kind === 'peaks' && (
          <>
            <span className="flex items-center gap-1.5">
              <select disabled={locked} className={smallInput} value={sc.select} onChange={(e) => set({ select: e.target.value as 'cap' | 'top' | 'above' })}>
                <option value="cap">Hold demand at or below</option>
                <option value="top">Trim the highest</option>
                <option value="above">Trim every half hour above</option>
              </select>
              {sc.select === 'cap' && <><NumberInput value={sc.capKw ?? 0} min={0} disabled={locked} className={`${smallInput} w-20`} onChange={(v) => set({ capKw: Math.max(0, v ?? 0) })} /> kW</>}
              {sc.select === 'top' && <><NumberInput value={sc.count} min={1} step={1} disabled={locked} className={`${smallInput} w-20`} onChange={(v) => set({ count: Math.max(1, Math.round(v ?? 1)) })} /> half hours</>}
              {sc.select === 'above' && <><NumberInput value={sc.aboveKw} min={0} disabled={locked} className={`${smallInput} w-20`} onChange={(v) => set({ aboveKw: Math.max(0, v ?? 0) })} /> kW</>}
            </span>
            {sc.select === 'cap' && !locked && (
              <span className="flex items-center gap-1.5 text-xs">
                Current peak {kw(peakKw)}. Try:
                {[0.9, 0.8, 0.7].map((f) => (
                  <button key={f} type="button" onClick={() => set({ capKw: Math.round(peakKw * f * 10) / 10 })}
                    className="border border-[#0065a5] text-[#0065a5] rounded-full px-2 py-0.5 hover:bg-blue-50">{Math.round(f * 100)}% ({kw(peakKw * f)})</button>
                ))}
              </span>
            )}
            {sc.select !== 'cap' && (
              <span className="flex items-center gap-1.5">by up to <NumberInput value={sc.kw} min={0} disabled={locked} className={`${smallInput} w-20`} onChange={(v) => set({ kw: Math.max(0, v ?? 0) })} /> kW, not below <NumberInput value={sc.floorKw} min={0} disabled={locked} className={`${smallInput} w-16`} onChange={(v) => set({ floorKw: Math.max(0, v ?? 0) })} /> kW</span>
            )}
            <span className="flex items-center gap-1.5">
              <label className="flex items-center gap-1"><input type="radio" disabled={locked} checked={sc.action === 'remove'} onChange={() => set({ action: 'remove' })} /> energy removed</label>
              <label className="flex items-center gap-1"><input type="radio" disabled={locked} checked={sc.action === 'shift'} onChange={() => set({ action: 'shift' })} /> load shifted to</label>
              {sc.action === 'shift' && <WindowPicker w={sc.receive} disabled={locked} onChange={(w) => set({ receive: w })} />}
            </span>
          </>
        )}
      </div>
      <p className="text-xs text-slate-500">{SCENARIO_HELP[sc.kind]}</p>
      <p className="text-xs text-slate-400">Now: {describeScenario(sc)}</p>
    </div>
  );
}

/** User-defined savings scenarios on one copy of the readings, so nothing is counted twice. */
export default function ScenariosTab({ site, run, onChange, locked }: {
  site: SiteSummary; run: ScenarioRun; onChange: (s: Scenario[]) => void; locked: boolean;
}) {
  const m = site.metrics;
  const list = site.scenarios;
  const [dayView, setDayView] = useState<'all' | 'open' | 'closed'>('all');
  const pv = run.profiles[dayView].days ? run.profiles[dayView] : run.profiles.all;
  const profile = pv.before.map((v, s) => ({ t: slotTime(s), before: Math.round(v * 100) / 100, after: Math.round(pv.after[s] * 100) / 100 }));
  const firstA = list.find((x) => x.enabled && x.kind === 'closed-excess');
  const hasA = !!firstA;
  const refLine = firstA && firstA.kind === 'closed-excess' && firstA.reference === 'closed' && m.baseClosed ? m.baseClosed.kw : m.baseAll.kw;
  const byId = new Map(run.results.map((r) => [r.id, r]));
  return (
    <div className="space-y-4">
      <Note>
        Scenarios are assumptions to test, not verified savings. Active scenarios are applied in order to one copy of the valid readings: each takes
        only what the ones before it left, no half hour goes below its retained floor or zero, and nothing changes until you enter a target.
        Results cover the observed period ({m.coverage.from} to {m.coverage.to}) at the rates entered; the annual projection uses the site's
        annualisation and is shown separately. Demand and capacity charges are not included.
      </Note>

      <Card title="Scenarios" action={!locked && (
        <div className="flex flex-wrap gap-2">
          {(Object.keys(SCENARIO_LABEL) as Scenario['kind'][]).map((k) => (
            <button key={k} onClick={() => onChange([...list, newScenario(k)])} className="text-xs font-medium border border-[#0065a5] text-[#0065a5] rounded-full px-3 py-1 hover:bg-blue-50">
              + {SCENARIO_LABEL[k]}
            </button>
          ))}
        </div>
      )}>
        {list.length ? (
          <div className="space-y-2">
            {list.map((sc, k) => (
              <ScenarioEditor key={sc.id} sc={sc} locked={locked} hasClosedRef={!!m.baseClosed} peakKw={m.peak.kw} refKw={m.baseAll.kw}
                onChange={(n) => onChange(list.map((x, j) => (j === k ? n : x)))}
                onRemove={() => onChange(list.filter((_, j) => j !== k))} />
            ))}
          </div>
        ) : <p className="text-sm text-slate-500">{locked ? 'No scenarios were set up for this site.' : 'No scenarios yet. Add one above.'}</p>}
      </Card>

      {list.length > 0 && (
        <Card title={<>Results <Kind kind="scenario" /></>} subtitle="Applied in the order listed. Inactive scenarios are left out.">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-slate-500">
                <th className="py-1 font-medium">Scenario</th><th className="text-right font-medium">Half hours changed</th>
                <th className="text-right font-medium">kWh removed (period)</th><th className="text-right font-medium">kWh shifted</th>
                <th className="text-right font-medium">Cost reduction (period)</th><th className="text-right font-medium">A year (projection)</th>
                <th className="text-right font-medium pl-4">tCO2e</th>
              </tr></thead>
              <tbody>
                {list.filter((s) => s.enabled).map((s) => {
                  const r = byId.get(s.id);
                  if (!r) return null;
                  return (
                    <tr key={s.id} className="border-t border-slate-100 align-top">
                      <td className="py-1.5 pr-2">{s.label}<p className="text-xs text-slate-400">{r.assumptions.join(' ')}</p>
                        {r.peakKwAfter !== null && <p className="text-xs text-slate-600">Peak {kw(run.peakBefore)} to {kw(r.peakKwAfter)} after this scenario.</p>}</td>
                      <td className="text-right tabular-nums">{r.intervals.toLocaleString('en-GB')}<p className="text-xs text-slate-400">on {r.days} day{r.days === 1 ? '' : 's'}</p></td>
                      <td className="text-right tabular-nums">{kwh(r.kwhRemoved)}</td>
                      <td className="text-right tabular-nums">{r.kwhShifted ? kwh(r.kwhShifted) : '-'}</td>
                      <td className="text-right tabular-nums">{gbp(r.costReduction)}</td>
                      <td className="text-right tabular-nums pl-3">{r.annualCost === null ? 'not annualised' : <>{gbp(r.annualCost)}<p className="text-xs text-slate-400 whitespace-nowrap">{kwh(r.annualKwh!)}</p></>}</td>
                      <td className="text-right tabular-nums pl-4">{r.tco2e === null ? '-' : r.tco2e.toFixed(2)}</td>
                    </tr>
                  );
                })}
                <tr className="border-t-2 border-slate-300 font-semibold">
                  <td className="py-1.5">Total, no double counting</td><td />
                  <td className="text-right tabular-nums">{kwh(run.total.kwh)}</td><td />
                  <td className="text-right tabular-nums">{gbp(run.total.cost)}</td>
                  <td className="text-right tabular-nums">{run.total.annualCost === null ? 'not annualised' : gbp(run.total.annualCost)}</td>
                  <td className="text-right tabular-nums pl-4">{run.total.tco2e === null ? '-' : run.total.tco2e.toFixed(2)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-500 mt-2">
            Measured consumption in the period: {kwh(m.observed.kwh)}. Highest half hour {kw(run.peakBefore)} before, {kw(run.peakAfter)} after.
            {m.annualisation.factor === null && ' This site is not annualised, so no annual projection is shown.'}
          </p>
          <div className="flex flex-wrap items-center justify-between gap-2 mt-4">
            <p className="text-sm font-semibold text-slate-700">Average day before and after</p>
            <div className="inline-flex rounded-lg border border-slate-300 overflow-hidden text-xs font-medium">
              {([['all', 'All days'], ['open', `Days the site opens (${run.profiles.open.days})`], ['closed', `Closed days (${run.profiles.closed.days})`]] as const).map(([k, label]) => (
                <button key={k} type="button" disabled={!run.profiles[k].days} onClick={() => setDayView(k)}
                  className={`px-3 py-1.5 disabled:opacity-40 ${dayView === k ? 'bg-[#0065a5] text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>{label}</button>
              ))}
            </div>
          </div>
          <div style={{ height: 260 }} className="mt-2">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={profile} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
                <CartesianGrid vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="t" tick={{ fontSize: 10, fill: '#64748b' }} interval={5} />
                <YAxis tick={{ fontSize: 11, fill: '#64748b' }} unit=" kW" width={56} />
                <Tooltip formatter={(v, n) => [`${Number(v).toFixed(1)} kW`, n]} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} iconSize={10} />
                <ReferenceLine y={refLine} stroke="#334155" strokeDasharray="4 3" label={{ value: `reference ${kw(refLine)}`, position: 'insideBottomRight', fontSize: 10, fill: '#334155' }} />
                <Line dataKey="before" name="Average day, measured" stroke="#94a3b8" dot={false} isAnimationActive={false} />
                <Line dataKey="after" name="Average day, with active scenarios" stroke="#7c3aed" strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Each line is the average kW in each half hour across the days chosen above.
            {dayView === 'all' && ' "All days" mixes working days and closed days, so daytime still shows working-day use even when closed-hours demand is cut.'}
            {hasA && ` Scenario A takes closed-hours demand down towards the dashed reference line (${kw(refLine)}), not to zero: that is the load that never switches off. Look at "Closed days" to see it clearly; add B to test cutting the reference itself.`}
          </p>
        </Card>
      )}
    </div>
  );
}
