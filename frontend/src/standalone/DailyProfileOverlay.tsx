import { useMemo, useState } from 'react';
import { planDays, slotTime, type Calendar } from '../local/calendar';
import { DAY_FILTER_LABEL, dayProfiles, type DayFilter } from '../local/chartData';
import { CHART } from '../local/chartColours';
import { fmtDayMonYear, MONTHS_SHORT } from '../local/dates';
import { SLOTS, type Frame } from '../local/frame';
import { ChartCard, Toggle } from './ChartCard';
import { chartFileName } from './chartDownload';
import { kw, num } from './format';

const W = 960; const H = 340;
const PAD = { l: 56, r: 16, t: 12, b: 30 };
const AVG_INK = '#003a63';

/**
 * Every day's demand drawn as a faint line, with the average and the highest
 * in each half hour on top, and the hours the site is usually closed shaded.
 * Shows at a glance how consistent the site is, when it starts and stops,
 * and which days run away from the pattern.
 */
export default function DailyProfileOverlay({ frame, calendar, siteName, after }: {
  frame: Frame; calendar: Calendar; siteName: string;
  /** Readings after active savings scenarios, for the before/after switch. */
  after?: number[][] | null;
}) {
  const [filter, setFilter] = useState<DayFilter>('all');
  const [month, setMonth] = useState(0);
  const [view, setView] = useState<'before' | 'after'>('before');
  const [hover, setHover] = useState<number | null>(null);
  const plans = useMemo(() => planDays(calendar, frame.dates), [calendar, frame]);
  const showAfter = view === 'after' && !!after;
  const p = useMemo(() => dayProfiles(frame, plans, filter, month, showAfter ? after! : frame.rows), [frame, plans, filter, month, showAfter, after]);
  const before = useMemo(() => (showAfter ? dayProfiles(frame, plans, filter, month) : null), [showAfter, frame, plans, filter, month]);

  const top = Math.max(1, ...p.max.map((v) => v ?? 0), ...(before ? before.max.map((v) => v ?? 0) : [])) * 1.05;
  const x = (s: number) => PAD.l + (s / (SLOTS - 1)) * (W - PAD.l - PAD.r);
  const y = (v: number) => H - PAD.b - (v / top) * (H - PAD.t - PAD.b);
  const path = (vals: (number | null)[]) => {
    let d = ''; let pen = false;
    vals.forEach((v, s) => {
      if (v === null) { pen = false; return; }
      d += `${pen ? 'L' : 'M'}${x(s).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  };
  const ticks = niceTicks(top);
  const opacity = Math.max(0.04, Math.min(0.35, 10 / Math.max(1, p.days.length)));
  const step = (W - PAD.l - PAD.r) / (SLOTS - 1);
  const months = [...new Set(frame.dates.map((d) => Number(d.slice(5, 7))))].sort((a, b) => a - b);

  return (
    <ChartCard
      title="Daily load profile"
      subtitle={`Each day as a thin line: ${DAY_FILTER_LABEL[filter].toLowerCase()}, ${p.days.length} days${month ? `, ${MONTHS_SHORT[month - 1]} only` : ''}${frame.dates.length ? `, ${fmtDayMonYear(frame.dates[0])} to ${fmtDayMonYear(frame.dates[frame.dates.length - 1])}` : ''}`}
      file={chartFileName(siteName, 'daily-load-profile')}
      controls={(
        <>
          {after && <Toggle value={view} onChange={setView} options={[['before', 'Measured'], ['after', 'With scenarios']] as const} />}
          <select className="text-xs border border-slate-300 rounded-md px-2 py-1" value={filter} onChange={(e) => setFilter(e.target.value as DayFilter)} aria-label="Which days">
            {(Object.keys(DAY_FILTER_LABEL) as DayFilter[]).map((k) => <option key={k} value={k}>{DAY_FILTER_LABEL[k]}</option>)}
          </select>
          <select className="text-xs border border-slate-300 rounded-md px-2 py-1" value={month} onChange={(e) => setMonth(Number(e.target.value))} aria-label="Which months">
            <option value={0}>All months</option>
            {months.map((m) => <option key={m} value={m}>{MONTHS_SHORT[m - 1]}</option>)}
          </select>
        </>
      )}
      footer={(
        <>
          Shaded: hours the site is closed on most of these days, under its calendar. Peaks are half-hour averages.
          {showAfter && ' Grey dashed line: the measured average, before scenarios.'}
        </>
      )}
    >
      {p.days.length === 0 ? <p className="text-sm text-slate-500 py-10 text-center">No days match these filters.</p> : (
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto select-none" role="img"
          aria-label={`Daily load profile: average peaks at ${kw(Math.max(...p.avg.map((v) => v ?? 0)))}`}
          onMouseLeave={() => setHover(null)}
          onMouseMove={(e) => {
            const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
            const sx = ((e.clientX - r.left) / r.width) * W;
            const s = Math.round(((sx - PAD.l) / (W - PAD.l - PAD.r)) * (SLOTS - 1));
            setHover(s >= 0 && s < SLOTS ? s : null);
          }}>
          {p.closedShare.map((c, s) => (c >= 0.5 ? <rect key={s} x={x(s) - step / 2} y={PAD.t} width={step} height={H - PAD.t - PAD.b} fill={CHART.band} /> : null))}
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke={CHART.grid} />
              <text x={PAD.l - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill={CHART.axis}>{num(t, 0)} kW</text>
            </g>
          ))}
          {[0, 8, 16, 24, 32, 40, 47].map((s) => (
            <text key={s} x={x(s)} y={H - 10} textAnchor="middle" fontSize="11" fill={CHART.axis}>{slotTime(s)}</text>
          ))}
          <line x1={PAD.l} x2={W - PAD.r} y1={y(0)} y2={y(0)} stroke="#cbd5e1" />
          <g fill="none" stroke={showAfter ? CHART.green : CHART.blue} strokeWidth="1" strokeOpacity={opacity}>
            {p.days.map((d) => <path key={d.date} d={path(d.kw)} />)}
          </g>
          {before && <path d={path(before.avg)} fill="none" stroke={CHART.grey} strokeWidth="2" strokeDasharray="5 4" />}
          <path d={path(p.max)} fill="none" stroke={CHART.orange} strokeWidth="1.5" />
          <path d={path(p.avg)} fill="none" stroke={showAfter ? '#00632f' : AVG_INK} strokeWidth="2.5" />
          {hover !== null && (
            <g pointerEvents="none">
              <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={H - PAD.b} stroke={CHART.ink} strokeDasharray="3 3" />
              {p.avg[hover] !== null && <circle cx={x(hover)} cy={y(p.avg[hover]!)} r="4" fill={AVG_INK} stroke="#fff" strokeWidth="2" />}
              {p.max[hover] !== null && <circle cx={x(hover)} cy={y(p.max[hover]!)} r="4" fill={CHART.orange} stroke="#fff" strokeWidth="2" />}
              <Tip x={x(hover)} lines={[
                `${slotTime(hover)} to ${slotTime(hover + 1)}`,
                `Average ${p.avg[hover] === null ? 'n/a' : kw(p.avg[hover]!)}`,
                `Highest ${p.max[hover] === null ? 'n/a' : kw(p.max[hover]!)}`,
                `Lowest ${p.min[hover] === null ? 'n/a' : kw(p.min[hover]!)}`,
                `${Math.round(p.closedShare[hover] * 100)}% of these days closed`,
              ]} />
            </g>
          )}
        </svg>
      )}
      <div className="flex flex-wrap gap-4 text-xs text-slate-600 mt-1">
        <span className="flex items-center gap-1.5"><span className="inline-block w-5 h-0.5" style={{ background: showAfter ? CHART.green : CHART.blue, opacity: 0.6 }} /> Each day</span>
        <span className="flex items-center gap-1.5"><span className="inline-block w-5 h-1" style={{ background: showAfter ? '#00632f' : AVG_INK }} /> Average</span>
        <span className="flex items-center gap-1.5"><span className="inline-block w-5 h-0.5" style={{ background: CHART.orange }} /> Highest in each half hour</span>
        <span className="flex items-center gap-1.5"><span className="inline-block w-4 h-3 border border-slate-200" style={{ background: CHART.band }} /> Usually closed</span>
      </div>
    </ChartCard>
  );
}

function Tip({ x, lines }: { x: number; lines: string[] }) {
  const w = 190; const h = 16 * lines.length + 10;
  const left = x + w + 14 > W ? x - w - 10 : x + 10;
  return (
    <g>
      <rect x={left} y={PAD.t + 4} width={w} height={h} rx="6" fill="#fff" stroke="#e2e8f0" />
      {lines.map((t, k) => (
        <text key={k} x={left + 10} y={PAD.t + 22 + k * 16} fontSize="12" fill={k ? '#334155' : '#0f172a'} fontWeight={k ? 400 : 600}>{t}</text>
      ))}
    </g>
  );
}

function niceTicks(top: number): number[] {
  const raw = top / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = 0; v <= top; v += step) out.push(v);
  return out;
}
