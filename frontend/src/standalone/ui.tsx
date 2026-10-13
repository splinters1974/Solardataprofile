/**
 * Small shared pieces for the offline app's screens: cards, tiles, tabs,
 * form fields and the impact, confidence and status chips.
 */
import type { ReactNode } from 'react';
import type { Confidence, Level } from '../local/findings';
import { STATUS_LABEL, type ActionStatus } from '../local/actions';
import { LEVEL_UI } from './levelUi';
import { inputCls } from './format';


export function Card({ title, subtitle, action, children, className = '' }: {
  title?: ReactNode; subtitle?: ReactNode; action?: ReactNode; children?: ReactNode; className?: string;
}) {
  return (
    <section className={`bg-white rounded-xl shadow-sm border border-slate-200 p-6 ${className}`}>
      {(title || action) && (
        <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
          <div className="min-w-0">
            {title && <h3 className="text-base font-semibold text-slate-800">{title}</h3>}
            {subtitle && <p className="text-sm text-slate-500 mt-0.5">{subtitle}</p>}
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
    <div className="bg-white rounded-xl border border-slate-200 px-4 py-3">
      <div className="flex items-start justify-between gap-2">
        <p className={`text-xl font-bold tabular-nums ${tone === 'bad' ? 'text-[#b42c2c]' : tone === 'muted' ? 'text-slate-400' : 'text-slate-800'}`}>{value}</p>
        {tag && <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 bg-slate-100 rounded px-1.5 py-0.5 whitespace-nowrap">{tag}</span>}
      </div>
      <p className="text-xs font-medium text-slate-600 mt-0.5">{label}</p>
      {hint && <p className="text-xs text-slate-400 mt-0.5">{hint}</p>}
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: {
  tabs: { key: T; label: string; badge?: string | number }[]; value: T; onChange: (t: T) => void;
}) {
  return (
    <div className="border-b border-slate-200 overflow-x-auto" role="tablist">
      <div className="flex gap-1 min-w-max">
        {tabs.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={value === t.key}
            onClick={() => onChange(t.key)}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px whitespace-nowrap ${
              value === t.key ? 'border-[#0065a5] text-[#0065a5]' : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            {t.label}
            {t.badge !== undefined && t.badge !== '' && t.badge !== 0 && (
              <span className="ml-1.5 text-[10px] font-semibold bg-slate-100 text-slate-600 rounded-full px-1.5 py-0.5">{t.badge}</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Field({ label, hint, children, className = '' }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
      {children}
      {hint && <p className="text-xs text-slate-400 mt-1">{hint}</p>}
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
