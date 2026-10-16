import { useState } from 'react';
import { describeCalendar, type Calendar } from '../local/calendar';
import { presetCalendar, SITE_TYPES, type SiteType } from '../local/site';
import CalendarEditor from './CalendarEditor';

/**
 * Set the building type and calendar on every site at once, instead of
 * opening each site in turn. Weekly hours and holiday rules are replaced;
 * dated closures and exceptions entered here are added to each site's own.
 */
export default function BulkSettingsPanel({ siteCount, unconfirmed, onApply, dataFrom, dataTo }: {
  siteCount: number;
  unconfirmed: number;
  onApply: (change: { type: SiteType; calendar: Calendar }) => void;
  dataFrom: string;
  dataTo: string;
}) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<SiteType>('office');
  const [calendar, setCalendar] = useState<Calendar>(() => presetCalendar('office'));
  const [applied, setApplied] = useState<string | null>(null);

  if (!open) {
    const todo = unconfirmed > 0;
    return (
      <div className={`rounded-xl border-2 px-5 py-4 flex flex-wrap items-center gap-4 ${todo ? 'border-[#0065a5] bg-[#e6f0f7]' : 'border-slate-200 bg-white'}`}>
        <div className="flex-1 min-w-64">
          <p className="text-base font-bold text-slate-800">
            {todo ? `Step 1: set building type and opening hours (${unconfirmed} of ${siteCount} site${siteCount === 1 ? '' : 's'} not yet confirmed)` : `All ${siteCount} calendars confirmed`}
          </p>
          <p className="text-sm text-slate-600">
            {todo
              ? 'Every site starts as an office open 07:00 to 19:00 on weekdays. Closed-hours figures depend on the hours, so set them for all sites at once here, then adjust any single site on its Calendar tab.'
              : 'You can still change every site at once, for example to add a closure that applies to them all.'}
          </p>
        </div>
        <button onClick={() => setOpen(true)}
          className={`text-base font-semibold rounded-lg px-6 py-3 shadow-sm ${todo ? 'bg-[#0065a5] hover:bg-[#00528a] text-white' : 'bg-white border border-[#0065a5] text-[#0065a5] hover:bg-blue-50'}`}>
          Set building type and hours for all sites
        </button>
      </div>
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
