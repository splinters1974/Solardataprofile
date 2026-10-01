/**
 * Financial appraisal for one array size. Port of
 * backend/app/services/economics.py; every rate comes from the form.
 */
import type { EconomicAssumptions, Economics } from '../types';
import { round } from './analytics';

export const DEFAULT_ASSUMPTIONS: EconomicAssumptions = {
  import_price_p_kwh: 25,
  export_price_p_kwh: 5,
  capex_per_kwp: 800,
  opex_per_kwp_year: 10,
  import_price_inflation: 0.02,
  export_price_inflation: 0,
  opex_inflation: 0.03,
  discount_rate: 0.035,
  system_life_years: 25,
  degradation_rate: 0.005,
  carbon_factor: 0.196,
};

const npvOf = (rate: number, cashflow: number[]) =>
  cashflow.reduce((s, cf, i) => s + cf / (1 + rate) ** i, 0);

/** Bisection. Null when the project never pays back. */
function irrOf(cashflow: number[]): number | null {
  if (!cashflow.length || cashflow[0] >= 0) return null;
  if (cashflow.reduce((s, v) => s + v, 0) <= 0) return null;

  let low = -0.9499;
  let high = 10;
  let fLow = npvOf(low, cashflow);
  const fHigh = npvOf(high, cashflow);
  if (fLow * fHigh > 0) return null;

  for (let i = 0; i < 200; i++) {
    const mid = (low + high) / 2;
    const fMid = npvOf(mid, cashflow);
    if (Math.abs(fMid) < 1e-6) return mid;
    if (fLow * fMid < 0) high = mid;
    else { low = mid; fLow = fMid; }
  }
  return (low + high) / 2;
}

/** Years to cumulative break-even, interpolated within the crossing year. */
function paybackOf(cashflow: number[], rate = 0): number | null {
  let cumulative = 0;
  for (let year = 0; year < cashflow.length; year++) {
    const discounted = cashflow[year] / (1 + rate) ** year;
    const previous = cumulative;
    cumulative += discounted;
    if (year > 0 && previous < 0 && cumulative >= 0 && discounted > 0) {
      return round(year - 1 + -previous / discounted, 1);
    }
  }
  return null;
}

export function appraise(
  kwp: number, selfConsumedKwh: number, exportedKwh: number, a: EconomicAssumptions,
): Economics {
  const capexRate = a.capex_per_kwp;
  const capex = capexRate * kwp;
  const opex = a.opex_per_kwp_year * kwp;
  const importSaving = (selfConsumedKwh * a.import_price_p_kwh) / 100;
  const exportIncome = (exportedKwh * a.export_price_p_kwh) / 100;
  const yearOne = importSaving + exportIncome - opex;

  // Each stream escalates on its own rate: the avoided energy price and the
  // cost of maintaining the array are unrelated.
  const cashflow = [-capex];
  for (let y = 1; y <= a.system_life_years; y++) {
    const output = (1 - a.degradation_rate) ** (y - 1);
    cashflow.push(
      importSaving * output * (1 + a.import_price_inflation) ** (y - 1)
      + exportIncome * output * (1 + a.export_price_inflation) ** (y - 1)
      - opex * (1 + a.opex_inflation) ** (y - 1),
    );
  }

  let discCosts = capex;
  let discOutput = 0;
  for (let y = 1; y <= a.system_life_years; y++) {
    discCosts += (opex * (1 + a.opex_inflation) ** (y - 1)) / (1 + a.discount_rate) ** y;
    discOutput += ((selfConsumedKwh + exportedKwh) * (1 - a.degradation_rate) ** (y - 1))
      / (1 + a.discount_rate) ** y;
  }

  const irr = irrOf(cashflow);
  return {
    capex: round(capex),
    capex_per_kwp: round(capexRate),
    year_one_saving: round(yearOne),
    year_one_import_saving: round(importSaving),
    year_one_export_income: round(exportIncome),
    annual_opex: round(opex),
    lifetime_saving: round(cashflow.slice(1).reduce((s, v) => s + v, 0)),
    npv: round(npvOf(a.discount_rate, cashflow)),
    irr: irr === null ? null : round(irr, 4),
    simple_payback_years: paybackOf(cashflow),
    discounted_payback_years: paybackOf(cashflow, a.discount_rate),
    lcoe_p_kwh: discOutput > 0 ? round((discCosts / discOutput) * 100, 2) : null,
    carbon_saved_tonnes_year: round(((selfConsumedKwh + exportedKwh) * a.carbon_factor) / 1000, 1),
    cashflow: cashflow.map((c) => round(c)),
  };
}
