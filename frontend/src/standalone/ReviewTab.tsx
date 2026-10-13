import { useState } from 'react';
import { fmtDayMonYear } from '../local/dates';
import { slotTime } from '../local/calendar';
import { FLAG, flagCounts, FLAG_TEXT, type Exclusion } from '../local/frame';
import type { SiteSettings } from '../local/site';
import type { SiteSummary } from '../local/localClient';
import type { SiteTab } from '../local/findings';
import QualityPanel from './QualityPanel';
import { Card } from './ui';
import { num, smallInput } from './format';

const newId = () => (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);
const SLOTS = Array.from({ length: 49 }, (_, i) => i);

/**
 * What was read, what was held back and why, and the engineer's review:
 * exclusions with reasons, flagged days kept as genuine, which copy of a
 * duplicate date to use, and clock-change days to keep. Raw readings are
 * never changed; every decision is recorded and exported.
 */
export default function ReviewTab({ site, onChange, locked, goTo }: {
  site: SiteSummary;
  onChange: (s: SiteSettings) => void;
  locked: boolean;
  goTo: (tab: SiteTab, date?: string) => void;
}) {
  const st = site.settings;
  const review = st.review;
  const setReview = (patch: Partial<SiteSettings['review']>) => onChange({ ...st, review: { ...review, ...patch } });
  const [draft, setDraft] = useState({ from: '', to: '', window: false, start: 0, end: 12, reason: '' });
  const counts = flagCounts(site.frame);
  const unsafeDays = site.frame.dates.filter((_, i) => site.frame.flags?.[i]?.some((f) => f === FLAG.DST_UNSAFE));

  const exclude = (dates: string[], reason: string) => {
    const add: Exclusion[] = dates.map((d) => ({ id: newId(), from: d, to: d, reason, source: 'quality' }));
    setReview({ exclusions: [...review.exclusions, ...add] });
  };

  return (
    <div className="space-y-4">
      <Card title="How the file was read">
        <dl className="grid gap-x-6 gap-y-2 md:grid-cols-2 text-sm">
          <div><dt className="text-xs text-slate-500">File</dt><dd>{site.filename} ({site.info.layout.replace('-', ' ')})</dd></div>
          <div><dt className="text-xs text-slate-500">Meter reference</dt><dd>{st.meterId || 'none found'}</dd></div>
          <div><dt className="text-xs text-slate-500">Unit</dt><dd>{st.unit}. {site.info.unitEvidence}</dd></div>
          <div><dt className="text-xs text-slate-500">Times</dt><dd>{site.info.conventionEvidence}</dd></div>
          <div className="md:col-span-2"><dt className="text-xs text-slate-500">Clock changes</dt><dd>{site.info.clockNote}</dd></div>
        </dl>
        {site.warnings.length > 0 && (
          <div className="mt-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2 text-sm text-amber-900 space-y-0.5">
            {site.warnings.map((w, i) => <p key={i}>{w}</p>)}
          </div>
        )}
        <div className="flex flex-wrap gap-2 mt-3 text-xs">
          {Object.entries(counts).map(([code, n]) => (
            <span key={code} className="bg-slate-100 rounded px-2 py-1">{FLAG_TEXT[Number(code)]}: {num(n)} half hours</span>
          ))}
          {!Object.keys(counts).length && <span className="text-slate-500">Every half hour in the file has a valid reading.</span>}
        </div>
      </Card>

      <QualityPanel
        report={site.quality}
        actions={locked ? undefined : {
          exclude: (dates, why) => exclude(dates, why),
          keep: (dates) => setReview({ reviewedOk: [...new Set([...review.reviewedOk, ...dates])] }),
          inspect: (d) => goTo('heatmap', d),
        }}
      />

      <Card title="Exclusions" subtitle="Readings left out of every figure, with the reason. The raw file is untouched; remove an exclusion to bring the readings back.">
        {review.exclusions.length ? (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-slate-500"><th className="py-1 font-medium">Dates</th><th className="font-medium">Half hours</th><th className="font-medium">Reason</th><th className="font-medium">Source</th><th /></tr></thead>
            <tbody>
              {review.exclusions.map((x) => (
                <tr key={x.id} className="border-t border-slate-100">
                  <td className="py-1.5 pr-2 whitespace-nowrap">{fmtDayMonYear(x.from)}{x.to !== x.from && ` to ${fmtDayMonYear(x.to)}`}</td>
                  <td className="pr-2">{x.startSlot !== undefined && x.endSlot !== undefined ? `${slotTime(x.startSlot)}-${slotTime(x.endSlot)}` : 'whole day'}</td>
                  <td className="pr-2">{locked ? x.reason : (
                    <input className={`${smallInput} w-full`} value={x.reason} onChange={(e) => setReview({ exclusions: review.exclusions.map((y) => (y.id === x.id ? { ...y, reason: e.target.value } : y)) })} />
                  )}</td>
                  <td className="pr-2 text-xs text-slate-500">{x.source === 'quality' ? 'data quality' : 'by hand'}</td>
                  <td className="text-right">{!locked && <button className="text-xs text-slate-400 hover:text-red-600" onClick={() => setReview({ exclusions: review.exclusions.filter((y) => y.id !== x.id) })}>Remove</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="text-sm text-slate-500">Nothing excluded.</p>}
        {!locked && (
          <div className="mt-3 flex flex-wrap items-end gap-2 bg-slate-50 rounded-lg p-3">
            <label className="text-xs text-slate-500">From<br /><input type="date" className={smallInput} value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} /></label>
            <label className="text-xs text-slate-500">To<br /><input type="date" className={smallInput} value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} /></label>
            <label className="text-xs text-slate-500 flex items-center gap-1 pb-1.5"><input type="checkbox" checked={draft.window} onChange={(e) => setDraft({ ...draft, window: e.target.checked })} /> only between</label>
            {draft.window && (
              <>
                <select className={smallInput} value={draft.start} onChange={(e) => setDraft({ ...draft, start: Number(e.target.value) })}>{SLOTS.slice(0, 48).map((s) => <option key={s} value={s}>{slotTime(s)}</option>)}</select>
                <select className={smallInput} value={draft.end} onChange={(e) => setDraft({ ...draft, end: Number(e.target.value) })}>{SLOTS.slice(1).map((s) => <option key={s} value={s}>{slotTime(s)}</option>)}</select>
              </>
            )}
            <label className="text-xs text-slate-500 flex-1 min-w-48">Reason (required)<br /><input className={`${smallInput} w-full`} value={draft.reason} placeholder="e.g. meter fault confirmed by the supplier" onChange={(e) => setDraft({ ...draft, reason: e.target.value })} /></label>
            <button disabled={!draft.from || !draft.reason.trim()} className="text-sm font-semibold bg-[#0065a5] text-white rounded-lg px-3 py-1.5 disabled:opacity-40"
              onClick={() => {
                const x: Exclusion = { id: newId(), from: draft.from, to: draft.to || draft.from, reason: draft.reason.trim(), source: 'manual',
                  ...(draft.window ? { startSlot: draft.start, endSlot: draft.end } : {}) };
                setReview({ exclusions: [...review.exclusions, x] });
                setDraft({ from: '', to: '', window: false, start: 0, end: 12, reason: '' });
              }}>Exclude</button>
          </div>
        )}
      </Card>

      {(site.conflicts.length > 0 || unsafeDays.length > 0 || review.dstKeep.length > 0 || review.reviewedOk.length > 0) && (
        <Card title="Held back for review">
          {site.conflicts.length > 0 && (
            <div className="mb-4">
              <p className="text-sm font-semibold text-slate-700 mb-1">Dates that appear twice with different readings</p>
              <p className="text-xs text-slate-500 mb-2">Left out until you choose. Readings are never added together.</p>
              <table className="w-full text-sm">
                <tbody>
                  {site.conflicts.map((c) => {
                    const i = site.frame.dates.indexOf(c.date);
                    const first = i >= 0 ? site.frame.rows[i].reduce((a, b) => a + b, 0) : 0;
                    const second = c.second.reduce((a, b) => a + b, 0);
                    return (
                      <tr key={c.date} className="border-t border-slate-100">
                        <td className="py-1.5 pr-3 whitespace-nowrap">{fmtDayMonYear(c.date)}</td>
                        <td className="pr-3 text-xs text-slate-500">first row {num(first, 1)} kWh · second row {num(second, 1)} kWh</td>
                        <td>
                          <select disabled={locked} className={smallInput} value={review.duplicates[c.date] ?? 'exclude'}
                            onChange={(e) => setReview({ duplicates: { ...review.duplicates, [c.date]: e.target.value as 'first' | 'second' | 'exclude' } })}>
                            <option value="exclude">Leave out (default)</option>
                            <option value="first">Use the first row</option>
                            <option value="second">Use the second row</option>
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {(unsafeDays.length > 0 || review.dstKeep.length > 0) && (
            <div className="mb-4">
              <p className="text-sm font-semibold text-slate-700 mb-1">Clock-change days that could not be read safely</p>
              <p className="text-xs text-slate-500 mb-2">These days had 48 readings where the clocks changed, so it is not clear which hour is missing or repeated. Keep one only if you have checked the file.</p>
              {[...new Set([...unsafeDays, ...review.dstKeep])].sort().map((d) => (
                <label key={d} className="flex items-center gap-2 text-sm py-0.5">
                  <input type="checkbox" disabled={locked} checked={review.dstKeep.includes(d)}
                    onChange={(e) => setReview({ dstKeep: e.target.checked ? [...review.dstKeep, d] : review.dstKeep.filter((x) => x !== d) })} />
                  Keep {fmtDayMonYear(d)} as read
                </label>
              ))}
            </div>
          )}
          {review.reviewedOk.length > 0 && (
            <div>
              <p className="text-sm font-semibold text-slate-700 mb-1">Flagged days reviewed and kept as genuine</p>
              <div className="flex flex-wrap gap-1.5">
                {review.reviewedOk.map((d) => (
                  <span key={d} className="text-xs bg-slate-100 rounded px-2 py-1">
                    {fmtDayMonYear(d)}
                    {!locked && <button className="ml-1 text-slate-400 hover:text-red-600" onClick={() => setReview({ reviewedOk: review.reviewedOk.filter((x) => x !== d) })} aria-label="Undo">×</button>}
                  </span>
                ))}
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
