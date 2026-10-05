import {
  SITE_TYPES, type OpeningHours, type SiteSettings, type SiteType,
} from '../local/findings';
import HoursEditor from './HoursEditor';

const input = 'w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400';
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
        <HoursEditor hours={settings.hours} onChange={setHours} />
      </div>

      </fieldset>

      <div className="grid gap-4 md:grid-cols-3">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Unit rate (p/kWh, fully delivered)</label>
          {/* Starts from the portfolio default, so the arrows step up or down from
              it rather than from zero. step="any" lets any price be typed while the
              arrows move a whole penny. */}
          <input
            type="number" min={0} step="any"
            className={`${input} ${settings.rateP === null ? 'text-slate-400' : ''}`}
            value={settings.rateP ?? defaultRate}
            onChange={(e) => set('rateP', e.target.value === '' ? null : Number(e.target.value))}
          />
          <p className="text-xs text-slate-400 mt-1">
            {settings.rateP === null ? 'Using the portfolio default.' : (
              <button type="button" onClick={() => set('rateP', null)} className="underline hover:text-slate-700">
                Back to the portfolio default ({defaultRate}p)
              </button>
            )}
          </p>
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
