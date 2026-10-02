/**
 * Shared PDF furniture for the standalone build: a flowing page cursor,
 * headings and paragraphs, number tiles, tables and vector charts.
 *
 * Charts are drawn with jsPDF's own lines and shapes rather than
 * screenshotting the page, so they stay sharp in print, as the server's
 * reportlab charts did.
 */
import { jsPDF } from 'jspdf';
import { autoTable, type RowInput } from 'jspdf-autotable';
import { MONTHS_SHORT } from '../dates';
import { LOGO_ASPECT } from '../brand';

export type RGB = [number, number, number];

export const hex = (h: string): RGB => [
  parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16),
];

export const INK = hex('#1e293b');
export const MUTED = hex('#64748b');
export const RULE = hex('#e2e8f0');
export const PANEL = hex('#f8fafc');
export const GRID = hex('#eef2f6');
export const WHITE: RGB = [255, 255, 255];

export const fmt = (v: number, dp = 0) =>
  v.toLocaleString('en-GB', { minimumFractionDigits: dp, maximumFractionDigits: dp });

interface ReportOptions {
  orientation: 'portrait' | 'landscape';
  brand: RGB;
  footer: string;
  title: string;
  margin: number;
  /** Logo image (data URL), printed top right of the first page. */
  logo?: string;
}

/** A page cursor that starts a new page when the next block will not fit. */
export class Report {
  doc: jsPDF;
  y: number;
  readonly left: number;
  readonly width: number;
  readonly brand: RGB;
  private readonly bottom: number;
  private readonly top: number;
  private readonly opts: ReportOptions;

  constructor(opts: ReportOptions) {
    this.opts = opts;
    this.doc = new jsPDF({ orientation: opts.orientation, unit: 'mm', format: 'a4' });
    this.doc.setProperties({ title: opts.title, creator: 'Energy Usage Analyser' });
    const pw = this.doc.internal.pageSize.getWidth();
    const ph = this.doc.internal.pageSize.getHeight();
    this.left = opts.margin;
    this.width = pw - opts.margin * 2;
    this.top = 14;
    this.bottom = ph - 18;
    this.brand = opts.brand;
    this.y = this.top;
  }

  newPage() {
    this.doc.addPage();
    this.y = this.top;
  }

  /** Move to a new page unless `height` mm still fits on this one. */
  need(height: number) {
    if (this.y + height > this.bottom) this.newPage();
  }

  /** Millimetres left on this page. */
  remaining(): number {
    return this.bottom - this.y;
  }

  space(mm: number) {
    this.y += mm;
  }

  private setColor(c: RGB) {
    this.doc.setTextColor(c[0], c[1], c[2]);
  }

  /** A one-line muted heading for documents that skip the big title. */
  subhead(text: string) {
    const d = this.doc;
    d.setFont('helvetica', 'normal').setFontSize(9);
    this.setColor(MUTED);
    d.text(text, this.left, this.y + 6);
    this.y += 9;
  }

  title(text: string, sub: string) {
    const d = this.doc;
    d.setFont('helvetica', 'bold').setFontSize(22);
    this.setColor(INK);
    d.text(text, this.left, this.y + 8);
    d.setFont('helvetica', 'normal').setFontSize(10.5);
    this.setColor(MUTED);
    d.text(sub, this.left, this.y + 15);
    this.y += 21;
  }

  h2(text: string, keepWith = 30) {
    this.need(10 + keepWith);
    this.y += 4;
    const d = this.doc;
    d.setFont('helvetica', 'bold').setFontSize(13);
    this.setColor(this.brand);
    d.text(text, this.left, this.y + 5);
    this.y += 9;
  }

  paragraph(text: string, opts: { size?: number; color?: RGB; bold?: boolean; width?: number } = {}) {
    const d = this.doc;
    const size = opts.size ?? 9.5;
    d.setFont('helvetica', opts.bold ? 'bold' : 'normal').setFontSize(size);
    this.setColor(opts.color ?? INK);
    const lines = d.splitTextToSize(text, opts.width ?? this.width) as string[];
    const lineH = size * 0.42 + 1;
    for (const line of lines) {
      this.need(lineH);
      d.text(line, this.left, this.y + size * 0.36);
      this.y += lineH;
    }
    this.y += 1.5;
  }

  small(text: string) {
    this.paragraph(text, { size: 7.5, color: MUTED });
  }

  /** A shaded box around a paragraph, for warnings and key assumptions. */
  callout(text: string, opts: { fill: RGB; border: RGB; bold?: string }) {
    const d = this.doc;
    d.setFontSize(9.5);
    const body = opts.bold ? `${opts.bold} ${text}` : text;
    const lines = d.splitTextToSize(body, this.width - 8) as string[];
    const h = lines.length * 5 + 5;
    this.need(h + 2);
    d.setFillColor(...opts.fill).setDrawColor(...opts.border).setLineWidth(0.3);
    d.rect(this.left, this.y, this.width, h, 'FD');
    d.setFont('helvetica', 'normal');
    this.setColor(INK);
    lines.forEach((line, i) => d.text(line, this.left + 4, this.y + 5.5 + i * 5));
    this.y += h + 3;
  }

  /** A row of headline numbers. */
  tiles(cells: [string, string][]) {
    const d = this.doc;
    const h = 17;
    this.need(h + 2);
    const w = this.width / cells.length;
    d.setFillColor(...PANEL).setDrawColor(...RULE).setLineWidth(0.25);
    d.rect(this.left, this.y, this.width, h, 'FD');
    cells.forEach(([value, label], i) => {
      const cx = this.left + w * i + w / 2;
      if (i) d.line(this.left + w * i, this.y, this.left + w * i, this.y + h);
      d.setFont('helvetica', 'bold').setFontSize(15);
      this.setColor(this.brand);
      d.text(value, cx, this.y + 8, { align: 'center' });
      d.setFont('helvetica', 'normal').setFontSize(7);
      this.setColor(MUTED);
      d.text(label, cx, this.y + 13.5, { align: 'center' });
    });
    this.y += h + 3;
  }

  table(head: string[], body: RowInput[], opts: {
    widths?: number[]; fontSize?: number; x?: number; width?: number; boldLast?: boolean;
    /** Columns to left-align besides the first (text columns in a numeric table). */
    leftCols?: number[];
  } = {}) {
    const isLeft = (i: number) => i === 0 || !!opts.leftCols?.includes(i);
    const width = opts.width ?? this.width;
    const columnStyles: Record<number, { cellWidth?: number; halign?: 'left' | 'right' }> = {};
    head.forEach((_, i) => {
      columnStyles[i] = {
        halign: isLeft(i) ? 'left' : 'right',
        cellWidth: opts.widths ? opts.widths[i] * width : 'auto' as unknown as number,
      };
    });
    autoTable(this.doc, {
      head: [head],
      body,
      startY: this.y,
      margin: { left: opts.x ?? this.left, right: this.doc.internal.pageSize.getWidth() - (opts.x ?? this.left) - width, top: 14, bottom: 20 },
      tableWidth: width,
      theme: 'plain',
      styles: {
        font: 'helvetica', fontSize: opts.fontSize ?? 8, textColor: INK,
        cellPadding: { top: (opts.fontSize ?? 8) < 8 ? 0.9 : 1.3, bottom: (opts.fontSize ?? 8) < 8 ? 0.9 : 1.3, left: 2, right: 2 },
        lineColor: RULE, lineWidth: { bottom: 0.15 },
      },
      headStyles: { fillColor: this.brand, textColor: WHITE, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: PANEL },
      columnStyles,
      didParseCell: (data) => {
        if (data.section === 'head') data.cell.styles.halign = isLeft(data.column.index) ? 'left' : 'right';
        if (opts.boldLast && data.section === 'body' && data.row.index === body.length - 1) {
          data.cell.styles.fontStyle = 'bold';
        }
      },
    });
    const finalY = (this.doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
    return finalY;
  }

  /** Header band and footer on every page, drawn once the content is final. */
  finish(): ArrayBuffer {
    const d = this.doc;
    const pages = d.getNumberOfPages();
    const pw = d.internal.pageSize.getWidth();
    const ph = d.internal.pageSize.getHeight();
    for (let p = 1; p <= pages; p++) {
      d.setPage(p);
      if (p === 1 && this.opts.logo) {
        const w = 46;
        d.addImage(this.opts.logo, 'JPEG', pw - this.left - w, 8, w, w / LOGO_ASPECT, undefined, 'FAST');
      }
      d.setFillColor(...this.brand);
      d.rect(0, 0, pw, 5, 'F');
      d.setDrawColor(...RULE).setLineWidth(0.25);
      d.line(this.left, ph - 13, pw - this.left, ph - 13);
      d.setFont('helvetica', 'normal').setFontSize(7.5);
      this.setColor(MUTED);
      d.text(this.opts.footer, this.left, ph - 9);
      d.text(`Page ${p} of ${pages}`, pw - this.left, ph - 9, { align: 'right' });
    }
    return d.output('arraybuffer');
  }
}

// --- Charts ---------------------------------------------------------------

export interface Series {
  name: string;
  color: RGB;
  points: [number, number][];
  width?: number;
  dash?: boolean;
}

interface Axis {
  min: number;
  max: number;
  ticks: number[];
  format: (v: number) => string;
}

/** Round numbers for an axis: steps of 1, 2, 2.5 or 5 times a power of ten. */
export function niceAxis(min: number, max: number, target = 5, format?: (v: number) => string): Axis {
  const span = max - min || Math.abs(max) || 1;
  const raw = span / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 1e6; v += step) ticks.push(Math.round(v / step) * step);
  const dp = step < 1 ? Math.min(3, Math.ceil(-Math.log10(step))) : 0;
  return { min: lo, max: hi, ticks, format: format ?? ((v) => fmt(v, dp)) };
}

export const kFormat = (v: number) => (Math.abs(v) >= 1000 ? `${fmt(v / 1000, v % 1000 ? 1 : 0)}k` : fmt(v));

export const hourAxis: Axis = {
  min: 0, max: 24, ticks: [0, 3, 6, 9, 12, 15, 18, 21, 24],
  format: (v) => `${String(Math.trunc(v)).padStart(2, '0')}:00`,
};

interface Frame {
  x: number; y: number; w: number; h: number;
  xa: Axis; ya: Axis;
}

function plotFrame(r: Report, f: Frame, opts: { xLabels?: boolean } = {}) {
  const d = r.doc;
  d.setFont('helvetica', 'normal').setFontSize(7);
  d.setTextColor(...MUTED);
  d.setLineWidth(0.15);
  for (const t of f.ya.ticks) {
    const py = f.y + f.h - ((t - f.ya.min) / (f.ya.max - f.ya.min)) * f.h;
    d.setDrawColor(...GRID);
    d.line(f.x, py, f.x + f.w, py);
    d.text(f.ya.format(t), f.x - 1.5, py + 1, { align: 'right' });
  }
  if (opts.xLabels !== false) {
    for (const t of f.xa.ticks) {
      const px = f.x + ((t - f.xa.min) / (f.xa.max - f.xa.min)) * f.w;
      d.text(f.xa.format(t), px, f.y + f.h + 4, { align: 'center' });
    }
  }
  d.setDrawColor(...hex('#94a3b8')).setLineWidth(0.25);
  d.line(f.x, f.y + f.h, f.x + f.w, f.y + f.h);
  d.line(f.x, f.y, f.x, f.y + f.h);
}

function legend(r: Report, items: { name: string; color: RGB }[], y: number, x: number, maxW: number) {
  const d = r.doc;
  d.setFont('helvetica', 'normal').setFontSize(7);
  let cx = x;
  let cy = y;
  for (const it of items) {
    const w = d.getTextWidth(it.name) + 8;
    if (cx + w > x + maxW) { cx = x; cy += 4; }
    d.setFillColor(...it.color);
    d.rect(cx, cy - 2.2, 3, 2.4, 'F');
    d.setTextColor(...INK);
    d.text(it.name, cx + 4, cy);
    cx += w + 3;
  }
  return cy;
}

function chartTitle(r: Report, title: string) {
  r.doc.setFont('helvetica', 'bold').setFontSize(9.5);
  r.doc.setTextColor(...INK);
  r.doc.text(title, r.left, r.y + 4);
}

/** Space a chart takes: title, plot, axis labels and a legend row or two. */
const legendRows = (r: Report, names: string[], maxW: number) => {
  r.doc.setFontSize(7);
  let rows = 1;
  let cx = 0;
  for (const n of names) {
    const w = r.doc.getTextWidth(n) + 11;
    if (cx + w > maxW) { rows++; cx = 0; }
    cx += w;
  }
  return rows;
};

export function lineChart(r: Report, opts: {
  title: string; series: Series[]; height?: number; xa?: Axis; ya?: Axis;
  xCaption?: string; marker?: { x: number; y: number; color: RGB };
}) {
  const height = opts.height ?? 70;
  const names = opts.series.map((s) => s.name);
  const lRows = legendRows(r, names, r.width - 14);
  r.need(height + 10 + lRows * 4);
  chartTitle(r, opts.title);

  const all = opts.series.flatMap((s) => s.points);
  const xa = opts.xa ?? niceAxis(0, Math.max(...all.map((p) => p[0]), 1));
  const ya = opts.ya ?? niceAxis(0, Math.max(...all.map((p) => p[1]), 0.001));
  const f: Frame = { x: r.left + 14, y: r.y + 8, w: r.width - 18, h: height - 14, xa, ya };
  plotFrame(r, f);

  const d = r.doc;
  const px = (v: number) => f.x + ((v - xa.min) / (xa.max - xa.min)) * f.w;
  const py = (v: number) => f.y + f.h - ((v - ya.min) / (ya.max - ya.min)) * f.h;
  for (const s of opts.series) {
    if (s.points.length < 2) continue;
    d.setDrawColor(...s.color).setLineWidth(s.width ?? 0.4);
    d.setLineDashPattern(s.dash ? [1.2, 0.8] : [], 0);
    const pts = s.points.map(([x, y]) => [px(x), py(y)]);
    d.lines(pts.slice(1).map((p, i) => [p[0] - pts[i][0], p[1] - pts[i][1]]), pts[0][0], pts[0][1]);
  }
  d.setLineDashPattern([], 0);
  if (opts.marker) {
    d.setFillColor(...opts.marker.color);
    d.circle(px(opts.marker.x), py(opts.marker.y), 1.1, 'F');
  }

  let y = f.y + f.h + 9;
  if (opts.xCaption) {
    d.setFont('helvetica', 'normal').setFontSize(7).setTextColor(...MUTED);
    d.text(opts.xCaption, f.x, y);
    y += 4.5;
  }
  const last = legend(r, opts.series.map((s) => ({ name: s.name, color: s.color })), y, f.x, f.w);
  r.y = last + 4;
}

export function barChart(r: Report, opts: {
  title: string; categories: string[]; series: { name: string; color: RGB; values: number[] }[];
  stacked?: boolean; height?: number; angledLabels?: boolean;
  /** Horizontal reference lines, e.g. a supply capacity. */
  refLines?: { value: number; label: string; color: RGB }[];
}) {
  const height = opts.height ?? 72;
  r.need(height + 16);
  chartTitle(r, opts.title);

  const n = opts.categories.length;
  const maxV = Math.max(
    opts.stacked
      ? Math.max(...opts.categories.map((_, i) => opts.series.reduce((s, x) => s + x.values[i], 0)), 1)
      : Math.max(...opts.series.flatMap((s) => s.values), 1),
    ...(opts.refLines ?? []).map((l) => l.value),
  );
  const ya = niceAxis(0, maxV, 5, kFormat);
  const xa: Axis = { min: 0, max: n, ticks: [], format: () => '' };
  const labelRoom = opts.angledLabels ? 12 : 4;
  const f: Frame = { x: r.left + 14, y: r.y + 8, w: r.width - 18, h: height - 10 - labelRoom, xa, ya };
  plotFrame(r, f, { xLabels: false });

  const d = r.doc;
  const slot = f.w / n;
  const py = (v: number) => f.y + f.h - (v / ya.max) * f.h;
  opts.categories.forEach((cat, i) => {
    const x0 = f.x + slot * i;
    if (opts.stacked) {
      let base = 0;
      const bw = slot * 0.7;
      for (const s of opts.series) {
        const v = s.values[i];
        d.setFillColor(...s.color);
        if (v > 0) d.rect(x0 + (slot - bw) / 2, py(base + v), bw, py(base) - py(base + v), 'F');
        base += v;
      }
    } else {
      const group = slot * 0.8;
      const bw = group / opts.series.length;
      opts.series.forEach((s, k) => {
        const v = s.values[i];
        d.setFillColor(...s.color);
        if (v > 0) d.rect(x0 + (slot - group) / 2 + bw * k, py(v), bw * 0.92, f.y + f.h - py(v), 'F');
      });
    }
    d.setFont('helvetica', 'normal').setFontSize(opts.angledLabels ? 6 : 7).setTextColor(...MUTED);
    if (opts.angledLabels) {
      // Rotated text runs up and to the right from its start, so start it
      // below-left of the tick and let it finish under the bar.
      const w = d.getTextWidth(cat);
      const a = (40 * Math.PI) / 180;
      d.text(cat, x0 + slot / 2 - w * Math.cos(a), f.y + f.h + 2.5 + w * Math.sin(a), { angle: 40 });
    } else {
      d.text(cat, x0 + slot / 2, f.y + f.h + 4, { align: 'center' });
    }
  });

  (opts.refLines ?? []).forEach((line, k) => {
    const y = py(line.value);
    d.setDrawColor(...line.color).setLineWidth(0.35).setLineDashPattern([1.5, 1], 0);
    d.line(f.x, y, f.x + f.w, y);
    d.setLineDashPattern([], 0);
    d.setFont('helvetica', 'bold').setFontSize(6.5).setTextColor(...line.color);
    // Alternate sides so two close lines do not print their labels on top of each other.
    if (k % 2) d.text(line.label, f.x + 1, y - 1);
    else d.text(line.label, f.x + f.w - 1, y - 1, { align: 'right' });
  });
  const last = legend(r, opts.series, f.y + f.h + labelRoom + 5, f.x, f.w);
  r.y = last + 4;
}

export function scatterChart(r: Report, opts: {
  title: string; groups: { name: string; color: RGB; points: [number, number][] }[]; height?: number;
}) {
  const height = opts.height ?? 75;
  r.need(height + 10);
  chartTitle(r, opts.title);
  const all = opts.groups.flatMap((g) => g.points);
  const ya = niceAxis(0, Math.max(...all.map((p) => p[1]), 0.001));
  const f: Frame = { x: r.left + 14, y: r.y + 8, w: r.width - 18, h: height - 14, xa: hourAxis, ya };
  plotFrame(r, f);
  const d = r.doc;
  for (const g of opts.groups) {
    d.setFillColor(...g.color);
    for (const [x, y] of g.points) {
      d.circle(f.x + (x / 24) * f.w, f.y + f.h - ((y - ya.min) / (ya.max - ya.min)) * f.h, 0.22, 'F');
    }
  }
  const last = legend(r, opts.groups, f.y + f.h + 9, f.x, f.w);
  r.y = last + 4;
}

// --- Findings and heatmap -------------------------------------------------

/** Fixed status colours; each always travels with its text label. */
export const LEVEL_STYLE: Record<'high' | 'medium' | 'low' | 'info', { label: string; color: RGB }> = {
  high: { label: 'HIGH', color: hex('#d03b3b') },
  medium: { label: 'MEDIUM', color: hex('#ec835a') },
  low: { label: 'LOW', color: hex('#c98a00') },
  info: { label: 'NOTE', color: hex('#64748b') },
};

export function findingsList(r: Report, findings: {
  level: 'high' | 'medium' | 'low' | 'info'; title: string; detail: string; annualGbp?: number;
}[], labels: Partial<Record<'high' | 'medium' | 'low' | 'info', string>> = {}) {
  const d = r.doc;
  const textW = r.width - 30;
  for (const f of findings) {
    d.setFont('helvetica', 'normal').setFontSize(8.5);
    const lines = d.splitTextToSize(f.detail, textW) as string[];
    const h = 6 + lines.length * 3.8 + 3;
    r.need(h);
    const style = LEVEL_STYLE[f.level];
    d.setFillColor(...style.color);
    d.rect(r.left, r.y, 1.2, h - 2, 'F');
    d.setFont('helvetica', 'bold').setFontSize(6.5).setTextColor(...style.color);
    d.text(labels[f.level] ?? style.label, r.left + 3.5, r.y + 4);
    d.setFontSize(9.5).setTextColor(...INK);
    d.text(f.title, r.left + 19, r.y + 4);
    d.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(...MUTED);
    lines.forEach((line, i) => d.text(line, r.left + 19, r.y + 8.5 + i * 3.8));
    r.y += h;
  }
}

/** Embed a pre-drawn heatmap canvas with time-of-day and month axes. */
export function carpetImage(r: Report, opts: {
  title: string; canvas: HTMLCanvasElement; dates: string[]; maxKw: number; ramp: string[]; height?: number;
}) {
  const height = opts.height ?? 62;
  r.need(height + 18);
  const d = r.doc;
  d.setFont('helvetica', 'bold').setFontSize(9.5).setTextColor(...INK);
  d.text(opts.title, r.left, r.y + 4);
  const x = r.left + 12;
  const y = r.y + 8;
  const w = r.width - 14;
  d.addImage(opts.canvas.toDataURL('image/png'), 'PNG', x, y, w, height, undefined, 'FAST');
  d.setDrawColor(...hex('#94a3b8')).setLineWidth(0.2);
  d.rect(x, y, w, height);
  d.setFont('helvetica', 'normal').setFontSize(6.5).setTextColor(...MUTED);
  for (const h of [0, 6, 12, 18, 24]) {
    d.text(`${String(h).padStart(2, '0')}:00`, x - 1.5, y + (h / 24) * height + 1, { align: 'right' });
  }
  // A tick at the first day of each month.
  const n = opts.dates.length;
  opts.dates.forEach((date, i) => {
    if (date.slice(8) !== '01' && i !== 0) return;
    const px = x + (i / n) * w;
    const month = MONTHS_SHORT[Number(date.slice(5, 7)) - 1];
    d.line(px, y + height, px, y + height + 1);
    d.text(month + (date.slice(5, 7) === '01' || i === 0 ? ` ${date.slice(2, 4)}` : ''), px + 0.5, y + height + 4);
  });
  // Colour key.
  const ky = y + height + 7;
  const kw = 50;
  opts.ramp.forEach((c, i) => {
    d.setFillColor(...hex(c));
    d.rect(x + (i * kw) / opts.ramp.length, ky, kw / opts.ramp.length + 0.1, 2.5, 'F');
  });
  d.setTextColor(...MUTED);
  d.text('0 kW', x, ky + 5.5);
  d.text(`${fmt(opts.maxKw, opts.maxKw < 10 ? 1 : 0)} kW and above`, x + kw, ky + 5.5, { align: 'right' });
  d.text('Each column is one day, each row a half hour. Darker means more demand.', x + kw + 6, ky + 2.3);
  r.y = ky + 9;
}

/** The data quality verdict and anything it flagged. */
export function qualityBlock(r: Report, q: {
  verdict: 'good' | 'check' | 'poor';
  checks: { status: 'ok' | 'warn' | 'fail'; title: string; detail: string }[];
}, labels: Record<'good' | 'check' | 'poor', { label: string; summary: string }>) {
  const colour = { good: hex('#0ca30c'), check: hex('#c98a00'), poor: hex('#d03b3b') }[q.verdict];
  r.need(14);
  const d = r.doc;
  d.setFont('helvetica', 'bold').setFontSize(9.5).setTextColor(...colour);
  d.text(`Data quality: ${labels[q.verdict].label.toUpperCase()}`, r.left, r.y + 4);
  d.setFont('helvetica', 'normal').setTextColor(...INK);
  d.text(labels[q.verdict].summary, r.left + 42, r.y + 4);
  r.y += 7;
  const flagged = q.checks.filter((c) => c.status !== 'ok');
  if (flagged.length) {
    findingsList(r, flagged.map((c) => ({
      level: c.status === 'fail' ? 'high' : 'low', title: c.title, detail: c.detail,
    })), { high: 'FAIL', low: 'CHECK' });
  }
}

/** A pre-drawn canvas chart (axes included), scaled to the page width. */
export function imageBlock(r: Report, opts: { title?: string; canvas: HTMLCanvasElement; height: number }) {
  r.need(opts.height + (opts.title ? 8 : 2));
  const d = r.doc;
  if (opts.title) {
    d.setFont('helvetica', 'bold').setFontSize(9.5).setTextColor(...INK);
    d.text(opts.title, r.left, r.y + 4);
    r.y += 6;
  }
  d.addImage(opts.canvas.toDataURL('image/png'), 'PNG', r.left, r.y, r.width, opts.height, undefined, 'FAST');
  r.y += opts.height + 3;
}
