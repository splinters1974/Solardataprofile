import { useEffect, useMemo, useRef, useState } from 'react';
import { drawCarpet, RAMP_CSS } from '../local/carpet';
import { fmtDayMonYear, MONTHS_SHORT } from '../local/dates';
import { hhLabels, KW_PER_KWH_PER_HH } from '../local/analytics';
import type { Frame } from '../local/parser';
import Panel from '../components/analyser/Panel';

const HEIGHT = 288; // 6px per half hour
const LABELS = hhLabels();

/** Year-at-a-glance heatmap with a hover read-out of the exact half hour. */
export default function CarpetPlot({ frame }: { frame: Frame }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [maxKw, setMaxKw] = useState(0);
  const [hover, setHover] = useState<{ x: number; y: number; d: number; s: number; flip: boolean } | null>(null);

  useEffect(() => {
    if (canvas.current) setMaxKw(drawCarpet(canvas.current, frame, 1, 1));
  }, [frame]);

  const months = useMemo(() => frame.dates.flatMap((d, i) => (
    d.endsWith('-01') || i === 0
      ? [{ i, label: MONTHS_SHORT[Number(d.slice(5, 7)) - 1] }]
      : []
  )), [frame]);

  function onMove(e: React.MouseEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const d = Math.floor(((e.clientX - rect.left) / rect.width) * frame.dates.length);
    const s = Math.floor(((e.clientY - rect.top) / rect.height) * 48);
    if (d < 0 || d >= frame.dates.length || s < 0 || s > 47) { setHover(null); return; }
    setHover({ x: e.clientX - rect.left, y: e.clientY - rect.top, d, s, flip: e.clientX - rect.left > rect.width * 0.6 });
  }

  const n = frame.dates.length;
  return (
    <Panel
      title="The year at a glance"
      subtitle="Every half hour in one picture: one column per day, darker means more demand. Look for dark bands outside opening hours, odd days and steps in the pattern."
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
            onMouseMove={onMove}
            onMouseLeave={() => setHover(null)}
            className="w-full border border-slate-200 cursor-crosshair"
            style={{ height: HEIGHT, imageRendering: 'pixelated' }}
            role="img"
            aria-label={`Heatmap of half-hourly demand over ${n} days`}
          />
          {hover && (
            <div
              className="pointer-events-none absolute z-10 bg-white border border-slate-200 shadow-md rounded-lg px-3 py-2 text-xs whitespace-nowrap"
              style={{
                left: hover.x + 12,
                top: Math.max(0, hover.y - 48),
                transform: hover.flip ? 'translateX(calc(-100% - 24px))' : undefined,
              }}
            >
              <p className="font-semibold text-slate-800">
                {fmtDayMonYear(frame.dates[hover.d])} · {LABELS[hover.s]}
              </p>
              <p className="text-slate-600 tabular-nums">
                {(frame.rows[hover.d][hover.s] * KW_PER_KWH_PER_HH).toLocaleString('en-GB', { maximumFractionDigits: 1 })} kW
              </p>
            </div>
          )}
          <div className="relative h-4 text-[10px] text-slate-400 mt-1">
            {months.map((m) => (
              <span key={m.i} className="absolute" style={{ left: `${(m.i / n) * 100}%` }}>{m.label}</span>
            ))}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 mt-3 text-xs text-slate-500 pl-11">
        <span>0 kW</span>
        <span className="h-2.5 w-40 rounded-sm border border-slate-200" style={{ background: RAMP_CSS }} />
        <span>{maxKw.toLocaleString('en-GB', { maximumFractionDigits: 1 })} kW and above</span>
      </div>
    </Panel>
  );
}
