/**
 * Small shared pieces for the offline app's screens: cards, tiles, tabs,
 * form fields and the impact, confidence and status chips.
 */
import { IS_STANDARD, PRODUCT, VARIANT } from '../local/edition';
import type { ReactNode } from 'react';
import type { Confidence, Level } from '../local/findings';
import { STATUS_LABEL, type ActionStatus } from '../local/actions';
import { LEVEL_UI } from './levelUi';
import { inputCls } from './format';


export function Card({ title, subtitle, action, children, className = '' }: {
  title?: ReactNode; subtitle?: ReactNode; action?: ReactNode; children?: ReactNode; className?: string;
}) {
  return (
    <section className={`bg-white rounded-xl border border-slate-300 p-6 ${className}`}>
      {(title || action) && (
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div className="min-w-0">
            {title && <h3 className="text-lg font-bold text-slate-900 tracking-tight">{title}</h3>}
            {subtitle && <p className="text-sm text-slate-600 mt-1">{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Tile({ label, value, hint, tone, tag }: {
  label: string; value: ReactNode; hint?: ReactNode; tone?: 'bad' | 'muted'; tag?: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-300 border-t-[3px] border-t-slate-800 px-4 pt-3 pb-3.5">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-semibold text-slate-700">{label}</p>
        {tag && <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 bg-slate-100 rounded px-1.5 py-0.5 whitespace-nowrap">{tag}</span>}
      </div>
      <p className={`text-2xl font-extrabold tracking-tight tabular-nums mt-1 ${tone === 'bad' ? 'text-[#b42c2c]' : tone === 'muted' ? 'text-slate-400' : 'text-slate-900'}`}>{value}</p>
      {hint && <p className="text-xs text-slate-500 mt-0.5">{hint}</p>}
    </div>
  );
}

/**
 * A full-width mist band at the top of a page, as on the Ameresco web tools:
 * a small eyebrow, a heavy title, a line of detail, actions, and an optional
 * panel on the right (usually a StatPanel).
 */
export function Hero({ eyebrow, title, sub, children, aside }: {
  eyebrow?: ReactNode; title: ReactNode; sub?: ReactNode; children?: ReactNode; aside?: ReactNode;
}) {
  return (
    <section className="-mt-8 mb-2 py-8 bg-slate-100 shadow-[0_0_0_100vmax_var(--color-slate-100)] [clip-path:inset(0_-100vmax)]">
      <div className={`grid gap-8 items-start ${aside ? 'lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]' : ''}`}>
        <div className="min-w-0 space-y-3">
          {eyebrow && <div className="text-sm text-slate-600">{eyebrow}</div>}
          <h1 className="text-3xl md:text-[2.6rem] leading-[1.08] font-extrabold tracking-tight text-slate-900 break-words">{title}</h1>
          {sub && <div className="text-base text-slate-600 max-w-3xl">{sub}</div>}
          {children}
        </div>
        {aside}
      </div>
    </section>
  );
}

/**
 * Headline numbers on an ink panel, like the result box on the web tools:
 * one lead figure with a green label, then a row of supporting figures.
 */
export function StatPanel({ lead, items, note }: {
  lead: { label: string; value: ReactNode; hint?: ReactNode };
  items: { label: string; value: ReactNode }[];
  note?: ReactNode;
}) {
  return (
    <div className="rounded-xl bg-slate-900 text-white p-6 shadow-md">
      <p className="text-sm font-semibold text-[#8fd16a]">{lead.label}</p>
      <p className="text-4xl font-extrabold tracking-tight tabular-nums mt-1">{lead.value}</p>
      {lead.hint && <p className="text-xs text-white/70 mt-1">{lead.hint}</p>}
      <div className="grid grid-cols-3 gap-3 border-t border-white/20 mt-4 pt-4">
        {items.map((x) => (
          <div key={x.label} className="min-w-0">
            <p className="text-xs text-white/70">{x.label}</p>
            <p className="text-base font-bold tabular-nums mt-0.5 break-words">{x.value}</p>
          </div>
        ))}
      </div>
      {note && <p className="text-[11px] text-white/60 mt-4">{note}</p>}
    </div>
  );
}

/**
 * Tabs that stay visible: a solid bar with the active tab filled in ink.
 * `sticky` keeps the bar pinned under the top of the window while scrolling
 * a long tab, so the other tabs are always one click away.
 */
export function Tabs<T extends string>({ tabs, value, onChange, sticky = false, label }: {
  tabs: { key: T; label: string; badge?: string | number }[]; value: T; onChange: (t: T) => void; sticky?: boolean; label?: string;
}) {
  return (
    <div className={`${sticky ? 'sticky top-[61px] z-30 -mx-2 px-2 py-2 bg-white/95 backdrop-blur' : ''}`}>
      <div className="bg-white border border-slate-300 rounded-xl shadow-sm p-1.5" role="tablist" aria-label={label}>
        <div className="flex flex-wrap gap-0.5">
          {tabs.map((t) => {
            const on = value === t.key;
            return (
              <button
                key={t.key}
                role="tab"
                aria-selected={on}
                onClick={() => onChange(t.key)}
                className={`px-3 py-2 rounded-lg text-sm font-semibold whitespace-nowrap transition-colors ${
                  on ? 'bg-slate-900 text-white shadow' : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                {t.label}
                {t.badge !== undefined && t.badge !== '' && t.badge !== 0 && (
                  <span className={`ml-2 text-[10px] font-bold rounded-full px-1.5 py-0.5 ${on ? 'bg-white text-slate-900' : 'bg-[#0065a5] text-white'}`}>{t.badge}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** The product name with the Advanced badge, for the header and the customer gate. */
export function ProductMark({ size = 'lg' }: { size?: 'lg' | 'md' }) {
  return (
    <span className="flex items-center gap-2">
      <span className={`${size === 'lg' ? 'text-xl' : 'text-lg'} font-extrabold tracking-tight text-slate-900 leading-tight`}>{PRODUCT}</span>
      <span className={`text-[11px] font-bold uppercase tracking-wider text-white rounded px-2 py-0.5 ${IS_STANDARD ? 'bg-[#0065a5]' : 'bg-[#008540]'}`} title={`This is the ${VARIANT} version`}>
        {VARIANT}
      </span>
    </span>
  );
}

export function Field({ label, hint, children, className = '' }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label className="block text-xs font-semibold text-slate-800 mb-1">{label}</label>
      {children}
      {hint && <p className="text-xs text-slate-500 mt-1">{hint}</p>}
    </div>
  );
}

/** A number input that allows clearing (null) and keeps the arrows stepping from the shown value. */
export function NumberInput({ value, onChange, placeholder, min, max, step = 'any', disabled, className = inputCls }: {
  value: number | null; onChange: (v: number | null) => void; placeholder?: string;
  min?: number; max?: number; step?: number | 'any'; disabled?: boolean; className?: string;
}) {
  return (
    <input
      type="number" min={min} max={max} step={step} disabled={disabled} placeholder={placeholder}
      className={className}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
    />
  );
}

export const LevelChip = ({ level }: { level: Level }) => (
  <span className={`whitespace-nowrap text-[11px] font-semibold border rounded px-1.5 py-0.5 ${LEVEL_UI[level].chip} ${LEVEL_UI[level].text}`}>
    {level === 'info' ? 'Note' : `${LEVEL_UI[level].label} impact`}
  </span>
);

const CONF_UI: Record<Confidence, string> = {
  high: 'bg-[#0065a5] text-white border-[#0065a5]',
  medium: 'bg-white text-[#0065a5] border-[#0065a5]',
  low: 'bg-white text-slate-500 border-slate-300 border-dashed',
};

export const ConfidenceChip = ({ confidence, title }: { confidence: Confidence; title?: string }) => (
  <span title={title} className={`whitespace-nowrap text-[11px] font-semibold border rounded px-1.5 py-0.5 ${CONF_UI[confidence]}`}>
    {confidence[0].toUpperCase() + confidence.slice(1)} confidence
  </span>
);

const STATUS_UI: Record<ActionStatus, string> = {
  new: 'bg-slate-100 text-slate-700', review: 'bg-blue-50 text-[#0065a5]', visit: 'bg-amber-50 text-[#8a6100]',
  confirmed: 'bg-indigo-50 text-indigo-700', agreed: 'bg-teal-50 text-teal-700', implemented: 'bg-green-50 text-[#08780a]',
  closed: 'bg-slate-50 text-slate-400',
};

export const StatusChip = ({ status }: { status: ActionStatus }) => (
  <span className={`whitespace-nowrap text-[11px] font-semibold rounded px-1.5 py-0.5 ${STATUS_UI[status]}`}>{STATUS_LABEL[status]}</span>
);

/** "Measured", "Estimate" or "Scenario" label, so derived numbers never pass as measurements. */
export const Kind = ({ kind }: { kind: 'measured' | 'estimate' | 'scenario' }) => (
  <span className={`text-[10px] font-semibold uppercase tracking-wide rounded px-1.5 py-0.5 ${
    kind === 'measured' ? 'bg-slate-100 text-slate-600' : kind === 'estimate' ? 'bg-amber-50 text-[#8a6100]' : 'bg-violet-50 text-violet-700'
  }`}>{kind}</span>
);

export function Note({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'warn' | 'bad' }) {
  const cls = tone === 'warn' ? 'bg-amber-50 border-amber-200 text-amber-900'
    : tone === 'bad' ? 'bg-red-50 border-red-200 text-red-800' : 'bg-slate-50 border-slate-200 text-slate-700';
  return <div className={`border rounded-lg px-4 py-2.5 text-sm ${cls}`}>{children}</div>;
}
