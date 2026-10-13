import { useState } from 'react';
import { describeCalendar, type Calendar } from '../local/calendar';
import { presetCalendar, SITE_TYPES, type SiteType } from '../local/site';
import CalendarEditor from './CalendarEditor';

/**
 * Set the building type and calendar on every site at once, instead of
 * opening each site in turn. Weekly hours and holiday rules are replaced;
 * dated closures and exceptions entered here are added to each site's own.
 */
export default function BulkSettingsPanel({ siteCount, onApply, dataFrom, dataTo }: {
  siteCount: number;
  onApply: (change: { type: SiteType; calendar: Calendar }) => void;
  dataFrom: string;
  dataTo: string;
}) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<SiteType>('office');
  const [calendar, setCalendar] = useState<Calendar>(() => presetCalendar('office'));
  const [applied, setApplied] = useState<string | null>(null);

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="text-sm font-medium text-[#0065a5] hover:text-[#00528a] underline">
        Set building type and calendar for all {siteCount} sites at once…
      </button>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 px-5 py-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-slate-800">All sites at once</h3>
          <p className="text-sm text-slate-500">
            Applies to all {siteCount} sites: replaces their weekly hours and bank holiday rules, and adds any closures and exceptional
            periods entered here to each site's own. Change a single site afterwards on its Calendar tab.
          </p>
        </div>
        <button onClick={() => setOpen(false)} className="text-sm text-slate-500 hover:text-slate-800">Close</button>
      </div>
      <div className="max-w-xs">
        <label className="block text-xs font-medium text-slate-600 mb-1">Building type</label>
        <select
          className="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
          value={type}
          onChange={(e) => { const t = e.target.value as SiteType; setType(t); setCalendar(presetCalendar(t)); setApplied(null); }}
        >
          {(Object.keys(SITE_TYPES) as SiteType[]).map((t) => <option key={t} value={t}>{SITE_TYPES[t].label}</option>)}
        </select>
        <p className="text-xs text-slate-400 mt-1">{SITE_TYPES[type].note}</p>
      </div>
      <CalendarEditor calendar={calendar} onChange={(c) => { setCalendar(c); setApplied(null); }} dataFrom={dataFrom} dataTo={dataTo} locked={false} />
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => { onApply({ type, calendar: structuredClone(calendar) }); setApplied(describeCalendar(calendar)); }}
          className="text-sm font-semibold bg-[#0065a5] hover:bg-[#00528a] text-white px-4 py-2 rounded-lg"
        >
          Apply to all {siteCount} sites
        </button>
        {applied && <span className="text-sm text-[#08780a]">Applied: {applied}</span>}
      </div>
    </div>
  );
}
