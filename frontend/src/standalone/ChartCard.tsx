import { useRef, type ReactNode } from 'react';
import { downloadChartPng } from './chartDownload';

/**
 * A chart in a card: title, a subtitle naming what and when, controls on the
 * right, and a download button that saves the chart as a PNG.
 */
export function ChartCard({ title, subtitle, controls, file, children, footer }: {
  title: ReactNode; subtitle?: ReactNode; controls?: ReactNode; file: string; children: ReactNode; footer?: ReactNode;
}) {
  const body = useRef<HTMLDivElement>(null);
  return (
    <section className="bg-white rounded-xl border border-slate-300 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-lg font-bold tracking-tight text-slate-900">{title}</h3>
          {subtitle && <p className="text-sm text-slate-600 mt-1">{subtitle}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {controls}
          <button type="button" onClick={() => void downloadChartPng(body.current, file)} title="Download this chart as a picture (PNG)"
            className="text-[#008540] hover:text-[#006832] border border-slate-200 hover:border-[#008540] rounded-md p-1.5" aria-label="Download chart">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
              <path d="M8 2v8M4.5 6.5 8 10l3.5-3.5M2.5 12.5v1h11v-1" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </div>
      <div ref={body}>{children}</div>
      {footer && <div className="text-xs text-slate-500 mt-2">{footer}</div>}
    </section>
  );
}

/** A small two-or-more-way switch, as used above charts. */
export function Toggle<T extends string>({ value, options, onChange }: {
  value: T; options: readonly (readonly [T, string])[]; onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex rounded-full bg-slate-100 p-0.5 text-xs font-medium">
      {options.map(([k, label]) => (
        <button key={k} type="button" onClick={() => onChange(k)} aria-pressed={value === k}
          className={`px-3 py-1 rounded-full ${value === k ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}>
          {label}
        </button>
      ))}
    </div>
  );
}
