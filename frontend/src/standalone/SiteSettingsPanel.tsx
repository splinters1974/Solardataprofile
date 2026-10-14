import { SITE_TYPES, presetCalendar, DEFAULT_DETECTION, type SiteSettings, type SiteType } from '../local/site';
import type { SiteSummary } from '../local/localClient';
import CalendarEditor from './CalendarEditor';
import TariffEditor from './TariffEditor';
import { Card, Field, NumberInput } from './ui';
import { inputCls } from './format';

/**
 * Everything the engineer tells the analyser about a meter: site details,
 * calendar, rates, how to read the file, and analysis choices. In a
 * customer edition the customer can change the facts they know best (name,
 * type, floor area, calendar, rates); how the file was read, meter grouping
 * and the analysis method stay as Ameresco set them.
 */
export default function SiteSettingsPanel({ site, defaultRate, onChange, locked = false, customer = false, section = 'all' }: {
  site: SiteSummary;
  defaultRate: number;
  onChange: (s: SiteSettings) => void;
  locked?: boolean;
  customer?: boolean;
  section?: 'all' | 'calendar' | 'settings';
}) {
  const settings = site.settings;
  const set = <K extends keyof SiteSettings>(k: K, v: SiteSettings[K]) => onChange({ ...settings, [k]: v });
  const m = site.metrics;

  const calendarCard = (
    <Card title="Operating calendar" subtitle="When the site is open, half hour by half hour. Closed-hours findings depend on this.">
      <CalendarEditor calendar={settings.calendar} locked={locked} dataFrom={site.frame.dates[0] ?? ''} dataTo={site.frame.dates[site.frame.dates.length - 1] ?? ''}
        onChange={(calendar) => onChange({ ...settings, calendar, type: settings.type })} />
    </Card>
  );
  if (section === 'calendar') return calendarCard;

  return (
    <div className="space-y-4">
      {customer && (
        <p className="text-sm text-slate-600 bg-[#e6f0f7] border border-[#b9d3ef] rounded-lg px-4 py-2.5">
          You can change the site name, building type, floor area and rates here, and the hours on the Calendar tab.
          How the file was read, meter grouping and the analysis method were set by Ameresco and are shown for reference.
        </p>
      )}
      <Card title="Site details">
        <fieldset disabled={locked} className="grid gap-4 md:grid-cols-3">
          <Field label="Site name"><input className={inputCls} value={settings.name} onChange={(e) => set('name', e.target.value)} /></Field>
          <Field label="Building type" hint={SITE_TYPES[settings.type].note}>
            <select className={inputCls} value={settings.type} onChange={(e) => {
              const type = e.target.value as SiteType;
              const replace = window.confirm(`Replace this site's calendar with the ${SITE_TYPES[type].label} preset? Closures and holiday edits are kept; weekly hours are replaced and marked unconfirmed.`);
              onChange(replace ? {
                ...settings, type,
                calendar: { ...presetCalendar(type), closures: settings.calendar.closures, exceptions: settings.calendar.exceptions,
                  holidaysAdded: settings.calendar.holidaysAdded, holidaysRemoved: settings.calendar.holidaysRemoved, nation: settings.calendar.nation },
              } : { ...settings, type });
            }}>
              {(Object.keys(SITE_TYPES) as SiteType[]).map((t) => <option key={t} value={t}>{SITE_TYPES[t].label}</option>)}
            </select>
          </Field>
          <Field label="Meter ID / MPAN" hint={site.info.meterId ? 'Found in the file.' : 'Not found in the file.'}>
            <input className={inputCls} disabled={customer} value={settings.meterId} onChange={(e) => set('meterId', e.target.value)} />
          </Field>
          <Field label="Physical site" hint="Meters with the same name here belong to one site.">
            <input className={inputCls} disabled={customer} value={settings.group} placeholder="Leave blank for its own site" onChange={(e) => set('group', e.target.value)} />
          </Field>
          <Field label="Meter role" hint="Submeters are left out of portfolio totals so they are not counted twice.">
            <select className={inputCls} disabled={customer} value={settings.role} onChange={(e) => set('role', e.target.value as SiteSettings['role'])}>
              <option value="main">Main or only meter</option>
              <option value="sub">Submeter (part of a main meter)</option>
              <option value="separate">Separate supply at the same site</option>
            </select>
          </Field>
          <Field label="Floor area (m²)" hint="Optional. For kWh/m² and estate comparison.">
            <NumberInput value={settings.floorAreaM2} min={0} onChange={(v) => set('floorAreaM2', v && v > 0 ? v : null)} placeholder="Optional" />
          </Field>
        </fieldset>
      </Card>

      <Card title="Rates" subtitle="Rates are in p/kWh, fully delivered. Costs are estimated energy cost at these rates, not a bill.">
        <div className="grid gap-4 md:grid-cols-3 mb-4">
          <Field label="Flat unit rate (p/kWh)" hint={settings.rateP === null ? 'Using the portfolio default.' : (
            <button type="button" onClick={() => set('rateP', null)} className="underline hover:text-slate-700">Back to the portfolio default ({defaultRate}p)</button>
          )}>
            {/* Starts from the portfolio default, so the arrows step from it, not from zero. */}
            <input type="number" min={0} step="any" className={`${inputCls} ${settings.rateP === null ? 'text-slate-400' : ''}`}
              value={settings.rateP ?? defaultRate} onChange={(e) => set('rateP', e.target.value === '' ? null : Number(e.target.value))} />
          </Field>
        </div>
        <TariffEditor tariff={settings.tariff} flatP={settings.rateP ?? defaultRate} problems={m.rate.problems} locked={locked}
          onChange={(t) => set('tariff', t)} />
      </Card>

      {section === 'all' && calendarCard}

      <Card title="Reading the file" subtitle="How the readings were interpreted. Change these if the file says otherwise.">
        <fieldset disabled={locked || customer} className="grid gap-4 md:grid-cols-3">
          <Field label="Readings are" hint={site.info.unitEvidence}>
            <select className={inputCls} value={settings.unit} onChange={(e) => set('unit', e.target.value as 'kWh' | 'kW')}>
              <option value="kWh">kWh per half hour (energy)</option>
              <option value="kW">kW (average demand), converted to kWh x 0.5</option>
            </select>
          </Field>
          <Field label="Meter type" hint="Import meters cannot read negative. Net meters show export as negative.">
            <select className={inputCls} value={settings.meterType} onChange={(e) => set('meterType', e.target.value as SiteSettings['meterType'])}>
              <option value="import">Import (consumption)</option>
              <option value="net">Net (import less export)</option>
              <option value="export">Export (generation)</option>
            </select>
          </Field>
          <Field label="Timestamps mark" hint={site.info.conventionEvidence}>
            <select className={inputCls} disabled={!site.hasLong || locked || customer} value={settings.convention ?? site.info.convention}
              onChange={(e) => set('convention', e.target.value as 'start' | 'end')}>
              <option value="start">the start of each half hour</option>
              <option value="end">the end of each half hour</option>
            </select>
          </Field>
        </fieldset>
        <p className="text-xs text-slate-400 mt-2">{site.info.clockNote}</p>
      </Card>

      <Card title="Analysis choices">
        <fieldset disabled={locked || customer} className="grid gap-4 md:grid-cols-3">
          <Field label="Annual figures" hint={m.annualisation.method}>
            <select className={inputCls} value={settings.annualise} onChange={(e) => set('annualise', e.target.value as SiteSettings['annualise'])}>
              <option value="auto">Automatic (off under 180 valid days)</option>
              <option value="force">Always, even from a short period (with a warning)</option>
              <option value="off">Off: observed period only</option>
            </select>
          </Field>
          <Field label="Closed-hours excess measured against" hint={m.baseClosed ? `All-period ${m.baseAll.kw.toFixed(1)} kW or closed-hours ${m.baseClosed.kw.toFixed(1)} kW.` : m.baseClosedNote}>
            <select className={inputCls} value={settings.excessReference} onChange={(e) => set('excessReference', e.target.value as 'all' | 'closed')}>
              <option value="all">All-period reference (default)</option>
              <option value="closed" disabled={!m.baseClosed}>Closed-hours reference</option>
            </select>
          </Field>
          <Field label="Reference percentile" hint="Used for both base load references. 5th by default.">
            <NumberInput value={settings.basePercentile} min={1} max={25} step={1} onChange={(v) => set('basePercentile', Math.max(1, Math.min(25, v ?? 5)))} />
          </Field>
        </fieldset>
        <details className="mt-4">
          <summary className="text-sm text-[#0065a5] cursor-pointer">Advanced: unusual-day and persistent-change thresholds</summary>
          <p className="text-xs text-slate-500 mt-2 mb-2">Screening thresholds, not universal energy standards.</p>
          <fieldset disabled={locked || customer} className="grid gap-3 grid-cols-2 md:grid-cols-4">
            {([
              ['baselineDays', 'Comparable days in baseline', 1, 30, 1],
              ['minDays', 'Fewest valid days to apply', 1, 30, 1],
              ['pct', 'Deviation from median (share)', 0.05, 2, 0.05],
              ['madMultiple', 'x scaled MAD', 1, 10, 0.5],
              ['persistPct', 'Persistent change (share)', 0.05, 1, 0.05],
              ['persistDays', 'Days flagged...', 1, 30, 1],
              ['persistWindow', '...out of consecutive days', 2, 60, 1],
            ] as const).map(([key, label, min, max, step]) => (
              <Field key={key} label={label}>
                <NumberInput value={settings.detection[key]} min={min} max={max} step={step}
                  onChange={(v) => set('detection', { ...settings.detection, [key]: v ?? DEFAULT_DETECTION[key] })} />
              </Field>
            ))}
            <div className="flex items-end">
              <button type="button" className="text-xs text-slate-500 underline" onClick={() => set('detection', { ...DEFAULT_DETECTION })}>Reset to defaults</button>
            </div>
          </fieldset>
        </details>
      </Card>
    </div>
  );
}
