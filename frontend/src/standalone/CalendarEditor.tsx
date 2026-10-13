import { useMemo, useState } from 'react';
import {
  DAY_NAMES, describePeriods, slotTime, type Calendar, type DatedHours, type DatedRange, type HolidayTreatment, type Period,
} from '../local/calendar';
import { holidaysBetween, NATION_LABEL, type Nation } from '../local/holidays';
import { fmtDayMonYear } from '../local/dates';
import { parseDate } from '../local/parser';
import { linkBtn, smallInput } from './format';

const SLOT_OPTIONS = Array.from({ length: 49 }, (_, i) => i);
const newId = () => (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);

/** Opening periods for one day: any number, each can run past midnight. */
export function PeriodsEditor({ periods, onChange, disabled }: { periods: Period[]; onChange: (p: Period[]) => void; disabled?: boolean }) {
  const set = (k: number, patch: Partial<Period>) => onChange(periods.map((p, i) => (i === k ? { ...p, ...patch } : p)));
  return (
    <div className="flex flex-wrap items-center gap-2">
      {!periods.length && <span className="text-sm text-slate-400 w-14">Closed</span>}
      {periods.map((p, k) => {
        const allDay = p.open === 0 && p.close >= 48;
        const night = !allDay && p.close <= p.open;
        return (
          <span key={k} className="inline-flex items-center gap-1 bg-slate-50 border border-slate-200 rounded-md px-1.5 py-1">
            <select disabled={disabled} className={smallInput} value={p.open} onChange={(e) => set(k, { open: Number(e.target.value) })} aria-label="Opens">
              {SLOT_OPTIONS.slice(0, 48).map((s) => <option key={s} value={s}>{slotTime(s)}</option>)}
            </select>
            <span className="text-slate-400 text-xs">to</span>
            <select disabled={disabled} className={smallInput} value={p.close} onChange={(e) => set(k, { close: Number(e.target.value) })} aria-label="Closes">
              {SLOT_OPTIONS.slice(1).map((s) => <option key={s} value={s}>{slotTime(s)}{s <= p.open && s < 48 ? ' next day' : ''}</option>)}
            </select>
            {night && <span className="text-[10px] font-semibold text-indigo-700 bg-indigo-50 rounded px-1">overnight</span>}
            {allDay && <span className="text-[10px] font-semibold text-slate-600 bg-slate-200 rounded px-1">24 h</span>}
            {!disabled && <button onClick={() => onChange(periods.filter((_, i) => i !== k))} className="text-slate-400 hover:text-red-600 px-1" aria-label="Remove period">×</button>}
          </span>
        );
      })}
      {!disabled && (
        <>
          <button onClick={() => onChange([...periods, { open: 16, close: 36 }])} className="text-xs text-[#0065a5] hover:underline">+ period</button>
          <button onClick={() => onChange([{ open: 0, close: 48 }])} className="text-xs text-slate-500 hover:underline">24 hours</button>
          {periods.length > 0 && <button onClick={() => onChange([])} className="text-xs text-slate-500 hover:underline">closed</button>}
        </>
      )}
    </div>
  );
}

/** Parse pasted closure lines: "01/04/2025 - 14/04/2025 Easter holiday" or "2025-07-23 2025-09-02 Summer". */
function parseRanges(text: string): DatedRange[] {
  const out: DatedRange[] = [];
  for (const line of text.split(/\r?\n/)) {
    const tokens = line.trim().match(/(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})/g);
    if (!tokens?.length) continue;
    const from = parseDate(tokens[0]);
    const to = parseDate(tokens[1] ?? tokens[0]);
    if (!from || !to) continue;
    const label = line.replace(/(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})/g, '').replace(/^[\s,;:-]+|[\s,;:-]+$/g, '').replace(/\s*(to|-)\s*/i, ' ').trim();
    out.push({ id: newId(), from: from <= to ? from : to, to: from <= to ? to : from, label: label || 'Closure' });
  }
  return out;
}

export default function CalendarEditor({ calendar: cal, onChange, dataFrom, dataTo, locked }: {
  calendar: Calendar;
  onChange: (c: Calendar) => void;
  dataFrom: string;
  dataTo: string;
  locked: boolean;
}) {
  const set = (patch: Partial<Calendar>) => onChange({ ...cal, ...patch });
  const setDay = (d: number, p: Period[]) => set({ week: cal.week.map((x, i) => (i === d ? p : x)) });
  const [newClosure, setNewClosure] = useState({ from: '', to: '', label: '' });
  const [paste, setPaste] = useState('');
  const [newHoliday, setNewHoliday] = useState('');
  const official = useMemo(() => (dataFrom ? [...holidaysBetween(dataFrom, dataTo, cal.nation)].sort() : []), [dataFrom, dataTo, cal.nation]);
  const holidays = [...new Set([...official, ...cal.holidaysAdded])].sort();

  return (
    <div className="space-y-5">
      <label className={`flex items-start gap-2 rounded-lg border px-3 py-2 ${cal.confirmed ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'}`}>
        <input type="checkbox" disabled={locked} checked={cal.confirmed} onChange={(e) => set({ confirmed: e.target.checked })} className="mt-0.5 accent-[#008540]" />
        <span className="text-sm">
          <span className="font-semibold">Hours confirmed with the site.</span>{' '}
          <span className="text-slate-600">{cal.confirmed ? 'Findings that depend on the calendar can reach high confidence.'
            : 'Presets are a starting point only. Until this is ticked, findings that depend on opening hours are capped at medium confidence.'}</span>
        </span>
      </label>

      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
          <p className="text-sm font-semibold text-slate-700">Weekly hours <span className="font-normal text-slate-400">(anything outside these is closed hours)</span></p>
          {!locked && <button className="text-xs text-[#0065a5] hover:underline" onClick={() => set({ week: cal.week.map((x, i) => (i > 0 && i < 5 ? cal.week[0].map((p) => ({ ...p })) : x)) })}>Copy Monday to Tuesday-Friday</button>}
        </div>
        <div className="space-y-1.5">
          {DAY_NAMES.map((name, d) => (
            <div key={name} className="grid grid-cols-[6.5rem_1fr] items-center gap-2">
              <span className="text-sm text-slate-600">{name}</span>
              <PeriodsEditor periods={cal.week[d]} onChange={(p) => setDay(d, p)} disabled={locked} />
            </div>
          ))}
        </div>
        <p className="text-xs text-slate-400 mt-2">A period that closes at or before it opens runs overnight: Monday 22:00 to 06:00 covers Tuesday 00:00 to 06:00.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <p className="text-sm font-semibold text-slate-700 mb-2">Bank holidays</p>
          <div className="flex flex-wrap gap-2 mb-2">
            <select disabled={locked} className={smallInput} value={cal.nation} onChange={(e) => set({ nation: e.target.value as Nation })}>
              {(Object.keys(NATION_LABEL) as Nation[]).map((n) => <option key={n} value={n}>{NATION_LABEL[n]}</option>)}
            </select>
            <select disabled={locked} className={smallInput} value={cal.holidays} onChange={(e) => set({ holidays: e.target.value as HolidayTreatment })}>
              <option value="closed">Closed on bank holidays</option>
              <option value="sunday">Sunday hours on bank holidays</option>
              <option value="normal">Normal hours on bank holidays</option>
            </select>
          </div>
          <div className="max-h-44 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100">
            {holidays.length ? holidays.map((d) => {
              const removed = cal.holidaysRemoved.includes(d);
              const added = cal.holidaysAdded.includes(d);
              return (
                <label key={d} className="flex items-center gap-2 px-2 py-1 text-sm">
                  <input type="checkbox" disabled={locked} checked={!removed}
                    onChange={(e) => {
                      if (added && !e.target.checked) set({ holidaysAdded: cal.holidaysAdded.filter((x) => x !== d) });
                      else set({ holidaysRemoved: e.target.checked ? cal.holidaysRemoved.filter((x) => x !== d) : [...cal.holidaysRemoved, d] });
                    }} />
                  <span className={removed ? 'line-through text-slate-400' : 'text-slate-700'}>{fmtDayMonYear(d)}</span>
                  {added && <span className="text-[10px] text-slate-500">added</span>}
                </label>
              );
            }) : <p className="text-sm text-slate-400 px-2 py-1">No bank holidays in the data period.</p>}
          </div>
          {!locked && (
            <div className="flex gap-2 mt-2">
              <input type="date" className={smallInput} value={newHoliday} onChange={(e) => setNewHoliday(e.target.value)} aria-label="Extra holiday" />
              <button disabled={!newHoliday} className="text-xs text-[#0065a5] hover:underline disabled:opacity-40"
                onClick={() => { set({ holidaysAdded: [...new Set([...cal.holidaysAdded, newHoliday])] }); setNewHoliday(''); }}>+ add a holiday</button>
            </div>
          )}
        </div>

        <div>
          <p className="text-sm font-semibold text-slate-700 mb-1">Low-activity window <span className="font-normal text-slate-400">(24-7 sites)</span></p>
          <p className="text-xs text-slate-500 mb-2">A site open all the time has no closed hours. This window stands in for them when working out a closed-hours style reference. It is not treated as a closure.</p>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-sm text-slate-600">
              <input type="checkbox" disabled={locked} checked={!!cal.lowActivity} onChange={(e) => set({ lowActivity: e.target.checked ? { open: 2, close: 10 } : null })} />
              Use
            </label>
            {cal.lowActivity && (
              <>
                <select disabled={locked} className={smallInput} value={cal.lowActivity.open} onChange={(e) => set({ lowActivity: { ...cal.lowActivity!, open: Number(e.target.value) } })}>
                  {SLOT_OPTIONS.slice(0, 48).map((s) => <option key={s} value={s}>{slotTime(s)}</option>)}
                </select>
                <span className="text-xs text-slate-400">to</span>
                <select disabled={locked} className={smallInput} value={cal.lowActivity.close} onChange={(e) => set({ lowActivity: { ...cal.lowActivity!, close: Number(e.target.value) } })}>
                  {SLOT_OPTIONS.slice(1).map((s) => <option key={s} value={s}>{slotTime(s)}</option>)}
                </select>
              </>
            )}
          </div>
        </div>
      </div>

      <div>
        <p className="text-sm font-semibold text-slate-700 mb-1">Dated closures <span className="font-normal text-slate-400">(school holidays, shutdowns: the site is closed all day)</span></p>
        <p className="text-xs text-slate-500 mb-2">School term dates are never assumed from the building type. Enter them here, or paste them.</p>
        {cal.closures.length > 0 && (
          <table className="w-full text-sm mb-2">
            <tbody>
              {cal.closures.map((r) => (
                <tr key={r.id} className="border-b border-slate-100">
                  <td className="py-1 pr-2"><input disabled={locked} className={`${smallInput} w-full`} value={r.label} onChange={(e) => set({ closures: cal.closures.map((x) => (x.id === r.id ? { ...x, label: e.target.value } : x)) })} /></td>
                  <td className="py-1 pr-2"><input disabled={locked} type="date" className={smallInput} value={r.from} onChange={(e) => set({ closures: cal.closures.map((x) => (x.id === r.id ? { ...x, from: e.target.value } : x)) })} /></td>
                  <td className="py-1 pr-2"><input disabled={locked} type="date" className={smallInput} value={r.to} onChange={(e) => set({ closures: cal.closures.map((x) => (x.id === r.id ? { ...x, to: e.target.value } : x)) })} /></td>
                  <td className="py-1 text-right">{!locked && <button className="text-xs text-slate-400 hover:text-red-600" onClick={() => set({ closures: cal.closures.filter((x) => x.id !== r.id) })}>Remove</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {!locked && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <input className={smallInput} placeholder="Label, e.g. Summer holiday" value={newClosure.label} onChange={(e) => setNewClosure({ ...newClosure, label: e.target.value })} />
              <input type="date" className={smallInput} value={newClosure.from} onChange={(e) => setNewClosure({ ...newClosure, from: e.target.value })} aria-label="From" />
              <input type="date" className={smallInput} value={newClosure.to} onChange={(e) => setNewClosure({ ...newClosure, to: e.target.value })} aria-label="To" />
              <button disabled={!newClosure.from} className="text-xs text-[#0065a5] hover:underline disabled:opacity-40"
                onClick={() => {
                  const to = newClosure.to || newClosure.from;
                  set({ closures: [...cal.closures, { id: newId(), from: newClosure.from, to, label: newClosure.label || 'Closure' }] });
                  setNewClosure({ from: '', to: '', label: '' });
                }}>+ add closure</button>
            </div>
            <details className="text-sm">
              <summary className={linkBtn}>Paste several closures</summary>
              <textarea rows={4} className={`${smallInput} w-full mt-2 font-mono text-xs`} value={paste} onChange={(e) => setPaste(e.target.value)}
                placeholder={'One per line: from, to, label\n14/04/2025 - 25/04/2025 Easter holiday\n23/07/2025 - 02/09/2025 Summer holiday'} />
              <button className="text-xs text-[#0065a5] hover:underline" onClick={() => {
                const ranges = parseRanges(paste);
                if (ranges.length) { set({ closures: [...cal.closures, ...ranges] }); setPaste(''); }
              }}>Add {parseRanges(paste).length || ''} closure{parseRanges(paste).length === 1 ? '' : 's'}</button>
            </details>
          </div>
        )}
      </div>

      <div>
        <p className="text-sm font-semibold text-slate-700 mb-1">Exceptional operating periods <span className="font-normal text-slate-400">(dates with different hours: events, extended opening, works)</span></p>
        {cal.exceptions.map((x) => (
          <div key={x.id} className="border border-slate-200 rounded-lg p-2 mb-2 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <input disabled={locked} className={smallInput} value={x.label} onChange={(e) => set({ exceptions: cal.exceptions.map((y) => (y.id === x.id ? { ...y, label: e.target.value } : y)) })} />
              <input disabled={locked} type="date" className={smallInput} value={x.from} onChange={(e) => set({ exceptions: cal.exceptions.map((y) => (y.id === x.id ? { ...y, from: e.target.value } : y)) })} />
              <input disabled={locked} type="date" className={smallInput} value={x.to} onChange={(e) => set({ exceptions: cal.exceptions.map((y) => (y.id === x.id ? { ...y, to: e.target.value } : y)) })} />
              {!locked && <button className="text-xs text-slate-400 hover:text-red-600 ml-auto" onClick={() => set({ exceptions: cal.exceptions.filter((y) => y.id !== x.id) })}>Remove</button>}
            </div>
            <PeriodsEditor periods={x.periods} disabled={locked} onChange={(p) => set({ exceptions: cal.exceptions.map((y) => (y.id === x.id ? { ...y, periods: p } : y)) })} />
            <p className="text-xs text-slate-400">Every day in this range: {describePeriods(x.periods)}</p>
          </div>
        ))}
        {!locked && (
          <button className="text-xs text-[#0065a5] hover:underline" onClick={() => {
            const d = dataTo || new Date().toISOString().slice(0, 10);
            const ex: DatedHours = { id: newId(), from: d, to: d, label: 'Exceptional hours', periods: [{ open: 14, close: 44 }] };
            set({ exceptions: [...cal.exceptions, ex] });
          }}>+ add exceptional period</button>
        )}
      </div>
    </div>
  );
}
