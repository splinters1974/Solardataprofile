import pandas as pd
import numpy as np

PERFORMANCE_RATIO = 0.80
DEGRADATION_RATE = 0.005
CARBON_FACTOR = 0.196


def _align_lengths(consumption: pd.DataFrame, generation: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Trim both DataFrames to the same number of rows."""
    n = min(len(consumption), len(generation))
    return consumption.iloc[:n].copy(), generation.iloc[:n].copy()


def _compute_one(
    consumption: pd.DataFrame,
    gen_1kwp: pd.DataFrame,
    kwp: float,
) -> dict:
    gen = gen_1kwp * kwp
    self_consumed = gen.clip(upper=consumption)
    exported = gen - self_consumed

    total_gen = float(gen.values.sum())
    total_sc = float(self_consumed.values.sum())
    total_exp = float(exported.values.sum())
    sc_rate = total_sc / total_gen if total_gen > 0 else 0.0

    summer_mask = consumption.index.month.isin([6, 7, 8])
    summer_export = float(exported[summer_mask].values.sum())

    return {
        "kwp": kwp,
        "sc_rate": round(sc_rate, 4),
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


def recommend_system_size(
    consumption: pd.DataFrame,
    gen_1kwp: pd.DataFrame,
    target_sc_min: float = 0.80,
    target_sc_max: float = 0.90,
) -> dict:
    consumption, gen_1kwp = _align_lengths(consumption, gen_1kwp)

    candidates = [round(s * 0.5, 1) for s in range(1, 41)]  # 0.5 → 20.0 kWp
    results = [_compute_one(consumption, gen_1kwp, kwp) for kwp in candidates]

    viable = [r for r in results if r["sc_rate"] >= target_sc_min]

    if viable:
        best = min(viable, key=lambda r: abs(r["sc_rate"] - 0.85))
        warning = None
        if not any(r["sc_rate"] <= target_sc_max for r in viable):
            warning = (
                "Self-consumption exceeds 90% even at minimum system size. "
                "Load is well-matched to solar. Consider a larger system."
            )
    else:
        best = max(results, key=lambda r: r["sc_rate"])
        warning = (
            f"Could not reach {int(target_sc_min*100)}% self-consumption. "
            f"Best achievable is {int(best['sc_rate']*100)}% at {best['kwp']} kWp. "
            "This site may benefit from battery storage."
        )

    gen_best = gen_1kwp * best["kwp"]
    best["monthly_chart"] = _monthly_chart(consumption, gen_best)
    best["sizing_curve"] = results
    best["warning"] = warning
    return best
