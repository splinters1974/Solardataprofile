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
    max_payback_years: float = 8.0,
    min_sc_rate: float = 0.50,
    assumptions: Assumptions | None = None,
) -> dict:
    """
    Take the largest array that still pays back inside the hurdle.

    Two constraints, both hard: simple payback at or under the hurdle, and
    self-consumption at or above the floor. Of the sizes that clear both,
    the biggest wins, because the point of the exercise is to cover as much
    of the site's demand as the business case will carry.

    An earlier version picked the shortest payback inside a self-consumption
    band. That rule was degenerate: under a flat capex rate payback worsens
    steadily with size, because each extra kWp is exported at 5p rather than
    avoiding 25p, so "shortest payback" always returned the smallest array
    the band allowed. The optimiser did nothing and the band ceiling chose
    the answer, and it minimised the array when the brief was to maximise
    on-site cover.

    Selecting on NPV instead does not fix it. Export at 5p over a 25 year
    life nearly pays for itself against this capex, so NPV keeps rewarding
    size until the marginal kWp is only single-digit-percent self-consumed:
    a mostly-exporting array at a payback no client would fund.

    Both constraints earn their place, and which one binds depends on the
    tariff. At 25p import the array clears an eight year payback across most
    of the curve, so the floor sets the answer. On a cheaper tariff the
    hurdle bites first. Note also that the banded capex curve means payback
    is not monotonic in size: the rate step at each band boundary can shorten
    it again, so the largest eligible size has to be found by scanning the
    whole curve rather than walking out until the test first fails.
    """
    if float(consumption.values.sum()) <= 0:
        raise ValueError(
            "The uploaded data contains no consumption. Check the file and try again."
        )
    if max_payback_years <= 0:
        raise ValueError("The payback hurdle must be greater than zero years.")

    # Last line of defence against a broken irradiance feed. Without this a
    # zero-generation profile produces a complete, confident-looking report
    # recommending 0 kWp — an answer about the data feed dressed up as an
    # answer about the site.
    if float(gen_1kwp.values.sum()) <= 0:
        raise ValueError(
            "The generation profile for this location is empty, so the array "
            "cannot be sized. This is a problem with the irradiance data, not "
            "with your consumption file. Please try again."
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

    meets_floor = [r for r in results if r["sc_rate"] >= min_sc_rate]
    eligible = [
        r for r in meets_floor
        if r["simple_payback_years"] is not None
        and r["simple_payback_years"] <= max_payback_years
    ]
    warning = None

    if eligible:
        best = max(eligible, key=lambda r: r["kwp"])
        if best is results[-1]:
            # The hurdle never bound, so the answer is an artefact of how far
            # the search ran rather than a finding about the site.
            warning = (
                "Every size tested pays back inside "
                f"{max_payback_years:g} years, so this figure is the top of the "
                "search range rather than a real ceiling. Tighten the payback "
                "hurdle or raise the self-consumption floor."
            )
    elif meets_floor:
        # Nothing clears the hurdle. Show the closest thing to it and say so,
        # rather than reporting a size that fails the test as if it passed.
        best = min(meets_floor, key=_payback_key)
        closest = (
            "never" if best["simple_payback_years"] is None
            else f"{best['simple_payback_years']:g} years"
        )
        warning = (
            f"No size pays back inside {max_payback_years:g} years. The best "
            f"available is {closest} at {best['kwp']} kWp, shown here. Either "
            "the tariff, the capital cost or the hurdle needs revisiting."
        )
    else:
        best = max(results, key=lambda r: r["sc_rate"])
        warning = (
            f"Could not reach {int(min_sc_rate * 100)}% self-consumption at any "
            f"size. Best is {int(best['sc_rate'] * 100)}% at {best['kwp']} kWp, "
            "because generation overlaps poorly with when this site draws power. "
            "Worth testing storage or a load-shifting case."
        )

    # The fastest-payback size, for when the conversation is about the best
    # return rather than the most cover. Always the small end of the curve.
    pool = meets_floor or results
    fastest = min(pool, key=_payback_key)

    gen_best = gen_1kwp * best["kwp"]
    best["monthly_chart"] = _monthly_chart(consumption, gen_best)
    best["sizing_curve"] = results
    best["warning"] = warning
    best["alternative_best_payback"] = None if fastest is best else fastest
    best["assumptions"] = assumptions
    best["max_payback_years"] = max_payback_years
    best["min_sc_rate"] = min_sc_rate
    best["days_analysed"] = days
    best["annual_consumption_kwh"] = round(
        float(consumption.values.sum()) * scale_to_year, 1
    )
    best["annual_yield_kwh_per_kwp"] = round(
        float(gen_1kwp.values.sum()) * scale_to_year, 1
    )
    return best
