/**
 * Year-at-a-glance heatmap ("carpet plot"): one column per day, one row per
 * half hour, colour for demand. Faults that averages hide stand out at once:
 * heating left on over Christmas, a timer that drifted, a step up in base
 * load from one week to the next.
 *
 * One blue running light to dark (near-white means near zero). The top of
 * the scale is the 99th percentile, so one spike cannot wash the rest out.
 */
import { KW_PER_KWH_PER_HH } from './analytics';
import type { Frame } from './parser';

export const RAMP_HEX = ['#f7f9fc', '#cde2fb', '#86b6ef', '#3987e5', '#1c5cab', '#0d366b'];
const RAMP = RAMP_HEX
  .map((h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)));

export function rampColor(t: number): [number, number, number] {
  const x = Math.max(0, Math.min(1, t)) * (RAMP.length - 1);
  const i = Math.min(RAMP.length - 2, Math.floor(x));
  const f = x - i;
  return [0, 1, 2].map((k) => Math.round(RAMP[i][k] + (RAMP[i + 1][k] - RAMP[i][k]) * f)) as
    [number, number, number];
}

export const RAMP_CSS = `linear-gradient(to right, ${RAMP.map((c) => `rgb(${c.join(',')})`).join(', ')})`;

/** The kW at the top of the colour scale. */
export function scaleMax(frame: Frame): number {
  const kw = frame.rows.flat().map((v) => v * KW_PER_KWH_PER_HH).sort((a, b) => a - b);
  if (!kw.length) return 1;
  return kw[Math.min(kw.length - 1, Math.floor(kw.length * 0.99))] || kw[kw.length - 1] || 1;
}

/**
 * Draw onto a canvas: `dayPx` wide per day, `slotPx` tall per half hour.
 * Returns the colour-scale maximum used, for the legend.
 */
export function drawCarpet(
  canvas: HTMLCanvasElement, frame: Frame, dayPx = 2, slotPx = 4,
): number {
  const max = scaleMax(frame);
  const days = frame.dates.length;
  canvas.width = Math.max(1, days * dayPx);
  canvas.height = 48 * slotPx;
  const ctx = canvas.getContext('2d');
  if (!ctx) return max;
  const img = ctx.createImageData(canvas.width, canvas.height);
  for (let d = 0; d < days; d++) {
    for (let s = 0; s < 48; s++) {
      const [r, g, b] = rampColor((frame.rows[d][s] * KW_PER_KWH_PER_HH) / max);
      for (let y = s * slotPx; y < (s + 1) * slotPx; y++) {
        for (let x = d * dayPx; x < (d + 1) * dayPx; x++) {
          const o = (y * canvas.width + x) * 4;
          img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = 255;
        }
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  return max;
}
