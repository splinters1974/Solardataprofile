import { useState } from 'react';
import { IS_STANDARD } from '../local/edition';
import type { Finding, SiteTab } from '../local/findings';
import { newAction, STATUS_LABEL, STATUS_ORDER, type Action, type ActionStatus } from '../local/actions';
import { fmtDayMonYear } from '../local/dates';
import { LEVEL_UI } from './levelUi';
import { ConfidenceChip, LevelChip, StatusChip } from './ui';
import { gbp, kwh, smallInput } from './format';

/** Status, owner, target date and notes for one finding. */
export function ActionEditor({ action, onChange, locked, showNotes }: {
  action: Action; onChange: (patch: Partial<Action>) => void; locked: boolean; showNotes: boolean;
}) {
  if (locked) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
        <span>Status:</span> <StatusChip status={action.status} />
        {showNotes && action.owner && <span>Owner: {action.owner}</span>}
        {showNotes && action.targetDate && <span>Target: {fmtDayMonYear(action.targetDate)}</span>}
        {showNotes && action.notes && <span className="basis-full">Notes: {action.notes}</span>}
      </div>
    );
  }
  return (
    <div className="grid gap-2 sm:grid-cols-[11rem_10rem_9.5rem_1fr] items-start">
      <label className="text-xs text-slate-500">Status
        <select className={`${smallInput} w-full mt-0.5`} value={action.status} onChange={(e) => onChange({ status: e.target.value as ActionStatus })}>
          {STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
      </label>
      <label className="text-xs text-slate-500">Owner
        <input className={`${smallInput} w-full mt-0.5`} value={action.owner} onChange={(e) => onChange({ owner: e.target.value })} placeholder="Name" />
      </label>
      <label className="text-xs text-slate-500">Target date
        <input type="date" className={`${smallInput} w-full mt-0.5`} value={action.targetDate} onChange={(e) => onChange({ targetDate: e.target.value })} />
      </label>
      <label className="text-xs text-slate-500">Notes (internal)
        <textarea rows={1} className={`${smallInput} w-full mt-0.5`} value={action.notes} onChange={(e) => onChange({ notes: e.target.value })} />
      </label>
    </div>
  );
}

/** A finding as an investigation record, with the calculation and evidence a click away. */
export default function FindingCard({ f, action, onAction, locked, showNotes, goTo, siteName, defaultOpen = false }: {
  f: Finding;
  action?: Action;
  onAction?: (patch: Partial<Action>) => void;
  locked: boolean;
  showNotes: boolean;
  goTo?: (tab: SiteTab, date?: string) => void;
  siteName?: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const a = action ?? newAction();
  const ui = LEVEL_UI[f.level];
  const money = f.cost ? (f.cost.annual !== null ? `${gbp(f.cost.annual)} a year (estimate)` : `${gbp(f.cost.observed)} in the period`) : null;
  return (
    <li className="flex gap-3 py-3 border-b border-slate-100 last:border-0">
      <span className={`w-1 rounded-full shrink-0 ${ui.bar}`} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <LevelChip level={f.level} />
          <ConfidenceChip confidence={f.confidence} title={f.confidenceReasons.join('; ')} />
          <StatusChip status={a.status} />
          {siteName && (goTo
            ? <button onClick={() => goTo('overview')} className="text-xs font-medium text-[#0065a5] hover:underline ml-1">{siteName} →</button>
            : <span className="text-xs text-slate-500 ml-1">{siteName}</span>)}
        </div>
        <button onClick={() => setOpen((v) => !v)} className="text-left mt-1 group" aria-expanded={open}>
          <span className="font-semibold text-slate-800 group-hover:text-[#0065a5]">{f.title}</span>
          <span className="text-xs text-slate-400 ml-2">{open ? 'Hide detail' : 'Show calculation and evidence'}</span>
        </button>
        <p className="text-sm text-slate-600 mt-0.5 leading-relaxed">{f.detail}</p>
        <p className="text-sm text-slate-800 mt-1"><span className="font-medium">Check: </span>{f.investigation}</p>
        {open && (
          <div className="mt-3 space-y-3 text-sm">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="bg-slate-50 rounded-lg p-3">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Evidence</p>
                <ul className="list-disc pl-4 space-y-0.5 text-slate-700">{f.evidence.map((e, i) => <li key={i}>{e}</li>)}</ul>
                <p className="text-xs text-slate-500 mt-2">
                  Period {fmtDayMonYear(f.period.from)} to {fmtDayMonYear(f.period.to)}
                  {f.kwh && <> · {kwh(f.kwh.observed)} observed{f.kwh.annual !== null && <>, {kwh(f.kwh.annual)} a year (estimate)</>}</>}
                  {money && <> · associated cost {money}</>}
                </p>
              </div>
              <div className="bg-slate-50 rounded-lg p-3">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">How it is worked out</p>
                <ul className="list-disc pl-4 space-y-0.5 text-slate-700">{f.calc.map((e, i) => <li key={i}>{e}</li>)}</ul>
                <p className="text-xs text-slate-500 mt-2">Confidence {f.confidence}: {f.confidenceReasons.join('; ')}.</p>
                {f.related.length > 0 && <p className="text-xs text-slate-500 mt-1">Overlaps with: {f.related.join(', ')}. Do not add these together.</p>}
              </div>
            </div>
            {goTo && f.links.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {f.links.map((l, i) => (
                  <button key={i} onClick={() => goTo(l.tab, l.date)} className="text-xs font-medium border border-[#0065a5] text-[#0065a5] rounded-full px-3 py-1 hover:bg-blue-50">
                    {l.label}{l.date ? `: ${fmtDayMonYear(l.date)}` : ''} →
                  </button>
                ))}
              </div>
            )}
            {onAction && !IS_STANDARD && <ActionEditor action={a} onChange={onAction} locked={locked} showNotes={showNotes} />}
          </div>
        )}
      </div>
    </li>
  );
}
