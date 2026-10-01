/**
 * Client-facing PDF of the sizing result. Port of
 * backend/app/services/pdf_report.py.
 */
import type { SizingValues, SolarSizeResponse } from '../../types';
import { fmtLong } from '../dates';
import {
  barChart, fmt, hex, lineChart, money, MUTED, PANEL, pct, Report, years,
} from './common';

const BRAND = hex('#0f766e');
const ACCENT = hex('#f59e0b');

const GLOSSARY: [string, string][] = [
  ['NPV (Net Present Value)',
    "the value the project creates across its life, in today's money, after the capital "
    + 'cost is taken off. Positive means it is worth doing.'],
  ['IRR (Internal Rate of Return)',
    'the annual return the money earns while it is tied up in the array. Compare it against '
    + 'the cost of capital, or against whatever else the same capital could fund.'],
  ['LCOE (Levelised Cost of Energy)',
    'what a unit of electricity from the array costs over its whole life, capital and running '
    + 'costs included. Compare it against the price the site pays for electricity today.'],
];

/** Readable at any scale: a 0.5 kWp array must not print as "0 kWp". */
const kwp = (v: number) => (v < 1 ? fmt(v, 2) : v < 10 ? fmt(v, 1) : fmt(v));

function aspectLabel(aspect: number): string {
  const names: Record<number, string> = {
    0: 'due south', [-45]: 'south-east', 45: 'south-west', [-90]: 'east', 90: 'west',
    [-135]: 'north-east', 135: 'north-west', 180: 'north', [-180]: 'north',
  };
  return names[aspect] ?? `${aspect}° from south`;
}

export interface SolarReportInput {
  siteName: string;
  postcode: string;
  dateFrom: string;
  dateTo: string;
  result: SolarSizeResponse;
  values: SizingValues;
  irradianceLabel: string;
  estimated: boolean;
  dataWarnings: string[];
}

export function buildSolarReport(i: SolarReportInput): ArrayBuffer {
  const r = new Report({
    orientation: 'portrait', brand: BRAND, margin: 20,
    footer: `${i.siteName} — solar sizing appraisal`,
    title: `${i.siteName} — Solar Sizing Appraisal`,
  });
  const res = i.result;
  const e = res.economics;
  const a = i.values.assumptions;
  const tilt = i.values.roof_tilt;
  const aspect = i.values.roof_aspect;

  r.title('Solar Sizing Appraisal', `${i.siteName}  ·  ${i.postcode}  ·  issued ${fmtLong(new Date())}`);
  r.tiles([
    [kwp(res.recommended_kwp), 'RECOMMENDED kWp'],
    [years(e.simple_payback_years), 'SIMPLE PAYBACK'],
    [money(e.year_one_saving), 'YEAR 1 SAVING'],
    [pct(res.sc_rate, 0), 'SELF-CONSUMPTION'],
    [`${fmt(e.carbon_saved_tonnes_year)} t`, 'CO2e SAVED / YEAR'],
  ]);
  r.space(2);
  r.paragraph(
    `Sized against ${res.days_analysed} days of half-hourly metered consumption `
    + `(${i.dateFrom} to ${i.dateTo}), giving an annualised demand of `
    + `${fmt(res.annual_consumption_kwh)} kWh. A ${kwp(res.recommended_kwp)} kWp array on a `
    + `${tilt}° roof at ${aspectLabel(aspect)} would generate ${fmt(res.annual_generation_kwh)} kWh `
    + `a year, of which ${pct(res.sc_rate, 0)} is used on site. That meets `
    + `${pct(res.offset_rate, 0)} of the site's total electricity demand and returns `
    + `${money(e.year_one_saving)} in year one against a capital cost of ${money(e.capex)}.`,
  );
  if (res.warning) {
    r.callout(res.warning, { fill: hex('#fffbeb'), border: ACCENT, bold: 'Note:' });
  }
  if (i.estimated) {
    r.callout(
      'Generation in this report comes from the built-in typical-year solar model, because '
      + 'PVGIS could not be reached when it was run. Expect annual yield to be within about '
      + 'ten per cent of a PVGIS figure. Re-run with an internet connection before relying on '
      + 'the numbers in a business case.',
      { fill: hex('#fffbeb'), border: ACCENT, bold: 'Estimated irradiance:' },
    );
  }

  // --- Energy and financial summary ----------------------------------------
  r.h2('Energy and financial summary', 60);
  const half = r.width / 2 - 3;
  const top = r.y;
  const endLeft = r.table(['Energy', 'Per year'], [
    ['Site consumption', `${fmt(res.annual_consumption_kwh)} kWh`],
    ['Solar generation', `${fmt(res.annual_generation_kwh)} kWh`],
    ['Used on site', `${fmt(res.self_consumed_kwh)} kWh`],
    ['Exported to grid', `${fmt(res.exported_kwh)} kWh`],
    ['Self-consumption rate', pct(res.sc_rate)],
    ['Demand met by solar', pct(res.offset_rate)],
    ['Yield', `${fmt(res.annual_generation_kwh / res.recommended_kwp)} kWh/kWp`],
  ], { width: half, widths: [0.58, 0.42], fontSize: 8.5 });
  r.y = top;
  const endRight = r.table(['Financial', 'Value'], [
    ['Capital cost', money(e.capex)],
    ['Year 1 import saving', money(e.year_one_import_saving)],
    ['Year 1 export income', money(e.year_one_export_income)],
    ['Annual O&M', money(e.annual_opex)],
    ['Simple payback', years(e.simple_payback_years)],
    ['Discounted payback', years(e.discounted_payback_years)],
  ], { x: r.left + half + 6, width: half, widths: [0.58, 0.42], fontSize: 8.5 });
  r.y = Math.max(endLeft, endRight) + 5;

  const life = e.carbon_saved_tonnes_year * a.system_life_years;
  r.y = r.table(['Whole-life position', `Over ${a.system_life_years} years`], [
    ['Net present value (NPV) *', money(e.npv)],
    ['Internal rate of return (IRR) *', e.irr === null ? 'n/a' : pct(e.irr)],
    ['Undiscounted lifetime saving', money(e.lifetime_saving)],
    ['Levelised cost of energy (LCOE) *', e.lcoe_p_kwh === null ? 'n/a'
      : `${e.lcoe_p_kwh.toFixed(1)}p/kWh vs ${a.import_price_p_kwh.toFixed(1)}p import`],
    ['Carbon avoided', `${fmt(e.carbon_saved_tonnes_year, 1)} tCO2e/yr (${fmt(life)} t lifetime)`],
  ], { widths: [0.42, 0.58], fontSize: 8.5 }) + 3;
  for (const [term, meaning] of GLOSSARY) r.small(`* ${term}: ${meaning}`);

  // --- Charts ----------------------------------------------------------------
  r.newPage();
  r.h2('How generation matches demand');
  r.paragraph('Grey is what the site draws. Green is solar the site uses as it is generated, '
    + `which displaces import at ${a.import_price_p_kwh.toFixed(1)}p/kWh. Amber is surplus `
    + `exported at ${a.export_price_p_kwh.toFixed(1)}p/kWh. Sizing is driven by keeping the amber `
    + 'band small enough that the array still pays back quickly.');
  barChart(r, {
    title: 'Monthly energy balance (kWh)',
    height: 75,
    categories: res.monthly_chart.map((m) => m.month),
    series: [
      { name: 'Site consumption', color: hex('#cbd5e1'), values: res.monthly_chart.map((m) => m.consumption_kwh) },
      { name: 'Solar used on site', color: BRAND, values: res.monthly_chart.map((m) => m.self_consumed_kwh) },
      { name: 'Exported', color: ACCENT, values: res.monthly_chart.map((m) => m.exported_kwh) },
    ],
  });

  r.h2('Why this size', 80);
  r.paragraph('Payback improves with scale at first, because fixed costs spread over more panels. '
    + 'Past the point where the site can absorb what the array makes, surplus is exported at a '
    + 'fraction of the import price and payback worsens again. The recommendation sits at the '
    + `turning point, inside the ${pct(i.values.target_sc_min, 0)} to `
    + `${pct(i.values.target_sc_max, 0)} self-consumption band.`);
  const points = res.sizing_curve.filter((p) => p.simple_payback_years !== null);
  if (points.length) {
    const maxPay = Math.max(...points.map((p) => p.simple_payback_years!));
    const chosen = points.find((p) => p.kwp === res.recommended_kwp);
    lineChart(r, {
      title: 'Payback and self-consumption against array size',
      height: 72,
      xCaption: 'Array size (kWp)  |  solid: simple payback (years, left axis)  |  dashed: '
        + 'self-consumption, 0-100% scaled to the same axis',
      marker: chosen ? { x: chosen.kwp, y: chosen.simple_payback_years!, color: BRAND } : undefined,
      series: [
        { name: 'Simple payback (years)', color: BRAND, width: 0.6,
          points: points.map((p) => [p.kwp, p.simple_payback_years!]) },
        { name: 'Self-consumption (scaled)', color: hex('#94a3b8'), width: 0.4, dash: true,
          points: points.map((p) => [p.kwp, p.sc_rate * maxPay]) },
      ],
    });
    if (chosen) {
      r.paragraph(`Recommended: ${kwp(chosen.kwp)} kWp at ${chosen.simple_payback_years!.toFixed(1)} `
        + `year payback and ${(chosen.sc_rate * 100).toFixed(0)}% self-consumption.`,
      { size: 8, bold: true, color: BRAND });
    }
  } else {
    r.paragraph('Payback could not be calculated.', { color: MUTED });
  }

  const alt = res.alternative_max_onsite;
  if (alt) {
    r.h2('Alternative: maximum energy on site', 25);
    r.paragraph(
      'If the priority is displacing as much grid import as possible rather than the shortest '
      + `payback, ${kwp(alt.kwp)} kWp is the largest array that still keeps self-consumption at `
      + `or above ${pct(i.values.target_sc_min, 0)}. It generates ${fmt(alt.annual_generation_kwh)} `
      + `kWh a year and uses ${fmt(alt.self_consumed_kwh)} kWh on site, at `
      + `${years(alt.simple_payback_years)} payback and ${money(alt.npv)} NPV against `
      + `${years(e.simple_payback_years)} and ${money(e.npv)} for the recommendation.`,
    );
  }

  // --- Assumptions and cashflow ----------------------------------------------
  r.newPage();
  r.h2('Assumptions');
  r.paragraph('Replace these with project-specific figures before the numbers are used in a business case.');
  r.y = r.table(['Assumption', 'Value'], [
    ['Import price', `${a.import_price_p_kwh.toFixed(2)} p/kWh`],
    ['Export price', `${a.export_price_p_kwh.toFixed(2)} p/kWh`],
    ['Capital cost', `£${fmt(a.capex_per_kwp)} per kWp installed`],
    ['Operating cost', `£${fmt(a.opex_per_kwp_year, 2)} per kWp per year`],
    ['Energy price inflation', pct(a.import_price_inflation)],
    ['Export price inflation', pct(a.export_price_inflation)],
    ['Operating cost inflation', pct(a.opex_inflation)],
    ['Discount rate', pct(a.discount_rate)],
    ['System life', `${a.system_life_years} years`],
    ['Annual output degradation', pct(a.degradation_rate, 2)],
    ['Grid carbon factor', `${a.carbon_factor.toFixed(3)} kgCO2e/kWh`],
    ['Roof pitch and orientation', `${tilt}° at ${aspectLabel(aspect)}`],
    ['Irradiance source', i.irradianceLabel],
    ['Consumption data', `${res.days_analysed} days, ${i.dateFrom} to ${i.dateTo}`],
  ], { widths: [0.42, 0.58], fontSize: 8.5 }) + 3;

  if (i.dataWarnings.length) {
    r.h2('Data notes', 15);
    for (const w of i.dataWarnings) r.paragraph(`•  ${w}`);
  }

  r.h2('Indicative cashflow', 40);
  let cumulative = 0;
  r.y = r.table(['Year', 'Net cashflow', 'Cumulative'], e.cashflow.map((flow, year) => {
    cumulative += flow;
    return [year === 0 ? '0 (build)' : String(year), money(flow), money(cumulative)];
  }), { widths: [0.2, 0.4, 0.4], fontSize: 8 }) + 3;

  // --- What the numbers depend on -------------------------------------------
  r.newPage();
  r.h2('Assumptions this appraisal depends on');
  r.paragraph('These are taken as given. Every one of them is a question to settle before the '
    + 'numbers become a commitment.');
  const points2: [string, string][] = [
    ['Roof space.', `The site has enough suitable, unshaded roof for the full ${kwp(res.recommended_kwp)} `
      + 'kWp. No survey of area, orientation, structural capacity or shading has been carried out.'],
    ['Grid connection.', 'A connection is available and the site is permitted to export. A refused '
      + 'or capacity-limited connection, or an export limitation, would change the answer materially.'],
    [`Energy the site uses is worth ${a.import_price_p_kwh.toFixed(1)}p/kWh.`, 'That is the current '
      + 'fully inclusive purchase price, so every unit generated and used on site avoids buying one '
      + 'at that price.'],
    [`Energy exported is worth ${a.export_price_p_kwh.toFixed(1)}p/kWh.`, 'Everything not used on site '
      + 'is sold at this rate, which is why keeping generation on site rather than exporting it '
      + 'drives the sizing.'],
    [`The purchase price rises ${pct(a.import_price_inflation, 0)} a year.`, 'Savings therefore grow '
      + 'year on year, because each unit avoided is worth more than the last. Export is held '
      + (a.export_price_inflation ? `at ${pct(a.export_price_inflation, 0)} inflation.` : 'flat across the term.')],
    [`Operating cost rises ${pct(a.opex_inflation, 0)} a year`, `from ${money(e.annual_opex)} in year `
      + 'one, covering maintenance, monitoring and insurance.'],
    [`Capital cost is ${money(e.capex)} installed,`, `inclusive. Output falls ${pct(a.degradation_rate, 2)} `
      + `a year over a ${a.system_life_years}-year term, and cashflows are discounted at `
      + `${pct(a.discount_rate)}.`],
  ];
  const d = r.doc;
  d.setFontSize(9.5);
  const boxLines = points2.map(([b, rest]) => d.splitTextToSize(`•  ${b} ${rest}`, r.width - 10) as string[]);
  const boxH = boxLines.reduce((s, l) => s + l.length * 5 + 2.5, 4);
  r.need(boxH);
  d.setFillColor(...PANEL).setDrawColor(...BRAND).setLineWidth(0.4);
  d.rect(r.left, r.y, r.width, boxH, 'FD');
  let y = r.y + 6;
  d.setTextColor(30, 41, 59);
  for (const lines of boxLines) {
    lines.forEach((line) => { d.setFont('helvetica', 'normal'); d.text(line, r.left + 5, y); y += 5; });
    y += 2.5;
  }
  r.y += boxH + 4;

  r.h2('Basis and limitations', 25);
  r.small(
    'This report is an indicative desktop appraisal produced from the half-hourly consumption '
    + 'data supplied and modelled irradiance for the site postcode. It is not a design, a '
    + 'quotation, or a guarantee of performance. '
    + (i.estimated
      ? 'Generation is modelled from a built-in typical-year solar model rather than PVGIS, '
        + 'so it carries more uncertainty than a PVGIS-based figure. '
      : 'Generation is modelled from PVGIS for a single weather year, so a sunnier or duller '
        + 'year will shift output either way. ')
    + 'Costs, tariffs and discount rates are the assumptions listed in this report and should be '
    + 'replaced with project-specific figures before the numbers are relied on. No allowance has '
    + 'been made for roof area, structural capacity, shading surveys, grid connection constraints '
    + 'or planning.',
  );

  return r.finish();
}
