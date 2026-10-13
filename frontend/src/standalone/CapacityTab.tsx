import { fmtDayMonYear } from '../local/dates';
import { slotTime } from '../local/calendar';
import type { SiteSettings } from '../local/site';
import type { SiteTab } from '../local/findings';
import type { SiteSummary } from '../local/localClient';
import HeadroomPanel from './HeadroomPanel';
import { Card, Field, NumberInput } from './ui';
import { kw, num, pct } from './format';

/** Supply capacity inputs, the headroom check and the ten highest half hours. */
export default function CapacityTab({ site, onChange, locked, goTo }: {
  site: SiteSummary; onChange: (s: SiteSettings) => void; locked: boolean; goTo: (tab: SiteTab, date?: string) => void;
}) {
  const st = site.settings;
  const m = site.metrics;
  const set = <K extends keyof SiteSettings>(k: K, v: SiteSettings[K]) => onChange({ ...st, [k]: v });
  return (
    <div className="space-y-4">
      {!locked && (
        <Card title="Supply" subtitle="From the bill or connection agreement. kVA is derived from measured kW using the power factor you enter; it is an assumption.">
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Agreed supply capacity (kVA)"><NumberInput value={st.capacityKva} min={0} placeholder="e.g. 200" onChange={(v) => set('capacityKva', v && v > 0 ? v : null)} /></Field>
            <Field label="Assumed power factor" hint="0.95 if unknown. Lower if the bill shows reactive charges.">
              <NumberInput value={st.powerFactor} min={0.5} max={1} step={0.01} onChange={(v) => set('powerFactor', v && v > 0 ? Math.min(1, v) : 0.95)} />
            </Field>
            <Field label="Safety margin (%)"><NumberInput value={st.headroomMarginPct} min={0} max={50} step={1} onChange={(v) => set('headroomMarginPct', Math.max(0, Math.min(50, v ?? 0)))} /></Field>
          </div>
        </Card>
      )}
      <HeadroomPanel settings={st} headroom={site.headroom} locked={locked} onChange={onChange} />
      <Card title="Ten highest half hours" subtitle="One per day: measured kW (half-hour average) and kVA at the assumed power factor.">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-slate-500"><th className="py-1 font-medium">Date</th><th className="font-medium">Time</th><th className="text-right font-medium">kW (measured)</th><th className="text-right font-medium">kVA (assumed PF {st.powerFactor})</th><th className="text-right font-medium">Share of capacity</th><th className="font-medium pl-3">Calendar</th><th /></tr></thead>
          <tbody>
            {m.peaks.map((p) => (
              <tr key={p.date} className="border-t border-slate-100">
                <td className="py-1.5">{fmtDayMonYear(p.date)}</td><td>{slotTime(p.slot)}</td>
                <td className="text-right tabular-nums">{num(p.kw, 1)}</td>
                <td className="text-right tabular-nums">{num(p.kva, 1)}</td>
                <td className="text-right tabular-nums">{p.utilisation === null ? '-' : pct(p.utilisation)}</td>
                <td className="pl-3">{p.open ? 'open' : 'closed'}</td>
                <td className="text-right"><button className="text-xs text-[#0065a5] hover:underline" onClick={() => goTo('heatmap', p.date)}>Inspect →</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-xs text-slate-500 mt-2">
          Recurrence: {num(m.peakRecurrence.halfHours)} half hours on {num(m.peakRecurrence.days)} days came within 10% of the highest ({kw(m.peak.kw)}).
          A peak that happens once is a different problem from one that happens every winter weekday.
        </p>
      </Card>
    </div>
  );
}
