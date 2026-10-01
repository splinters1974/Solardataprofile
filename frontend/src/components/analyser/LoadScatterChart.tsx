import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { ScatterResponse, ScatterPoint } from '../../types';
import Panel from './Panel';

const GROUPS = [
  { type: 'Weekday', colour: '#0f766e' },
  { type: 'Weekend', colour: '#f59e0b' },
  { type: 'Bank holiday', colour: '#db2777' },
];

const HEIGHT = 360;
const PAD = { left: 48, right: 22, top: 10, bottom: 44 };

interface Props {
  data: ScatterResponse;
}

/** Round steps of 1, 2, 2.5 or 5 for the kW axis. */
function niceTicks(max: number): number[] {
  const raw = (max || 1) / 5;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((x) => x >= raw) ?? 10 * mag;
  const ticks: number[] = [];
  for (let v = 0; v <= max + step * 0.999; v += step) ticks.push(Math.round(v / step) * step);
  return ticks;
}

/**
 * Every reading as a dot, drawn on a canvas. Thousands of SVG shapes took
 * seconds to redraw on each filter change; a canvas draws them in a few
 * milliseconds and the chart looks the same.
 */
function LoadScatterChart({ data }: Props) {
  const [hidden, setHidden] = useState<string[]>([]);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<{ x: number; y: number; p: ScatterPoint } | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!wrap.current) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)));
    ro.observe(wrap.current);
    return () => ro.disconnect();
  }, []);

  const visible = useMemo(
    () => data.points.filter((p) => !hidden.includes(p.type)),
    [data, hidden],
  );
  const ticks = useMemo(() => niceTicks(Math.max(0, ...data.points.map((p) => p.kw))), [data]);
  const yMax = ticks[ticks.length - 1] || 1;
  const plotW = Math.max(1, width - PAD.left - PAD.right);
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const px = (hour: number) => PAD.left + (hour / 24) * plotW;
  const py = (kw: number) => PAD.top + plotH - (kw / yMax) * plotH;

  useEffect(() => {
    const c = canvas.current;
    if (!c || !width) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = width * dpr;
    c.height = HEIGHT * dpr;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, HEIGHT);

    ctx.font = '11px system-ui, sans-serif';
    ctx.fillStyle = '#64748b';
    ctx.strokeStyle = '#f1f5f9';
    ctx.lineWidth = 1;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (const t of ticks) {
      const y = Math.round(py(t)) + 0.5;
      ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(PAD.left + plotW, y); ctx.stroke();
      ctx.fillText(t.toLocaleString('en-GB'), PAD.left - 6, y);
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let h = 0; h <= 24; h += 3) {
      ctx.fillText(`${String(h).padStart(2, '0')}:00`, px(h), PAD.top + plotH + 6);
    }
    ctx.fillStyle = '#94a3b8';
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillText('Time of day', PAD.left + plotW / 2, PAD.top + plotH + 24);
    ctx.save();
    ctx.translate(12, PAD.top + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('kW', 0, 0);
    ctx.restore();

    ctx.globalAlpha = 0.28;
    for (const g of GROUPS) {
      if (hidden.includes(g.type)) continue;
      ctx.fillStyle = g.colour;
      for (const p of data.points) {
        if (p.type !== g.type) continue;
        ctx.beginPath();
        ctx.arc(px(p.hour), py(p.kw), 2.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  // px/py are derived from width and ticks, both listed.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, hidden, width, ticks]);

  function onMove(e: React.MouseEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    let best: ScatterPoint | null = null;
    let bestD = 64; // within 8px
    for (const p of visible) {
      const d = (px(p.hour) - x) ** 2 + (py(p.kw) - y) ** 2;
      if (d < bestD) { bestD = d; best = p; }
    }
    setHover(best ? { x, y, p: best } : null);
  }

  return (
    <Panel
      title="Every half-hourly reading"
      subtitle="Load against time of day for the whole period. The spread around the average is what a line chart hides: a tight band means a predictable site, a wide one means the average is not much use on its own."
    >
      <div className="flex flex-wrap gap-1.5 mb-4">
        {GROUPS.map((g) => {
          const on = !hidden.includes(g.type);
          return (
            <button
              key={g.type}
              onClick={() =>
                setHidden((h) =>
                  h.includes(g.type) ? h.filter((t) => t !== g.type) : [...h, g.type],
                )
              }
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                on ? 'text-white border-transparent' : 'bg-white text-slate-500 border-slate-300'
              }`}
              style={on ? { backgroundColor: g.colour } : undefined}
            >
              {g.type}
            </button>
          );
        })}
      </div>

      <div ref={wrap} className="relative" style={{ height: HEIGHT }}>
        <canvas
          ref={canvas}
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
          style={{ width: '100%', height: HEIGHT }}
          role="img"
          aria-label={`Scatter of ${visible.length} half-hourly readings against time of day`}
        />
        {hover && (
          <div
            className="pointer-events-none absolute z-10 bg-white border border-slate-200 shadow-md rounded-lg px-3 py-2 text-xs whitespace-nowrap"
            style={{
              left: hover.x + 12,
              top: Math.max(0, hover.y - 56),
              transform: hover.x > width * 0.6 ? 'translateX(calc(-100% - 24px))' : undefined,
            }}
          >
            <p className="font-semibold text-slate-800">
              {new Date(`${hover.p.date}T00:00:00Z`).toLocaleDateString('en-GB', {
                weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC',
              })}
              {' · '}
              {String(Math.floor(hover.p.hour)).padStart(2, '0')}:{hover.p.hour % 1 ? '30' : '00'}
            </p>
            <p className="text-slate-600 tabular-nums">
              {hover.p.kw.toLocaleString('en-GB')} kW · {hover.p.type}
            </p>
          </div>
        )}
      </div>

      {data.sampled && (
        <p className="text-xs text-slate-400 mt-2">
          Showing {data.points.length.toLocaleString()} of{' '}
          {data.total_readings.toLocaleString()} readings, evenly sampled so the
          chart stays responsive. The shape is the same; individual outliers may not be shown.
        </p>
      )}
    </Panel>
  );
}

// Only redraw when this chart's own data or props change.
export default memo(LoadScatterChart);
