import { useMemo } from 'react';
import { compareType, meterGroups, overlapWarnings } from '../local/estate';
import { SITE_TYPES, type SiteType } from '../local/site';
import { fmtDayMonYear } from '../local/dates';
import type { SiteSummary } from '../local/localClient';
import { Card, Note } from './ui';
import { kwh, num, pct } from './format';

/** Like-for-like comparisons by building type over matched dates, and multi-meter sites. */
export default function EstateView({ sites, openSite }: { sites: SiteSummary[]; openSite: (id: string) => void }) {
  const types = useMemo(() => [...new Set(sites.map((s) => s.settings.type))] as SiteType[], [sites]);
  const groups = useMemo(() => meterGroups(sites), [sites]);
  const warnings = useMemo(() => overlapWarnings(sites), [sites]);
  const areas = sites.filter((s) => s.settings.floorAreaM2).length;

  return (
    <div className="space-y-4">
      {warnings.length > 0 && <Note tone="warn">{warnings.map((w, i) => <p key={i}>{w}</p>)}</Note>}
      <Note>
        Sites are compared only with sites of the same building type, over the dates they all cover, and per square metre where a floor area
        has been entered ({areas} of {sites.length} have one; add it under each site's Settings). Raw consumption alone does not show which
        site is better run, so nothing is labelled best or worst. Submeters are left out.
      </Note>
      {types.map((t) => {
        const c = compareType(sites, t);
        if (!c.rows.length) return null;
        return (
          <Card key={t} title={SITE_TYPES[t].label} subtitle={c.note}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-slate-500">
                  <th className="py-1 font-medium">Site</th><th className="text-right font-medium">Floor area</th>
                  <th className="text-right font-medium">kWh, matched period</th><th className="text-right font-medium">Complete days</th>
                  <th className="text-right font-medium">kWh/m², matched period</th><th className="text-right font-medium">kWh per open hour</th>
                  <th className="text-right font-medium">Closed-hours share</th><th className="text-right font-medium">kWh/m² a year (est.)</th>
                </tr></thead>
                <tbody>
                  {c.rows.map((r) => (
                    <tr key={r.id} className="border-t border-slate-100">
                      <td className="py-1.5"><button onClick={() => openSite(r.id)} className="text-[#0065a5] hover:underline">{r.name}</button></td>
                      <td className="text-right tabular-nums">{r.floorAreaM2 ? `${num(r.floorAreaM2)} m²` : '-'}</td>
                      <td className="text-right tabular-nums">{r.matchedKwh === null ? '-' : kwh(r.matchedKwh)}</td>
                      <td className="text-right tabular-nums">{r.matchedKwh === null ? '-' : `${r.completeDays} of ${c.days}`}</td>
                      <td className="text-right tabular-nums">{r.kwhPerM2 === null ? '-' : num(r.kwhPerM2, 1)}</td>
                      <td className="text-right tabular-nums">{r.kwhPerOpenHour === null ? '-' : num(r.kwhPerOpenHour, 1)}</td>
                      <td className="text-right tabular-nums">{r.closedShare === null ? '-' : pct(r.closedShare)}</td>
                      <td className="text-right tabular-nums">{r.annualKwhPerM2 === null ? '-' : num(r.annualKwhPerM2, 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-slate-400 mt-2">kWh per open hour divides all kWh in the matched period by the scheduled open hours. The annual column uses each site's own period and annualisation, so it is not matched.</p>
          </Card>
        );
      })}

      <Card title="Sites with more than one meter" subtitle="Give meters the same Physical site name and a role in their Settings to group them. A submeter is never added to its main meter.">
        {groups.length ? groups.map((g) => (
          <div key={g.name} className="border-t border-slate-100 first:border-0 py-3">
            <p className="font-semibold text-slate-800">{g.name}</p>
            <ul className="text-sm text-slate-600 mt-1">
              {g.members.map((m) => (
                <li key={m.id}>
                  <button onClick={() => openSite(m.id)} className="text-[#0065a5] hover:underline">{m.name}</button>
                  {m.meterId && ` · ${m.meterId}`} · {m.role === 'main' ? 'main' : m.role === 'sub' ? 'submeter (not added)' : 'separate supply'} · {fmtDayMonYear(m.from)} to {fmtDayMonYear(m.to)}
                </li>
              ))}
            </ul>
            <p className="text-sm mt-1">
              {g.combinedDays ? <>Site total: <strong>{kwh(g.combinedKwh)}</strong> over {g.combinedDays} days complete on every combined meter ({fmtDayMonYear(g.combinedFrom!)} to {fmtDayMonYear(g.combinedTo!)}).</>
                : 'No days with complete readings on every combined meter, so no site total.'}
            </p>
            {g.warnings.map((w, i) => <p key={i} className="text-xs text-[#8a6100]">{w}</p>)}
          </div>
        )) : <p className="text-sm text-slate-500">No meters grouped yet.</p>}
      </Card>
    </div>
  );
}
