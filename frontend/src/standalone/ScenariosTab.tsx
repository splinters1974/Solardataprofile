import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
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

function ScenarioEditor({ sc, onChange, onRemove, locked, hasClosedRef }: {
  sc: Scenario; onChange: (s: Scenario) => void; onRemove: () => void; locked: boolean; hasClosedRef: boolean;
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
              <option value="all">all-period reference</option>
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
            <span className="flex items-center gap-1.5">Reduce
              <select disabled={locked} className={smallInput} value={sc.select} onChange={(e) => set({ select: e.target.value as 'top' | 'above' })}>
                <option value="top">the highest</option><option value="above">every half hour above</option>
              </select>
              {sc.select === 'top'
                ? <><NumberInput value={sc.count} min={1} step={1} disabled={locked} className={`${smallInput} w-20`} onChange={(v) => set({ count: Math.max(1, Math.round(v ?? 1)) })} /> half hours</>
                : <><NumberInput value={sc.aboveKw} min={0} disabled={locked} className={`${smallInput} w-20`} onChange={(v) => set({ aboveKw: Math.max(0, v ?? 0) })} /> kW</>}
            </span>
            <span className="flex items-center gap-1.5">by up to <NumberInput value={sc.kw} min={0} disabled={locked} className={`${smallInput} w-20`} onChange={(v) => set({ kw: Math.max(0, v ?? 0) })} /> kW, not below <NumberInput value={sc.floorKw} min={0} disabled={locked} className={`${smallInput} w-16`} onChange={(v) => set({ floorKw: Math.max(0, v ?? 0) })} /> kW</span>
            <span className="flex items-center gap-1.5">
              <label className="flex items-center gap-1"><input type="radio" disabled={locked} checked={sc.action === 'remove'} onChange={() => set({ action: 'remove' })} /> energy removed</label>
              <label className="flex items-center gap-1"><input type="radio" disabled={locked} checked={sc.action === 'shift'} onChange={() => set({ action: 'shift' })} /> load shifted to</label>
              {sc.action === 'shift' && <WindowPicker w={sc.receive} disabled={locked} onChange={(w) => set({ receive: w })} />}
            </span>
          </>
        )}
      </div>
      <p className="text-xs text-slate-400">{describeScenario(sc)}</p>
    </div>
  );
}

/** User-defined savings scenarios on one copy of the readings, so nothing is counted twice. */
export default function ScenariosTab({ site, run, onChange, locked }: {
  site: SiteSummary; run: ScenarioRun; onChange: (s: Scenario[]) => void; locked: boolean;
}) {
  const m = site.metrics;
  const list = site.scenarios;
  const profile = run.profileBefore.map((v, s) => ({ t: slotTime(s), before: Math.round(v * 100) / 100, after: Math.round(run.profileAfter[s] * 100) / 100 }));
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
              <ScenarioEditor key={sc.id} sc={sc} locked={locked} hasClosedRef={!!m.baseClosed}
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
                <th className="text-right font-medium">tCO2e</th>
              </tr></thead>
              <tbody>
                {list.filter((s) => s.enabled).map((s) => {
                  const r = byId.get(s.id);
                  if (!r) return null;
                  return (
                    <tr key={s.id} className="border-t border-slate-100 align-top">
                      <td className="py-1.5 pr-2">{s.label}<p className="text-xs text-slate-400">{r.assumptions.join(' ')}</p></td>
                      <td className="text-right tabular-nums">{r.intervals.toLocaleString('en-GB')}</td>
                      <td className="text-right tabular-nums">{kwh(r.kwhRemoved)}</td>
                      <td className="text-right tabular-nums">{r.kwhShifted ? kwh(r.kwhShifted) : '-'}</td>
                      <td className="text-right tabular-nums">{gbp(r.costReduction)}</td>
                      <td className="text-right tabular-nums">{r.annualCost === null ? 'not annualised' : `${gbp(r.annualCost)} (${kwh(r.annualKwh!)})`}</td>
                      <td className="text-right tabular-nums">{r.tco2e === null ? '-' : r.tco2e.toFixed(2)}</td>
                    </tr>
                  );
                })}
                <tr className="border-t-2 border-slate-300 font-semibold">
                  <td className="py-1.5">Total, no double counting</td><td />
                  <td className="text-right tabular-nums">{kwh(run.total.kwh)}</td><td />
                  <td className="text-right tabular-nums">{gbp(run.total.cost)}</td>
                  <td className="text-right tabular-nums">{run.total.annualCost === null ? 'not annualised' : gbp(run.total.annualCost)}</td>
                  <td className="text-right tabular-nums">{run.total.tco2e === null ? '-' : run.total.tco2e.toFixed(2)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-500 mt-2">
            Measured consumption in the period: {kwh(m.observed.kwh)}. Highest half hour {kw(run.peakBefore)} before, {kw(run.peakAfter)} after.
            {m.annualisation.factor === null && ' This site is not annualised, so no annual projection is shown.'}
          </p>
          <div style={{ height: 260 }} className="mt-3">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={profile} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
                <CartesianGrid vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="t" tick={{ fontSize: 10, fill: '#64748b' }} interval={5} />
                <YAxis tick={{ fontSize: 11, fill: '#64748b' }} unit=" kW" width={56} />
                <Tooltip formatter={(v, n) => [`${Number(v).toFixed(1)} kW`, n]} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} iconSize={10} />
                <Line dataKey="before" name="Average day, measured" stroke="#94a3b8" dot={false} isAnimationActive={false} />
                <Line dataKey="after" name="Average day, with active scenarios" stroke="#7c3aed" strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}
    </div>
  );
}
