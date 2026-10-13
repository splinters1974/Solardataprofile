/**
 * Year-at-a-glance heatmap ("carpet plot"): one column per calendar day, one
 * row per half hour, colour for demand. Faults that averages hide stand out
 * at once: heating left on over a holiday, a timer that drifted, a step up
 * in base load from one week to the next.
 *
 * One blue running light to dark (near-white means near zero). The top of
 * the scale is the 99th percentile of valid readings, so one spike cannot
 * wash the rest out. Missing readings and missing days are hatched grey and
 * excluded ones pink, so neither can be mistaken for low use. Optional
 * overlay: a dark mark at each opening and closing time.
 */
import { calendarDays, FLAG, flagAt, INTERVAL_HOURS, isValid, SLOTS, type Frame } from './frame';
import { planDays, type Calendar } from './calendar';

export const RAMP_HEX = ['#f7f9fc', '#cde2fb', '#86b6ef', '#3987e5', '#1c5cab', '#0d366b'];
const RAMP = RAMP_HEX
  .map((h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)));

export const MISSING_A: [number, number, number] = [214, 219, 225];
export const MISSING_B: [number, number, number] = [241, 243, 246];
export const EXCLUDED_RGB: [number, number, number] = [249, 197, 205];
export const DST_RGB: [number, number, number] = [255, 255, 255];
export const OVERLAY_RGB: [number, number, number] = [180, 83, 9];

export const MISSING_CSS = 'repeating-linear-gradient(45deg, #d6dbe1 0 3px, #f1f3f6 3px 6px)';
export const EXCLUDED_CSS = '#f9c5cd';

export function rampColor(t: number): [number, number, number] {
  const x = Math.max(0, Math.min(1, t)) * (RAMP.length - 1);
  const i = Math.min(RAMP.length - 2, Math.floor(x));
  const f = x - i;
  return [0, 1, 2].map((k) => Math.round(RAMP[i][k] + (RAMP[i + 1][k] - RAMP[i][k]) * f)) as
    [number, number, number];
}

export const RAMP_CSS = `linear-gradient(to right, ${RAMP.map((c) => `rgb(${c.join(',')})`).join(', ')})`;

/** The kW at the top of the colour scale: 99th percentile of valid readings. */
export function scaleMax(frame: Frame): number {
  const kw: number[] = [];
  frame.rows.forEach((r, i) => { for (let s = 0; s < SLOTS; s++) if (isValid(frame, i, s)) kw.push(r[s] / INTERVAL_HOURS); });
  if (!kw.length) return 1;
  kw.sort((a, b) => a - b);
  return kw[Math.min(kw.length - 1, Math.floor(kw.length * 0.99))] || kw[kw.length - 1] || 1;
}

export type CellKind = 'value' | 'missing' | 'excluded' | 'dst';

/** What a cell holds: a reading, nothing, an excluded reading, or a clock time that did not exist. */
export function cellKind(frame: Frame, i: number, s: number): CellKind {
  if (i < 0) return 'missing';
  const f = flagAt(frame, i, s);
  if (!f) return 'value';
  if (f === FLAG.DST_GAP) return 'dst';
  if (f === FLAG.EXCLUDED || f === FLAG.DUPLICATE || f === FLAG.DST_UNSAFE) return 'excluded';
  return 'missing';
}

export interface CarpetOptions {
  calendar?: Calendar;
  /** Mark opening and closing times. */
  overlay?: boolean;
  /** Fix the top of the colour scale (shared with another view). */
  max?: number;
}

/**
 * Draw onto a canvas: `dayPx` wide per calendar day, `slotPx` tall per half
 * hour. Missing days are drawn as gaps. Returns the colour-scale maximum.
 */
export function drawCarpet(
  canvas: HTMLCanvasElement, frame: Frame, dayPx = 2, slotPx = 4, opts: CarpetOptions = {},
): number {
  const max = opts.max ?? scaleMax(frame);
  const days = calendarDays(frame);
  canvas.width = Math.max(1, days.length * dayPx);
  canvas.height = SLOTS * slotPx;
  const ctx = canvas.getContext('2d');
  if (!ctx) return max;
  const plans = opts.overlay && opts.calendar ? planDays(opts.calendar, days.map((d) => d.date)) : null;
  const img = ctx.createImageData(canvas.width, canvas.height);
  const paint = (x0: number, y0: number, w: number, h: number, rgb: (x: number, y: number) => [number, number, number]) => {
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        const [r, g, b] = rgb(x, y);
        const o = (y * canvas.width + x) * 4;
        img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = 255;
      }
    }
  };
  days.forEach(({ i }, d) => {
    for (let s = 0; s < SLOTS; s++) {
      const kind = cellKind(frame, i, s);
      const x0 = d * dayPx;
      const y0 = s * slotPx;
      if (kind === 'value') {
        const c = rampColor((frame.rows[i][s] / INTERVAL_HOURS) / max);
        paint(x0, y0, dayPx, slotPx, () => c);
      } else if (kind === 'missing') {
        paint(x0, y0, dayPx, slotPx, (x, y) => ((x + y) % 4 < 2 ? MISSING_A : MISSING_B));
      } else if (kind === 'excluded') {
        paint(x0, y0, dayPx, slotPx, () => EXCLUDED_RGB);
      } else {
        paint(x0, y0, dayPx, slotPx, () => DST_RGB);
      }
    }
    if (plans) {
      // A dark mark on the boundary where the site opens or closes.
      const open = plans[d].open;
      for (let s = 0; s < SLOTS; s++) {
        const prev = s ? open[s - 1] : open[SLOTS - 1];
        if (open[s] !== prev && s > 0) paint(d * dayPx, s * slotPx, dayPx, Math.max(1, Math.round(slotPx / 3)), () => OVERLAY_RGB);
      }
    }
  });
  ctx.putImageData(img, 0, 0);
  return max;
}
