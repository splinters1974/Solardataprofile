import { useEffect, useRef, useState } from 'react';
import { drawTimeSeries, indexAt, PAD, seriesValues, type SeriesMode } from '../local/timeseries';
import { fmtDayMonYear } from '../local/dates';
import { hhLabels } from '../local/analytics';
import type { Frame } from '../local/parser';
import Panel from '../components/analyser/Panel';

const HEIGHT = 340;
const LABELS = hhLabels();

/** Every half-hourly reading (or daily total) across the whole period. */
export default function FullPeriodChart({ frame }: { frame: Frame }) {
  const [mode, setMode] = useState<SeriesMode>('hh');
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<{ x: number; y: number; i: number } | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!wrap.current) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)));
    ro.observe(wrap.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (canvas.current && width) {
      drawTimeSeries(canvas.current, frame, mode, width, HEIGHT, window.devicePixelRatio || 1);
    }
  }, [frame, mode, width]);

  const values = seriesValues(frame, mode);

  function onMove(e: React.MouseEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const plotW = width - PAD.left - PAD.right;
    const i = indexAt(frame, mode, (x - PAD.left) / plotW);
    if (i === null) { setHover(null); return; }
    setHover({ x, y: e.clientY - rect.top, i });
  }

  let label = '';
  if (hover) {
    const day = mode === 'hh' ? Math.floor(hover.i / 48) : hover.i;
    label = mode === 'hh'
      ? `${fmtDayMonYear(frame.dates[day])} · ${LABELS[hover.i % 48]}`
      : fmtDayMonYear(frame.dates[day]);
  }

  return (
    <Panel
      title="Every half hour, whole period"
      subtitle="Consumption in date order across the whole file. Use it to spot when the pattern changes, gaps, and odd spikes."
      action={(
        <div className="flex rounded-lg border border-slate-300 overflow-hidden text-xs">
          {([['hh', 'Half-hourly kWh'], ['daily', 'Daily kWh']] as const).map(([m, text]) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-3 py-1.5 ${mode === m ? 'bg-[#0065a5] text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
            >
              {text}
            </button>
          ))}
        </div>
      )}
    >
      <div ref={wrap} className="relative" style={{ height: HEIGHT }}>
        <canvas
          ref={canvas}
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
          style={{ width: '100%', height: HEIGHT }}
          className="cursor-crosshair"
          role="img"
          aria-label={`${mode === 'hh' ? 'Half-hourly' : 'Daily'} consumption over ${frame.dates.length} days`}
        />
        {hover && (
          <>
            <div
              className="pointer-events-none absolute border-l border-slate-400"
              style={{ left: hover.x, top: PAD.top, height: HEIGHT - PAD.top - PAD.bottom }}
            />
            <div
              className="pointer-events-none absolute z-10 bg-white border border-slate-200 shadow-md rounded-lg px-3 py-2 text-xs whitespace-nowrap"
              style={{
                left: hover.x + 12,
                top: Math.max(0, hover.y - 50),
                transform: hover.x > width * 0.6 ? 'translateX(calc(-100% - 24px))' : undefined,
              }}
            >
              <p className="font-semibold text-slate-800">{label}</p>
              <p className="text-slate-600 tabular-nums">
                {values[hover.i].toLocaleString('en-GB', { maximumFractionDigits: 2 })} kWh
                {mode === 'hh' && ` · ${(values[hover.i] * 2).toLocaleString('en-GB', { maximumFractionDigits: 1 })} kW`}
              </p>
            </div>
          </>
        )}
      </div>
    </Panel>
  );
}
