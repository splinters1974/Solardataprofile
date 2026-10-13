import { useEffect, useMemo, useRef, useState } from 'react';
import { cellKind, drawCarpet, EXCLUDED_CSS, MISSING_CSS, RAMP_CSS } from '../local/carpet';
import { fmtDayMonYear, MONTHS_SHORT } from '../local/dates';
import { calendarDays, FLAG_TEXT, flagAt, INTERVAL_HOURS, type Frame } from '../local/frame';
import { planDay, slotTime, type Calendar } from '../local/calendar';
import Panel from '../components/analyser/Panel';

const HEIGHT = 288; // 6px per half hour

/**
 * Year-at-a-glance heatmap: one column per calendar day (missing days are
 * gaps), one row per half hour. Missing readings are hatched and excluded
 * ones pink, so neither looks like low use. Click a cell to inspect the day.
 */
export default function CarpetPlot({ frame, calendar, onPick, suspect }: {
  frame: Frame;
  calendar?: Calendar;
  onPick?: (date: string) => void;
  suspect?: Map<string, string[]>;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [maxKw, setMaxKw] = useState(0);
  const [overlay, setOverlay] = useState(true);
  const [hover, setHover] = useState<{ x: number; y: number; d: number; s: number; flip: boolean } | null>(null);
  const days = useMemo(() => calendarDays(frame), [frame]);

  useEffect(() => {
    if (canvas.current) setMaxKw(drawCarpet(canvas.current, frame, 1, 1, { calendar, overlay: overlay && !!calendar }));
  }, [frame, calendar, overlay]);

  const months = useMemo(() => days.flatMap((x, i) => (
    x.date.endsWith('-01') || i === 0 ? [{ i, label: MONTHS_SHORT[Number(x.date.slice(5, 7)) - 1] }] : []
  )), [days]);

  const locate = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const d = Math.floor(((e.clientX - rect.left) / rect.width) * days.length);
    const s = Math.floor(((e.clientY - rect.top) / rect.height) * 48);
    if (d < 0 || d >= days.length || s < 0 || s > 47) return null;
    return { x: e.clientX - rect.left, y: e.clientY - rect.top, d, s, flip: e.clientX - rect.left > rect.width * 0.6 };
  };

  const n = days.length;
  const cell = hover ? days[hover.d] : null;
  const kind = cell ? cellKind(frame, cell.i, hover!.s) : null;
  const plan = cell && calendar ? planDay(calendar, cell.date) : null;
  return (
    <Panel
      title="The whole period at a glance"
      subtitle="One column per day, one row per half hour, darker means more demand. Click any day to inspect it."
      action={calendar && (
        <label className="flex items-center gap-1.5 text-xs text-slate-600">
          <input type="checkbox" checked={overlay} onChange={(e) => setOverlay(e.target.checked)} /> Mark opening and closing times
        </label>
      )}
    >
      <div className="flex gap-2">
        <div className="relative text-[10px] text-slate-400 w-9 shrink-0" style={{ height: HEIGHT }}>
          {[0, 6, 12, 18, 24].map((h) => (
            <span key={h} className="absolute right-0 -translate-y-1/2" style={{ top: (h / 24) * HEIGHT }}>
              {String(h).padStart(2, '0')}:00
            </span>
          ))}
        </div>
        <div className="relative flex-1 min-w-0">
          <canvas
            ref={canvas}
            onMouseMove={(e) => setHover(locate(e))}
            onMouseLeave={() => setHover(null)}
            onClick={(e) => { const at = locate(e); if (at && onPick) onPick(days[at.d].date); }}
            className={`w-full border border-slate-200 ${onPick ? 'cursor-pointer' : 'cursor-crosshair'}`}
            style={{ height: HEIGHT, imageRendering: 'pixelated' }}
            role="img"
            aria-label={`Heatmap of half-hourly demand over ${n} days`}
          />
          {hover && cell && (
            <div
              className="pointer-events-none absolute z-10 bg-white border border-slate-200 shadow-md rounded-lg px-3 py-2 text-xs whitespace-nowrap"
              style={{ left: hover.x + 12, top: Math.max(0, hover.y - 60), transform: hover.flip ? 'translateX(calc(-100% - 24px))' : undefined }}
            >
              <p className="font-semibold text-slate-800">{fmtDayMonYear(cell.date)} · {slotTime(hover.s)}</p>
              {kind === 'value' ? (
                <p className="text-slate-600 tabular-nums">
                  {frame.rows[cell.i][hover.s].toLocaleString('en-GB', { maximumFractionDigits: 2 })} kWh ·{' '}
                  {(frame.rows[cell.i][hover.s] / INTERVAL_HOURS).toLocaleString('en-GB', { maximumFractionDigits: 1 })} kW average
                </p>
              ) : (
                <p className="text-slate-500">{cell.i < 0 ? 'Day missing from the file' : FLAG_TEXT[flagAt(frame, cell.i, hover.s)]}</p>
              )}
              {plan && <p className="text-slate-500">{plan.open[hover.s] ? 'Open' : 'Closed'} ({plan.cls})</p>}
              {suspect?.get(cell.date) && <p className="text-[#8a6100]">Data question: {suspect.get(cell.date)!.join('; ')}</p>}
              {onPick && <p className="text-slate-400">Click to inspect this day</p>}
            </div>
          )}
          <div className="relative h-4 text-[10px] text-slate-400 mt-1">
            {months.map((mo) => (
              <span key={mo.i} className="absolute" style={{ left: `${(mo.i / n) * 100}%` }}>{mo.label}</span>
            ))}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 mt-3 text-xs text-slate-500 pl-11">
        <span className="flex items-center gap-2">0 kW
          <span className="h-2.5 w-40 rounded-sm border border-slate-200" style={{ background: RAMP_CSS }} />
          {maxKw.toLocaleString('en-GB', { maximumFractionDigits: 1 })} kW and above</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-4 border border-slate-200" style={{ background: MISSING_CSS }} /> no valid reading</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-4 border border-slate-200" style={{ background: EXCLUDED_CSS }} /> excluded or held back</span>
        {calendar && overlay && <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 bg-[#b45309]" /> opens or closes</span>}
      </div>
    </Panel>
  );
}
