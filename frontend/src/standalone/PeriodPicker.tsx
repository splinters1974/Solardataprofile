import { isMultiYear, yearBlocks } from '../local/period';
import type { AnalysisPeriod, SiteSettings } from '../local/site';
import type { SiteSummary } from '../local/localClient';
import { fmtDayMonYear } from '../local/dates';
import { smallInput } from './format';

const months = (from: string, to: string) =>
  Math.round(((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000 + 1) / 30.44);

/**
 * Which part of the file is analysed. Shown prominently when the file holds
 * more than a year; the default is the last 12 months.
 */
export default function PeriodPicker({ site, onChange }: { site: SiteSummary; onChange: (s: SiteSettings) => void }) {
  const r = site.period;
  const p = site.settings.period ?? { mode: 'last12' };
  const multi = isMultiYear(r.fileFrom, r.fileTo);
  const blocks = yearBlocks(r.fileFrom, r.fileTo);
  const set = (period: AnalysisPeriod) => onChange({ ...site.settings, period });
  const value = p.mode === 'year' ? `year-${p.yearsBack ?? 0}` : p.mode;
  const fileText = `The file covers ${fmtDayMonYear(r.fileFrom)} to ${fmtDayMonYear(r.fileTo)} (${months(r.fileFrom, r.fileTo)} months).`;

  if (!multi && !r.trimmed && p.mode === 'last12') {
    return <p className="text-xs text-slate-500">Analysis period: the whole file. {fileText}</p>;
  }
  return (
    <div className={`rounded-xl border px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-2 ${multi ? 'bg-[#e6f0f7] border-[#b9d3ef]' : 'bg-white border-slate-200'}`}>
      <label className="text-sm font-semibold text-slate-800 flex items-center gap-2">
        Analysis period
        <select className={`${smallInput} font-normal`} value={value} onChange={(e) => {
          const v = e.target.value;
          if (v === 'last12') set({ mode: 'last12' });
          else if (v === 'all') set({ mode: 'all' });
          else if (v === 'custom') set({ mode: 'custom', from: r.from, to: r.to });
          else set({ mode: 'year', yearsBack: Number(v.split('-')[1]) });
        }}>
          <option value="last12">Last 12 months</option>
          {blocks.slice(1).map((b, k) => (
            <option key={b.to} value={`year-${k + 1}`}>12 months to {fmtDayMonYear(b.to)}{months(b.from, b.to) < 12 ? ` (${months(b.from, b.to)} months in file)` : ''}</option>
          ))}
          <option value="all">Whole file</option>
          <option value="custom">Custom dates</option>
        </select>
      </label>
      {p.mode === 'custom' && (
        <span className="flex items-center gap-2 text-sm">
          <input type="date" className={smallInput} value={p.from ?? r.from} min={r.fileFrom} max={r.fileTo} onChange={(e) => e.target.value && set({ ...p, from: e.target.value })} />
          <span className="text-slate-400">to</span>
          <input type="date" className={smallInput} value={p.to ?? r.to} min={r.fileFrom} max={r.fileTo} onChange={(e) => e.target.value && set({ ...p, to: e.target.value })} />
        </span>
      )}
      <span className="text-sm text-slate-700"><strong>{fmtDayMonYear(r.from)} to {fmtDayMonYear(r.to)}</strong></span>
      <p className="text-xs text-slate-600 basis-full">
        {fileText} Headline figures, findings, ranking, scenarios and reports use the analysis period.
        Base load by month and its year-on-year change, compare periods, and before-and-after use the whole file.
        {p.mode === 'all' && multi && ' Whole file: annual figures are the average year across the file, so older years count as much as recent ones.'}
      </p>
    </div>
  );
}
