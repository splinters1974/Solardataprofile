import numpy as np
import pandas as pd

PERFORMANCE_RATIO = 0.80
DEGRADATION_RATE = 0.005
CARBON_FACTOR = 0.196

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

    return {
        "kwp": kwp,
        "sc_rate": round(sc_rate, 4),
        "offset_rate": round(offset_rate, 4),
        "annual_generation_kwh": round(total_gen, 1),
        "self_consumed_kwh": round(total_sc, 1),
        "exported_kwh": round(total_exp, 1),
        "summer_export_kwh": round(summer_export, 1),
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


def _candidate_sizes(consumption: pd.DataFrame, gen_1kwp: pd.DataFrame) -> list[float]:
    """
    Size the search range from the site itself.

    A fixed 0.5–20 kWp ladder is fine for a house and useless for a leisure
    centre. Cap the search where generation would reach twice annual demand,
    which is well past any sensible self-consumption-led recommendation.
    """
    annual_cons = float(consumption.values.sum())
    yield_per_kwp = float(gen_1kwp.values.sum())
    if yield_per_kwp <= 0:
        return [round(s * 0.5, 1) for s in range(1, 41)]

    max_kwp = max(20.0, (2.0 * annual_cons) / yield_per_kwp)
    max_kwp = min(max_kwp, 5000.0)

    # ~60 evenly spaced candidates, rounded to a sane increment for the scale.
    step = max_kwp / 60.0
    if step < 0.5:
        step = 0.5
    elif step < 5:
        step = round(step * 2) / 2
    else:
        step = float(round(step))

    n = int(max_kwp / step) + 1
    return [round(step * i, 1) for i in range(1, n + 1)]


def recommend_system_size(
    consumption: pd.DataFrame,
    gen_1kwp: pd.DataFrame,
    target_sc_min: float = 0.80,
    target_sc_max: float = 0.90,
) -> dict:
    if float(consumption.values.sum()) <= 0:
        raise ValueError(
            "The uploaded data contains no consumption. Check the file and try again."
        )

    gen_1kwp = align_generation(consumption, gen_1kwp)
    summer_mask = np.isin(consumption.index.month.to_numpy(), SUMMER_MONTHS)

    candidates = _candidate_sizes(consumption, gen_1kwp)
    results = [_compute_one(consumption, gen_1kwp, k, summer_mask) for k in candidates]

    viable = [r for r in results if r["sc_rate"] >= target_sc_min]

    if viable:
        target_mid = (target_sc_min + target_sc_max) / 2
        best = min(viable, key=lambda r: abs(r["sc_rate"] - target_mid))
        warning = None
        if not any(r["sc_rate"] <= target_sc_max for r in viable):
            warning = (
                "Self-consumption exceeds "
                f"{int(target_sc_max * 100)}% even at the largest size tested. "
                "Load is well matched to solar, so a larger array is worth pricing."
            )
    else:
        best = max(results, key=lambda r: r["sc_rate"])
        warning = (
            f"Could not reach {int(target_sc_min * 100)}% self-consumption. "
            f"Best achievable is {int(best['sc_rate'] * 100)}% at {best['kwp']} kWp. "
            "This site may benefit from battery storage."
        )

    gen_best = gen_1kwp * best["kwp"]
    best["monthly_chart"] = _monthly_chart(consumption, gen_best)
    best["sizing_curve"] = results
    best["warning"] = warning
    return best
