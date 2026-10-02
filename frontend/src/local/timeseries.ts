/**
 * The whole period as one time series: every half-hourly reading (or every
 * day's total) in date order, kWh up the side, dates along the bottom.
 *
 * Drawn on a canvas, axes included, so the same picture serves the screen
 * and the PDF. ~17,500 points is too many for SVG to redraw smoothly.
 */
import { dayNum, MONTHS_SHORT, parts } from './dates';
import type { Frame } from './parser';

export type SeriesMode = 'hh' | 'daily';

export const PAD = { left: 56, right: 16, top: 12, bottom: 40 };

function niceTicks(max: number): number[] {
  const raw = (max || 1) / 5;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((x) => x >= raw) ?? 10 * mag;
  const ticks: number[] = [];
  for (let v = 0; v <= max + step * 0.999; v += step) ticks.push(Math.round(v / step) * step);
  return ticks;
}

/** Which reading (index into seriesValues) sits at a horizontal fraction of the plot, if any. */
export function indexAt(frame: Frame, mode: SeriesMode, fraction: number): number | null {
  if (!frame.dates.length || fraction < 0 || fraction >= 1) return null;
  const perDay = mode === 'hh' ? 48 : 1;
  const first = dayNum(frame.dates[0]);
  const span = dayNum(frame.dates[frame.dates.length - 1]) - first + 1;
  const slot = Math.floor(fraction * span * perDay);
  const day = first + Math.floor(slot / perDay);
  const row = frame.dates.findIndex((d) => dayNum(d) === day);
  return row < 0 ? null : row * perDay + (slot % perDay);
}

export function seriesValues(frame: Frame, mode: SeriesMode): number[] {
  return mode === 'hh' ? frame.rows.flat() : frame.rows.map((r) => r.reduce((a, b) => a + b, 0));
}

/**
 * Draw at `width` x `height` CSS pixels, scaled by `scale` for sharpness.
 * Returns the y-axis maximum, so a hover read-out can map back to values.
 */
export function drawTimeSeries(
  canvas: HTMLCanvasElement, frame: Frame, mode: SeriesMode,
  width: number, height: number, scale = 1, colour = '#0065a5',
): number {
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext('2d');
  const values = seriesValues(frame, mode);
  const ticks = niceTicks(Math.max(0, ...values));
  const yMax = ticks[ticks.length - 1] || 1;
  if (!ctx || !values.length) return yMax;

  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;
  const days = frame.dates.length;
  const perDay = mode === 'hh' ? 48 : 1;
  // Placed by calendar date, not by row, so a missing day shows as a break.
  const first = dayNum(frame.dates[0]);
  const span = dayNum(frame.dates[days - 1]) - first + 1;
  const offset = frame.dates.map((d) => dayNum(d) - first);
  const slots = span * perDay;
  const x = (slot: number) => PAD.left + (slot / slots) * plotW;
  const pos = (i: number) => offset[Math.floor(i / perDay)] * perDay + (i % perDay);
  const y = (v: number) => PAD.top + plotH - (v / yMax) * plotH;

  // Grid and kWh axis.
  ctx.font = '11px system-ui, -apple-system, Segoe UI, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'right';
  for (const t of ticks) {
    const yy = Math.round(y(t)) + 0.5;
    ctx.strokeStyle = '#eef2f6';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(PAD.left, yy); ctx.lineTo(PAD.left + plotW, yy); ctx.stroke();
    ctx.fillStyle = '#64748b';
    ctx.fillText(t.toLocaleString('en-GB'), PAD.left - 6, yy);
  }
  ctx.save();
  ctx.translate(14, PAD.top + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#94a3b8';
  ctx.fillText(mode === 'hh' ? 'kWh per half hour' : 'kWh per day', 0, 0);
  ctx.restore();

  // A small tick for every day; a label and a stronger line at each month.
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  frame.dates.forEach((d, i) => {
    const xx = Math.round(x(offset[i] * perDay)) + 0.5;
    // Label the first, part month only if it has room before the next label.
    const monthStart = d.endsWith('-01') || (i === 0 && Number(d.slice(8)) <= 12);
    ctx.strokeStyle = monthStart ? '#cbd5e1' : '#e2e8f0';
    ctx.beginPath();
    ctx.moveTo(xx, PAD.top + plotH);
    ctx.lineTo(xx, PAD.top + plotH + (monthStart ? 7 : 3));
    ctx.stroke();
    if (monthStart) {
      const p = parts(d);
      ctx.fillStyle = '#64748b';
      ctx.fillText(`${MONTHS_SHORT[p.m - 1]} ${String(p.y).slice(2)}`, xx + 2, PAD.top + plotH + 9);
      ctx.strokeStyle = '#f1f5f9';
      ctx.beginPath(); ctx.moveTo(xx, PAD.top); ctx.lineTo(xx, PAD.top + plotH); ctx.stroke();
    }
  });
  ctx.fillStyle = '#94a3b8';
  ctx.textAlign = 'center';
  ctx.fillText(`${days} days, one tick per day${span > days ? ` (${span - days} missing, shown as gaps)` : ''}`,
    PAD.left + plotW / 2, PAD.top + plotH + 24);

  // The data. Thin line for half hours (so the daily shape shows), bars for days.
  ctx.strokeStyle = colour;
  ctx.fillStyle = colour;
  if (mode === 'hh') {
    ctx.lineWidth = Math.max(0.6, Math.min(1.2, (plotW / values.length) * 6));
    ctx.beginPath();
    values.forEach((v, i) => {
      const p = pos(i);
      // Lift the pen across a missing day rather than drawing through it.
      const joined = i > 0 && p === pos(i - 1) + 1;
      if (joined) ctx.lineTo(x(p + 0.5), y(v)); else ctx.moveTo(x(p + 0.5), y(v));
    });
    ctx.stroke();
  } else {
    const w = Math.max(1, plotW / slots - 0.5);
    values.forEach((v, i) => ctx.fillRect(x(pos(i)), y(v), w, PAD.top + plotH - y(v)));
  }

  ctx.strokeStyle = '#94a3b8';
  ctx.beginPath();
  ctx.moveTo(PAD.left + 0.5, PAD.top);
  ctx.lineTo(PAD.left + 0.5, PAD.top + plotH + 0.5);
  ctx.lineTo(PAD.left + plotW, PAD.top + plotH + 0.5);
  ctx.stroke();
  return yMax;
}
