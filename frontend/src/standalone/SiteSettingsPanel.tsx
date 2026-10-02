import {
  SITE_TYPES, slotLabel, type DayHours, type OpeningHours, type SiteSettings, type SiteType,
} from '../local/findings';

const input = 'w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400';
const SLOTS = Array.from({ length: 49 }, (_, i) => i);

function DayRow({ label, value, onChange }: {
  label: string; value: DayHours; onChange: (v: DayHours) => void;
}) {
  const open = value !== null;
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="w-20 text-slate-600">{label}</span>
      <label className="flex items-center gap-1.5 text-slate-600 w-24">
        <input
          type="checkbox"
          checked={open}
          onChange={(e) => onChange(e.target.checked ? { open: 16, close: 36 } : null)}
          className="accent-blue-700"
        />
        Open
      </label>
      {open && (
        <>
          <select className="border border-slate-300 rounded-md px-2 py-1 text-sm" value={value.open}
            onChange={(e) => onChange({ ...value, open: Math.min(Number(e.target.value), value.close) })}>
            {SLOTS.slice(0, 48).map((s) => <option key={s} value={s}>{slotLabel(s)}</option>)}
          </select>
          <span className="text-slate-400">to</span>
          <select className="border border-slate-300 rounded-md px-2 py-1 text-sm" value={value.close}
            onChange={(e) => onChange({ ...value, close: Math.max(Number(e.target.value), value.open) })}>
            {SLOTS.slice(1).map((s) => <option key={s} value={s}>{slotLabel(s)}</option>)}
          </select>
        </>
      )}
    </div>
  );
}

/** Name, building type, opening hours and the costing inputs for one site. */
export default function SiteSettingsPanel({ settings, defaultRate, onChange, locked = false }: {
  settings: SiteSettings;
  defaultRate: number;
  onChange: (s: SiteSettings) => void;
  /** Customer edition: show everything, allow only the unit rate to change. */
  locked?: boolean;
}) {
  const set = <K extends keyof SiteSettings>(k: K, v: SiteSettings[K]) => onChange({ ...settings, [k]: v });
  const setHours = (h: Partial<OpeningHours>) => onChange({ ...settings, type: 'custom', hours: { ...settings.hours, ...h } });

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 space-y-5">
      {locked && (
        <p className="text-xs text-slate-500 bg-slate-50 rounded-lg px-3 py-2">
          Site details and opening hours were set by Ameresco. You can try a different unit rate below.
        </p>
      )}
      <fieldset disabled={locked} className="space-y-5 disabled:opacity-80">
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Site name</label>
          <input className={input} value={settings.name} onChange={(e) => set('name', e.target.value)} />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Building type</label>
          <select
            className={input}
            value={settings.type}
            onChange={(e) => {
              const type = e.target.value as SiteType;
              onChange({ ...settings, type, hours: structuredClone(SITE_TYPES[type].hours) });
            }}
          >
            {(Object.keys(SITE_TYPES) as SiteType[]).map((t) => (
              <option key={t} value={t}>{SITE_TYPES[t].label}</option>
            ))}
          </select>
          <p className="text-xs text-slate-400 mt-1">{SITE_TYPES[settings.type].note}</p>
        </div>
      </div>

      <div>
        <p className="text-xs font-medium text-slate-600 mb-2">
          Opening hours <span className="font-normal text-slate-400">(anything outside these counts as out of hours)</span>
        </p>
        <div className="space-y-2">
          <DayRow label="Weekdays" value={settings.hours.weekday} onChange={(v) => setHours({ weekday: v })} />
          <DayRow label="Saturday" value={settings.hours.saturday} onChange={(v) => setHours({ saturday: v })} />
          <DayRow label="Sunday" value={settings.hours.sunday} onChange={(v) => setHours({ sunday: v })} />
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={settings.hours.holidaysLikeSunday}
              onChange={(e) => setHours({ holidaysLikeSunday: e.target.checked })}
              className="accent-blue-700"
            />
            Treat bank holidays like Sunday
          </label>
        </div>
      </div>

      </fieldset>

      <div className="grid gap-4 md:grid-cols-3">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Unit rate (p/kWh, fully delivered)</label>
          <input
            type="number" min={0} step={0.1} className={input}
            placeholder={`${defaultRate} (portfolio default)`}
            value={settings.rateP ?? ''}
            onChange={(e) => set('rateP', e.target.value === '' ? null : Number(e.target.value))}
          />
          <p className="text-xs text-slate-400 mt-1">Leave blank to use the portfolio default.</p>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Agreed supply capacity (kVA)</label>
          <input
            type="number" min={0} className={input} placeholder="Optional" disabled={locked}
            value={settings.capacityKva ?? ''}
            onChange={(e) => set('capacityKva', e.target.value === '' ? null : Number(e.target.value))}
          />
          <p className="text-xs text-slate-400 mt-1">From the bill or supply agreement.</p>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Power factor</label>
          <input
            type="number" min={0.5} max={1} step={0.01} className={input} disabled={locked}
            value={settings.powerFactor}
            onChange={(e) => set('powerFactor', Number(e.target.value) || 0.95)}
          />
          <p className="text-xs text-slate-400 mt-1">Converts peak kW to kVA. 0.95 if unknown.</p>
        </div>
      </div>
    </div>
  );
}
