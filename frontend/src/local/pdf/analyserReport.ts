/**
 * PDF of the Half Hourly Data Analyser: every chart plus the numbers behind
 * it. Port of backend/app/services/analyser_report.py, built from the same
 * functions the screen uses so the document and the page agree.
 */
import type {
  AnalyserSummary, DayNightResponse, DayProfileResponse, LoadDurationResponse,
  ScatterResponse, WeekResponse,
} from '../../types';
import { fmtLong } from '../dates';
import { AMERESCO_LOGO, BRAND_BLUE } from '../brand';
import { RAMP_HEX } from '../carpet';
import { describeHours, SITE_TYPES, type SiteMetrics, type SiteSettings } from '../findings';
import { VERDICT_TEXT, type QualityReport } from '../dataQuality';
import { inWindow, type HeadroomResult } from '../headroom';
import {
  barChart, carpetImage, findingsList, fmt, imageBlock, qualityBlock, hex, hourAxis, lineChart, Report, scatterChart,
  type RGB,
} from './common';

const BRAND = hex(BRAND_BLUE);

const SERIES_COLOURS: Record<string, RGB> = {
  Monday: hex('#0f766e'), Tuesday: hex('#0d9488'), Wednesday: hex('#14b8a6'),
  Thursday: hex('#2dd4bf'), Friday: hex('#5eead4'), Saturday: hex('#f59e0b'),
  Sunday: hex('#ef4444'), Weekday: hex('#1e293b'), Weekend: hex('#7c3aed'),
  'Bank holiday': hex('#db2777'), Total: hex('#64748b'),
};
const DAY_COLOURS = ['#0f766e', '#0d9488', '#14b8a6', '#2dd4bf', '#5eead4', '#f59e0b', '#ef4444'].map(hex);

const DISCLAIMER = 'Produced from the half-hourly consumption data supplied. Demand is shown '
  + 'in kW, which is twice the kWh recorded in each half hour. Bank holidays are England '
  + 'and Wales. Figures describe the metered period stated above and are not '
  + 'weather-corrected or adjusted for changes in occupancy or operation since.';

const halfHourPoints = (values: number[]): [number, number][] =>
  values.map((v, i) => [i / 2, v]);

export interface AnalyserReportInput {
  siteName: string;
  filename: string;
  dateFrom: string;
  dateTo: string;
  summary: AnalyserSummary;
  profile: DayProfileResponse;
  ldc: LoadDurationResponse;
  dayNight: DayNightResponse;
  weekA: WeekResponse;
  weekB: WeekResponse | null;
  scatter: ScatterResponse;
  excludeHolidays: boolean;
  filterNote: string;
  /** Findings, costs and the year heatmap. Absent on the hosted build. */
  site?: {
    metrics: SiteMetrics;
    settings: SiteSettings;
    carpet: { canvas: HTMLCanvasElement; maxKw: number; dates: string[] } | null;
    quality: QualityReport;
    headroom: HeadroomResult | null;
    /** Whole-period charts, pre-drawn: every half hour, and daily totals. */
    series: { hh: HTMLCanvasElement; daily: HTMLCanvasElement } | null;
  };
}

interface Section {
  key: string;
  title: string;
  draw: (r: Report) => void;
}

function newReport(i: AnalyserReportInput, what: string) {
  return new Report({
    orientation: 'landscape', brand: BRAND, margin: 15, logo: AMERESCO_LOGO,
    footer: `Ameresco Data Analyser  ·  ${i.siteName}  ·  ${what}`,
    title: `${i.siteName} — ${what}`,
  });
}

/** Title, headline numbers and (in the offline app) findings and data quality. */
function drawCover(r: Report, i: AnalyserReportInput) {
  r.title('Half Hourly Data Analysis',
    `${i.siteName}  ·  ${i.dateFrom} to ${i.dateTo}  ·  issued ${fmtLong(new Date())}`);
  const s = i.summary;
  const m = i.site?.metrics;
  r.tiles(m ? [
    [`£${fmt(m.annualCost)}`, 'ANNUAL COST'],
    [fmt(m.annualKwh), 'kWh A YEAR'],
    [`${fmt(s.peak_kw)} kW`, 'PEAK DEMAND'],
    [`${fmt(m.baseKw, 1)} kW`, 'BASE LOAD'],
    [m.hasOutOfHours ? `${Math.round(m.oohShare * 100)}%` : 'n/a', 'OUT OF HOURS'],
  ] : [
    [`${fmt(s.peak_kw)} kW`, 'PEAK DEMAND'],
    [`${fmt(s.average_kw)} kW`, 'AVERAGE DEMAND'],
    [`${(s.load_factor * 100).toFixed(0)}%`, 'LOAD FACTOR'],
    [fmt(s.total_kwh), 'TOTAL kWh'],
    [fmt(s.average_day_kwh), 'kWh PER DAY'],
  ]);
  r.paragraph(i.filterNote);

  if (i.site && m) {
    const st = i.site.settings;
    r.h2('What stands out', 40);
    findingsList(r, m.findings);
    r.space(2);
    qualityBlock(r, i.site.quality, VERDICT_TEXT);
    r.space(2);
    r.small(`Costs use ${m.rateP}p/kWh fully delivered and are scaled to a year from ${m.days} days of data. `
      + `They show what each pattern costs now, not a guaranteed saving. Building type: `
      + `${SITE_TYPES[st.type].label}. Opening hours: ${describeHours(st.hours)}`
      + `${st.hours.holidaysLikeSunday ? ', bank holidays as Sunday' : ''}. Base load is the 5th `
      + 'percentile of half-hourly demand.');
  }
}

/** Every chart section after the cover, in report order. */
function sectionsFor(i: AnalyserReportInput): Section[] {
  const s = i.summary;
  const out: Section[] = [];
  const site = i.site;

  if (site?.headroom) {
    const h = site.headroom;
    out.push({ key: 'headroom', title: 'Electrification headroom', draw: (r) => {
      const st = site.settings;
      r.h2('Electrification headroom');
      r.paragraph('How much load (heat pumps, EV charging, new plant) the site can add before it outgrows '
        + `its agreed supply capacity of ${fmt(h.capacityKva)} kVA. ${st.headroomMarginPct}% is held back as a `
        + `safety margin, leaving ${fmt(h.usableKva)} kVA usable. kW is converted to kVA at a power factor of `
        + `${st.powerFactor}.`);
      r.tiles([
        [`${fmt(h.capacityKva)} kVA`, 'AGREED CAPACITY'],
        [`${fmt(h.usableKva)} kVA`, 'USABLE'],
        [`${fmt(h.peakKva)} kVA`, 'PEAK DEMAND'],
        [`${fmt(h.firmHeadroomKw)} kW`, 'FIRM HEADROOM'],
        [`${Math.round((h.peakKva / h.capacityKva) * 100)}%`, 'CAPACITY USED'],
      ]);
      r.small(`Peak demand: ${h.peakWhen}. Firm headroom is the largest constant load that fits at every half `
        + 'hour of the period.');
      barChart(r, {
        title: 'Peak demand by month (kVA)', height: 44,
        categories: h.monthly.map((x) => x.month),
        series: [{ name: 'Monthly peak', color: hex('#2a78d6'), values: h.monthly.map((x) => x.peakKva) }],
        refLines: [
          { value: h.capacityKva, label: 'Capacity', color: hex('#334155') },
          { value: h.usableKva, label: 'Usable', color: hex('#d03b3b') },
        ],
      });
      const t = st.testLoad;
      const addKw = t && t.kw > 0 ? t.kw / (st.powerFactor || 0.95) : 0;
      lineChart(r, {
        title: 'Highest demand at each time of day (kVA)', height: 48, xa: hourAxis,
        series: [
          { name: 'Worst case, whole year', color: hex('#94a3b8'), width: 0.4, points: h.worstByTime.map((p) => [p.slot / 2, p.kva]) },
          { name: 'Worst case, Dec to Feb', color: hex('#2a78d6'), width: 0.6, points: h.worstWinterByTime.map((p) => [p.slot / 2, p.kva]) },
          ...(addKw ? [{
            name: 'With the new load', color: hex('#e07b1a'), width: 0.6,
            points: h.worstByTime.map((p, k): [number, number] => [p.slot / 2,
              (t!.months === 'heating' ? h.worstWinterByTime[k].kva : p.kva)
              + (inWindow(p.slot, t!.start, t!.end) ? addKw : 0)]),
          }] : []),
          { name: `Usable capacity (${fmt(h.usableKva)} kVA)`, color: hex('#d03b3b'), width: 0.4, dash: true,
            points: [[0, h.usableKva], [24, h.usableKva]] },
        ],
      });
      if (h.test) {
        r.callout(h.test.summary, {
          fill: h.test.fits ? hex('#f0fdf4') : hex('#fef2f2'),
          border: h.test.fits ? hex('#0ca30c') : hex('#d03b3b'),
          bold: h.test.fits ? 'New load fits.' : 'New load does not fit.',
        });
      }
    } });
  }

  if (site?.carpet) {
    const carpet = site.carpet;
    out.push({ key: 'year-at-a-glance', title: 'The year at a glance', draw: (r) => {
        r.h2('The year at a glance');
        r.paragraph('Every half hour of the period in one picture. Look for vertical stripes (whole days '
          + 'running differently), dark bands outside opening hours, and steps where the pattern changes.');
        carpetImage(r, {
          title: 'Demand by day and time of day (kW)', canvas: carpet.canvas,
          dates: carpet.dates, maxKw: carpet.maxKw, ramp: RAMP_HEX, height: 100,
        });
    } });
  }

  if (site?.series) {
    const series = site.series;
    out.push({ key: 'whole-period', title: 'Every half hour, whole period', draw: (r) => {
      r.h2('Every half hour, whole period');
      r.paragraph('Consumption in date order across the whole file, one tick per day. The top chart is every '
        + 'half-hourly reading; the bottom is each day\'s total. Look for changes in pattern, gaps and spikes.');
      imageBlock(r, { title: 'Half-hourly consumption (kWh per half hour)', canvas: series.hh, height: 62 });
      imageBlock(r, { title: 'Daily consumption (kWh per day)', canvas: series.daily, height: 50 });
    } });
  }

  out.push({ key: 'day-of-week-profile', title: 'Average demand by day of week', draw: (r) => {
      // --- Profile -------------------------------------------------------------
      const shown = [
        ...i.profile.series.filter((x) => x.group === 'summary'),
        ...i.profile.series.filter((x) => x.group === 'day'),
      ];
      r.h2('Average demand by day of week', 90);
      r.paragraph('Mean kW in each half hour. Bank holidays are '
        + (i.excludeHolidays
          ? 'shown separately, so they do not flatten the weekday average.'
          : 'included in the weekday average.'));
      lineChart(r, {
        title: 'Average demand by day of week (kW)',
        height: 88,
        xa: hourAxis,
        series: shown.map((x) => ({
          name: x.name,
          color: SERIES_COLOURS[x.name] ?? hex('#64748b'),
          points: halfHourPoints(x.values),
          width: x.group === 'summary' ? 0.6 : 0.3,
        })),
      });

      r.newPage();
      r.h2('Average demand by day of week — hourly values (kW)');
      // Half-hourly would be 48 rows and unreadable; hourly keeps it to a page.
      const ordered = [
        ...i.profile.series.filter((x) => x.group === 'day'),
        ...i.profile.series.filter((x) => x.group === 'summary'),
      ];
      const rows: string[][] = [];
      for (let slot = 0; slot < 48; slot += 2) {
        rows.push([i.profile.labels[slot], ...ordered.map((x) => fmt(x.values[slot], 1))]);
      }
      r.y = r.table(['Time', ...ordered.map((x) => x.name)], rows, { fontSize: 7 }) + 3;
      r.small('Days behind each average: '
        + Object.entries(i.profile.day_counts).map(([k, v]) => `${k} ${v}`).join(', '));
  } });

  out.push({ key: 'load-duration', title: 'Load duration curve', draw: (r) => {
      r.h2('Load duration curve');
      r.paragraph('Load in kW against the hours per year the site sits at or above it. The steep '
        + 'left-hand tail is peak demand carried for very few hours; the flat right-hand end is '
        + 'base load running all year.');
      lineChart(r, {
        title: 'Load duration curve (kW against hours per year)',
        height: 48,
        xa: { min: 0, max: 8766, ticks: [0, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000], format: (v) => `${v / 1000}k` },
        xCaption: 'Hours per year at or above this load',
        series: [{ name: 'Load', color: BRAND, width: 0.6, points: i.ldc.curve.map((p) => [p.hours, p.kw]) }],
      });
      r.tiles([
        [`${fmt(i.ldc.peak_kw)} kW`, 'PEAK'],
        [`${fmt(i.ldc.average_kw)} kW`, 'AVERAGE'],
        [`${fmt(i.ldc.base_kw)} kW`, 'BASE'],
        [`${(i.ldc.load_factor * 100).toFixed(0)}%`, 'LOAD FACTOR'],
        [fmt(i.ldc.hours_covered), 'HOURS OF DATA'],
      ]);
      r.h2('Load exceeded for selected durations');
      // "What load do we carry for X hours a year?", answered directly.
      const targets = [50, 100, 250, 500, 1000, 2000, 4000, 6000, 8000, 8766];
      const durationRows = i.ldc.curve.length ? targets.map((t) => {
        const nearest = i.ldc.curve.reduce((a, b) => (Math.abs(b.hours - t) < Math.abs(a.hours - t) ? b : a));
        const share = i.ldc.peak_kw ? (nearest.kw / i.ldc.peak_kw) * 100 : 0;
        return [fmt(t), fmt(nearest.kw, 1), `${share.toFixed(0)}%`];
      }) : [];
      r.y = r.table(['Hours per year', 'Load at or above (kW)', '% of peak'], durationRows,
        { widths: [0.34, 0.33, 0.33], fontSize: 7 }) + 3;
  } });

  out.push({ key: 'day-night', title: 'Day and night consumption', draw: (r) => {
      const t = i.dayNight.totals;
      r.h2('Day and night consumption by month');
      r.paragraph(`Night is ${i.dayNight.night_window}. ${((t.night_share ?? 0) * 100).toFixed(0)}% of `
        + 'consumption in this period falls in the night window. A high night share on a site '
        + 'that closes overnight usually means plant left running.');
      barChart(r, {
        title: 'Day and night consumption by month (kWh)',
        stacked: true,
        angledLabels: i.dayNight.months.length > 13,
        height: 62,
        categories: i.dayNight.months.map((m) => m.month),
        series: [
          { name: 'Day', color: hex('#f59e0b'), values: i.dayNight.months.map((m) => m.day_kwh) },
          { name: `Night (${i.dayNight.night_window})`, color: hex('#1e293b'), values: i.dayNight.months.map((m) => m.night_kwh) },
        ],
      });
      const dnRows = i.dayNight.months.map((m) => {
        const total = m.day_kwh + m.night_kwh;
        return [
          m.month + (m.complete ? '' : ' (partial)'), fmt(m.day_kwh), fmt(m.night_kwh), fmt(total),
          `${total ? ((m.night_kwh / total) * 100).toFixed(0) : 0}%`, String(m.days),
        ];
      });
      dnRows.push(['Total', fmt(t.day_kwh ?? 0), fmt(t.night_kwh ?? 0),
        fmt((t.day_kwh ?? 0) + (t.night_kwh ?? 0)), `${((t.night_share ?? 0) * 100).toFixed(0)}%`, '']);
      r.y = r.table(['Month', 'Day (kWh)', 'Night (kWh)', 'Total (kWh)', 'Night share', 'Days'], dnRows,
        { widths: [0.24, 0.152, 0.152, 0.152, 0.152, 0.152], boldLast: true, fontSize: 7 }) + 3;
  } });

  for (const [week, title] of [[i.weekA, 'Week profile'], [i.weekB, 'Comparison week']] as const) {
    if (!week || !week.days.length) continue;
    out.push({ key: title === 'Week profile' ? 'week-profile' : 'comparison-week', title, draw: (r) => {
        r.h2(`${title} — week commencing ${week.week_commencing}`);
        lineChart(r, {
          title: `${title} (kW)`,
          height: 80,
          xa: hourAxis,
          series: week.days.map((d, k) => ({
            name: d.label, color: DAY_COLOURS[k % DAY_COLOURS.length], width: 0.45,
            points: halfHourPoints(d.values),
          })),
        });
        r.y = r.table(['Day', 'Total kWh', 'Peak kW', 'Average kW', 'Min kW'], week.days.map((d) => [
          d.label, fmt(d.total_kwh), fmt(Math.max(...d.values), 1),
          fmt(d.values.reduce((a, b) => a + b, 0) / d.values.length, 1), fmt(Math.min(...d.values), 1),
        ]), { widths: [0.28, 0.18, 0.18, 0.18, 0.18] }) + 3;
    } });
  }

  out.push({ key: 'every-reading', title: 'Every half-hourly reading', draw: (r) => {
      r.h2('Every half-hourly reading');
      r.paragraph('Load against time of day for the whole period. The spread around the averages '
        + 'is what a line chart hides: a tight band means a predictable site, a wide one means the '
        + 'average alone is not much use for sizing.');
      const groups = ([['Weekday', '#0f766e'], ['Weekend', '#f59e0b'], ['Bank holiday', '#db2777']] as const)
        .map(([name, colour]) => ({
          name, color: hex(colour),
          points: i.scatter.points.filter((p) => p.type === name).map((p) => [p.hour, p.kw] as [number, number]),
        }))
        .filter((g) => g.points.length);
      scatterChart(r, {
        title: 'Every half-hourly reading, load against time of day (kW)', height: 72, groups,
      });
      r.h2('Notable days', 40);
      r.y = r.table(['', 'Date', 'Value'], [
        ['Peak half hour', s.peak_when, `${fmt(s.peak_kw)} kW`],
        ['Highest day', s.highest_day, `${fmt(s.highest_day_kwh)} kWh`],
        ['Lowest day', s.lowest_day, `${fmt(s.lowest_day_kwh)} kWh`],
        ['Lowest half hour', '—', `${fmt(s.base_kw, 1)} kW`],
      ], { widths: [0.3, 0.4, 0.3], fontSize: 8.5 }) + 3;
  } });

  return out;
}

const basis = (r: Report, i: AnalyserReportInput) => {
  r.h2('Basis', 8);
  r.small(i.filename ? `${DISCLAIMER} Source file: ${i.filename}.` : DISCLAIMER);
};

/** The whole analysis as one document. */
export function buildAnalyserReport(i: AnalyserReportInput): ArrayBuffer {
  const r = newReport(i, 'half hourly data analysis');
  drawCover(r, i);
  for (const section of sectionsFor(i)) {
    r.newPage();
    section.draw(r);
  }
  basis(r, i);
  return r.finish();
}

/** The same analysis, one PDF per section, for dropping into proposals. */
export function buildAnalyserSectionPdfs(i: AnalyserReportInput): { key: string; title: string; pdf: ArrayBuffer }[] {
  const cover = newReport(i, 'summary');
  drawCover(cover, i);
  basis(cover, i);
  const out = [{ key: 'summary', title: 'Summary', pdf: cover.finish() }];
  for (const section of sectionsFor(i)) {
    const r = newReport(i, section.title.toLowerCase());
    r.subhead(`${i.siteName}  ·  ${i.dateFrom} to ${i.dateTo}  ·  issued ${fmtLong(new Date())}`);
    section.draw(r);
    basis(r, i);
    out.push({ key: section.key, title: section.title, pdf: r.finish() });
  }
  return out;
}
