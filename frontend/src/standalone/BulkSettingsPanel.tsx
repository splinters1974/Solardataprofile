import { useState } from 'react';
import { SITE_TYPES, describeHours, type OpeningHours, type SiteType } from '../local/findings';
import HoursEditor from './HoursEditor';

/**
 * Set the building type and opening hours on every site at once, instead of
 * opening each site in turn. Individual sites can still be changed after.
 */
export default function BulkSettingsPanel({ siteCount, onApply }: {
  siteCount: number;
  onApply: (change: { type: SiteType; hours: OpeningHours }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<SiteType>('office');
  const [hours, setHours] = useState<OpeningHours>(() => structuredClone(SITE_TYPES.office.hours));
  const [applied, setApplied] = useState<string | null>(null);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-sm font-medium text-[#0065a5] hover:text-[#00528a] underline"
      >
        Set building type and opening hours for all {siteCount} sites at once…
      </button>
    );
  }

  function apply() {
    onApply({ type, hours: structuredClone(hours) });
    setApplied(`${SITE_TYPES[type].label}, ${describeHours(hours)}`);
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 px-5 py-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-slate-800">All sites at once</h3>
          <p className="text-sm text-slate-500">
            Applies to all {siteCount} sites and replaces their current building type and hours. You can still
            change a single site afterwards.
          </p>
        </div>
        <button onClick={() => setOpen(false)} className="text-sm text-slate-500 hover:text-slate-800">Close</button>
      </div>

      <div className="grid gap-4 md:grid-cols-[16rem_1fr]">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Building type</label>
          <select
            className="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            value={type}
            onChange={(e) => {
              const t = e.target.value as SiteType;
              setType(t);
              setHours(structuredClone(SITE_TYPES[t].hours));
              setApplied(null);
            }}
          >
            {(Object.keys(SITE_TYPES) as SiteType[]).map((t) => (
              <option key={t} value={t}>{SITE_TYPES[t].label}</option>
            ))}
          </select>
          <p className="text-xs text-slate-400 mt-1">{SITE_TYPES[type].note}</p>
        </div>
        <div>
          <p className="text-xs font-medium text-slate-600 mb-2">Opening hours</p>
          <HoursEditor
            hours={hours}
            onChange={(patch) => { setHours((h) => ({ ...h, ...patch })); setApplied(null); }}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={apply}
          className="text-sm font-semibold bg-[#0065a5] hover:bg-[#00528a] text-white px-4 py-2 rounded-lg"
        >
          Apply to all {siteCount} sites
        </button>
        {applied && <span className="text-sm text-[#08780a]">Applied: {applied}.</span>}
      </div>
    </div>
  );
}
