import { useState } from 'react';
import { fmtDayMonYear } from '../local/dates';
import type { SiteTab } from '../local/findings';
import type { SiteSummary } from '../local/localClient';
import { Card, Note } from './ui';
import { kwh, num, pct } from './format';

/** Unusual days and persistent changes against matched baselines, with what each rests on. */
export default function AnomaliesTab({ site, goTo }: { site: SiteSummary; goTo: (tab: SiteTab, date?: string) => void }) {
  const a = site.metrics.anomalies;
  const det = site.settings.detection;
  const [sort, setSort] = useState<'size' | 'date'>('size');
  const events = sort === 'date' ? [...a.events].sort((x, y) => (x.date < y.date ? -1 : 1)) : a.events;
  return (
    <div className="space-y-4">
      <Note>
        Each complete day is compared with the median of the previous {det.baselineDays} comparable days: same weekday and same calendar
        class (normal day, holiday, closure), complete, and with no unresolved data question. A day is unusual when it is more than {pct(det.pct)} from
        that median and more than {det.madMultiple} times the scaled median absolute deviation. High and low both count. These are screening
        thresholds, changeable under Settings, not universal standards.
      </Note>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
        <div className="bg-white rounded-xl border border-slate-200 px-4 py-3"><p className="text-xl font-bold">{a.checkedDays}</p><p className="text-xs text-slate-600">complete days checked</p></div>
        <div className="bg-white rounded-xl border border-slate-200 px-4 py-3"><p className="text-xl font-bold">{a.events.length}</p><p className="text-xs text-slate-600">unusual days</p></div>
        <div className="bg-white rounded-xl border border-slate-200 px-4 py-3"><p className="text-xl font-bold">{a.changes.length}</p><p className="text-xs text-slate-600">persistent changes</p></div>
        <div className="bg-white rounded-xl border border-slate-200 px-4 py-3"><p className="text-xl font-bold">{a.notApplicable}</p><p className="text-xs text-slate-600">days the rule could not apply to</p>
          <p className="text-xs text-slate-400">{a.notApplicableReasons.insufficient} too few comparable days, {a.notApplicableReasons.noVariation} with no variation</p></div>
      </div>

      <Card title="Persistent changes" subtitle={`Demand at least ${pct(det.persistPct)} above or below its matched baseline on ${det.persistDays} of ${det.persistWindow} consecutive eligible days.`}>
        {a.changes.length ? (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-slate-500"><th className="py-1 font-medium">From</th><th className="font-medium">To</th><th className="font-medium">Direction</th><th className="text-right font-medium">Days flagged</th><th className="text-right font-medium">Average</th><th className="text-right font-medium">Actual vs expected</th><th /></tr></thead>
            <tbody>
              {a.changes.map((c) => (
                <tr key={`${c.from}${c.direction}`} className="border-t border-slate-100">
                  <td className="py-1.5">{fmtDayMonYear(c.from)}</td><td>{fmtDayMonYear(c.to)}</td>
                  <td>{c.direction === 'up' ? 'Above baseline' : 'Below baseline'}</td>
                  <td className="text-right tabular-nums">{c.flaggedDays} of {c.eligibleDays}</td>
                  <td className="text-right tabular-nums">{c.meanDeviation >= 0 ? '+' : ''}{pct(c.meanDeviation)}</td>
                  <td className="text-right tabular-nums">{kwh(c.actualKwh)} vs {kwh(c.expectedKwh)}</td>
                  <td className="text-right"><button className="text-xs text-[#0065a5] hover:underline" onClick={() => goTo('heatmap', c.from)}>Inspect →</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="text-sm text-slate-500">No sustained change found.</p>}
        <p className="text-xs text-slate-400 mt-2">A change in measured demand only. Check what changed on site; a fall is not a saving until the data and an operational change are confirmed.</p>
      </Card>

      <Card title="Unusual days" action={(
        <div className="flex text-xs border border-slate-300 rounded-lg overflow-hidden">
          {(['size', 'date'] as const).map((k) => (
            <button key={k} onClick={() => setSort(k)} className={`px-3 py-1 ${sort === k ? 'bg-[#0065a5] text-white' : 'bg-white text-slate-600'}`}>{k === 'size' ? 'Largest first' : 'By date'}</button>
          ))}
        </div>
      )}>
        {events.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-slate-500"><th className="py-1 font-medium">Date</th><th className="font-medium">Compared with</th><th className="text-right font-medium">Actual</th><th className="text-right font-medium">Expected</th><th className="text-right font-medium">Difference</th><th className="font-medium pl-3">Baseline</th><th className="font-medium">Data</th><th /></tr></thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.date} className="border-t border-slate-100">
                    <td className="py-1.5 whitespace-nowrap">{fmtDayMonYear(e.date)}</td>
                    <td>{e.dayLabel}</td>
                    <td className="text-right tabular-nums">{kwh(e.actualKwh)}</td>
                    <td className="text-right tabular-nums">{kwh(e.expectedKwh)}</td>
                    <td className={`text-right tabular-nums font-semibold ${e.direction === 'high' ? 'text-[#b42c2c]' : 'text-[#0065a5]'}`}>{e.deviation >= 0 ? '+' : ''}{pct(e.deviation)}</td>
                    <td className="pl-3 text-xs text-slate-500 whitespace-nowrap">{num(e.samples)} days, {fmtDayMonYear(e.baselineFrom)} to {fmtDayMonYear(e.baselineTo)}</td>
                    <td className="text-xs">{e.quality ? <span className="text-[#8a6100]">{e.quality}</span> : <span className="text-slate-400">ok</span>}</td>
                    <td className="text-right"><button className="text-xs text-[#0065a5] hover:underline" onClick={() => goTo('heatmap', e.date)}>Inspect →</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="text-sm text-slate-500">No unusual days found.</p>}
        <p className="text-xs text-slate-400 mt-2">Possible checks: site events, works, faults, occupancy changes, or missing data recorded as low readings.</p>
      </Card>
    </div>
  );
}
