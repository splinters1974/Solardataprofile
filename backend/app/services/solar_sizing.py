import numpy as np
import pandas as pd

from app.services.economics import Appraisal, Assumptions, appraise

SUMMER_MONTHS = (6, 7, 8)


def align_generation(
    consumption: pd.DataFrame,
    gen_1kwp: pd.DataFrame,
) -> pd.DataFrame:
    """
    Put the PVGIS reference-year profile onto the consumption calendar.

    PVGIS returns a fixed reference year (2020); meter data can start on any
    date. Pandas aligns DataFrames on their index, so subtracting or clipping
    two differently-dated frames silently produces NaN everywhere. Match on
    month and day instead, so June consumption meets June sun.
    """
    gen_by_day: dict[tuple[int, int], np.ndarray] = {
        (ts.month, ts.day): row.to_numpy(dtype=float)
        for ts, row in gen_1kwp.iterrows()
    }
    monthly_mean = {
        month: sub.mean(axis=0).to_numpy(dtype=float)
        for month, sub in gen_1kwp.groupby(gen_1kwp.index.month)
    }
    overall_mean = gen_1kwp.mean(axis=0).to_numpy(dtype=float)

    rows = []
    for ts in consumption.index:
        key = (ts.month, ts.day)
        row = gen_by_day.get(key)
        if row is None and key == (2, 29):
            row = gen_by_day.get((2, 28))
        if row is None:
            row = monthly_mean.get(ts.month, overall_mean)
        rows.append(row)

    return pd.DataFrame(
        np.vstack(rows),
        index=consumption.index,
        columns=consumption.columns,
    )


def _compute_one(
    consumption: pd.DataFrame,
    gen_1kwp: pd.DataFrame,
    kwp: float,
    summer_mask: np.ndarray,
    assumptions: Assumptions,
    scale_to_year: float,
) -> dict:
    gen = gen_1kwp * kwp
    self_consumed = gen.clip(upper=consumption)
    exported = gen - self_consumed

    total_gen = float(gen.values.sum())
    total_sc = float(self_consumed.values.sum())
    total_exp = float(exported.values.sum())
    sc_rate = total_sc / total_gen if total_gen > 0 else 0.0

    total_cons = float(consumption.values.sum())
    offset_rate = total_sc / total_cons if total_cons > 0 else 0.0

    summer_export = float(exported.values[summer_mask].sum())

    # The upload can cover more or less than a year; the appraisal needs
    # annualised energy or payback comes out wrong by that same ratio.
    money = appraise(
        kwp,
        total_sc * scale_to_year,
        total_exp * scale_to_year,
        assumptions,
    )

    return {
        "kwp": kwp,
        "sc_rate": round(sc_rate, 4),
        "offset_rate": round(offset_rate, 4),
        "annual_generation_kwh": round(total_gen * scale_to_year, 1),
        "self_consumed_kwh": round(total_sc * scale_to_year, 1),
        "exported_kwh": round(total_exp * scale_to_year, 1),
        "summer_export_kwh": round(summer_export * scale_to_year, 1),
        "capex": money.capex,
        "year_one_saving": money.year_one_saving,
        "simple_payback_years": money.simple_payback_years,
        "npv": money.npv,
        "irr": money.irr,
        "_appraisal": money,
    }


def _monthly_chart(
    consumption: pd.DataFrame,
    gen: pd.DataFrame,
) -> list[dict]:
    self_consumed = gen.clip(upper=consumption)
    exported = gen - self_consumed

    m_cons = consumption.sum(axis=1).resample("ME").sum()
    m_gen = gen.sum(axis=1).resample("ME").sum()
    m_sc = self_consumed.sum(axis=1).resample("ME").sum()
    m_exp = exported.sum(axis=1).resample("ME").sum()

    # A 366-day upload spills one day into a 13th month. Left in, that renders
    # as a near-empty bar next to full ones and reads as a fault in the data.
    days_per_month = consumption.index.to_series().resample("ME").count()
    keep = days_per_month[days_per_month >= 15].index
    m_cons, m_gen = m_cons.loc[keep], m_gen.loc[keep]
    m_sc, m_exp = m_sc.loc[keep], m_exp.loc[keep]

    months = []
    for period in m_cons.index:
        months.append({
            "month": period.strftime("%b"),
            "consumption_kwh": round(float(m_cons[period]), 1),
            "generation_kwh": round(float(m_gen[period]), 1),
            "self_consumed_kwh": round(float(m_sc[period]), 1),
            "exported_kwh": round(float(m_exp[period]), 1),
        })
    return months


CANDIDATE_COUNT = 100
# How far past "generates the whole annual demand" to keep searching. Past
# this the array is exporting most of what it makes and the curve is flat.
SEARCH_HEADROOM = 2.5


def _candidate_sizes(consumption: pd.DataFrame, gen_1kwp: pd.DataFrame) -> list[float]:
    """
    Size the search range from the site itself, at every scale.

    The range is set as a proportion of the array that would generate the
    site's whole annual demand, so a 900 kWh flat load and a 1 GWh leisure
    centre both get the same resolution relative to their size.

    Do not put an absolute floor on this. An earlier version started the
    search at 0.5 kWp, which is already too big for a site drawing a couple
    of hundred watts: every candidate exported at midday, no size reached
    the self-consumption target, and the tool reported 0.5 kWp with "could
    not reach 80%" when the honest answer was a fraction of that.
    """
    annual_cons = float(consumption.values.sum())
    yield_per_kwp = float(gen_1kwp.values.sum())
    if yield_per_kwp <= 0 or annual_cons <= 0:
        return [round(s * 0.5, 1) for s in range(1, 41)]

    kwp_full_offset = annual_cons / yield_per_kwp
    top = min(kwp_full_offset * SEARCH_HEADROOM, 20_000.0)
    step = top / CANDIDATE_COUNT

    # Round to a precision that suits the scale, but never so coarsely that
    # candidates collide and the search loses resolution.
    if step >= 5:
        decimals = 0
    elif step >= 0.5:
        decimals = 1
    elif step >= 0.05:
        decimals = 2
    else:
        decimals = 3

    sizes: list[float] = []
    for i in range(1, CANDIDATE_COUNT + 1):
        value = round(step * i, decimals)
        if value > 0 and (not sizes or value > sizes[-1]):
            sizes.append(value)
    return sizes


def _payback_key(r: dict) -> float:
    """Sort key that pushes 'never pays back' to the bottom."""
    payback = r["simple_payback_years"]
    return payback if payback is not None else float("inf")


def recommend_system_size(
    consumption: pd.DataFrame,
    gen_1kwp: pd.DataFrame,
    target_sc_min: float = 0.70,
    target_sc_max: float = 0.90,
    assumptions: Assumptions | None = None,
) -> dict:
    """
    Size the array on economics, constrained by self-consumption.

    The rule: of the sizes that keep self-consumption inside the requested
    band, take the one with the shortest simple payback. Self-consumption
    is the constraint because exported units earn a fraction of what
    displaced import saves; payback is the decision metric because that is
    what a business case turns on.
    """
    if float(consumption.values.sum()) <= 0:
        raise ValueError(
            "The uploaded data contains no consumption. Check the file and try again."
        )
    if target_sc_min > target_sc_max:
        raise ValueError(
            "Minimum self-consumption cannot be higher than the maximum."
        )

    assumptions = assumptions or Assumptions()
    gen_1kwp = align_generation(consumption, gen_1kwp)
    summer_mask = np.isin(consumption.index.month.to_numpy(), SUMMER_MONTHS)
    days = len(consumption)
    scale_to_year = 365.25 / days if days else 1.0

    candidates = _candidate_sizes(consumption, gen_1kwp)
    results = [
        _compute_one(
            consumption, gen_1kwp, k, summer_mask, assumptions, scale_to_year
        )
        for k in candidates
    ]

    in_band = [
        r for r in results if target_sc_min <= r["sc_rate"] <= target_sc_max
    ]
    warning = None

    if in_band:
        best = min(in_band, key=_payback_key)
    elif any(r["sc_rate"] >= target_sc_min for r in results):
        # Every size sits above the band: solar never saturates this load.
        above = [r for r in results if r["sc_rate"] >= target_sc_min]
        best = max(above, key=lambda r: r["kwp"])
        warning = (
            f"Self-consumption stays above {int(target_sc_max * 100)}% at every "
            "size tested, so the load absorbs everything the array can make. "
            "Roof area or grid capacity will set the size here, not the "
            "consumption profile."
        )
    else:
        best = max(results, key=lambda r: r["sc_rate"])
        warning = (
            f"Could not reach {int(target_sc_min * 100)}% self-consumption at any "
            f"size. Best is {int(best['sc_rate'] * 100)}% at {best['kwp']} kWp, "
            "because generation overlaps poorly with when this site draws power. "
            "Worth testing storage or a load-shifting case."
        )

    # The largest system that still meets the minimum: maximum energy used
    # on site, usually at a slightly longer payback. Useful in the room.
    at_or_above_min = [r for r in results if r["sc_rate"] >= target_sc_min]
    max_onsite = max(at_or_above_min, key=lambda r: r["kwp"]) if at_or_above_min else best

    gen_best = gen_1kwp * best["kwp"]
    best["monthly_chart"] = _monthly_chart(consumption, gen_best)
    best["sizing_curve"] = results
    best["warning"] = warning
    best["alternative_max_onsite"] = None if max_onsite is best else max_onsite
    best["assumptions"] = assumptions
    best["target_sc_min"] = target_sc_min
    best["target_sc_max"] = target_sc_max
    best["days_analysed"] = days
    best["annual_consumption_kwh"] = round(
        float(consumption.values.sum()) * scale_to_year, 1
    )
    return best
