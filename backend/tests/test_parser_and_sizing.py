import io
from datetime import date, timedelta

import numpy as np
import pandas as pd
import pytest

from app.services.excel_parser import load_and_normalise
from app.services.solar_sizing import align_generation, recommend_system_size


def _uk_generation_profile(year: int = 2020) -> pd.DataFrame:
    """A stand-in for the PVGIS 1 kWp reference year: seasonal, daylight-only."""
    idx = pd.date_range(f"{year}-01-01", periods=366, freq="D")
    shape = np.array([max(0.0, np.sin(np.pi * (s - 16) / 32)) for s in range(48)])
    shape = shape / shape.sum()
    rows = [
        shape * 2.9 * (0.55 + 0.45 * np.cos(2 * np.pi * (ts.dayofyear - 172) / 365))
        for ts in idx
    ]
    return pd.DataFrame(np.vstack(rows), index=idx, columns=range(48))


def _consumption(start: str, days: int = 366, level: float = 40.0) -> pd.DataFrame:
    idx = pd.DatetimeIndex(
        [pd.Timestamp(start) + timedelta(days=i) for i in range(days)]
    )
    return pd.DataFrame(np.full((days, 48), level), index=idx, columns=range(48))


def _csv_bytes(df: pd.DataFrame, dates: list[str] | None = None) -> bytes:
    out = io.StringIO()
    header = ["Date"] + [f"{h:02d}:{m:02d}" for h in range(24) for m in (0, 30)]
    out.write(",".join(header) + "\n")
    for i, (_, row) in enumerate(df.iterrows()):
        stamp = dates[i] if dates else ""
        out.write(stamp + "," + ",".join(str(v) for v in row.tolist()) + "\n")
    return out.getvalue().encode()


class TestGenerationAlignment:
    def test_generation_maps_onto_consumption_calendar(self):
        """
        Regression: consumption and the PVGIS reference year used to carry
        different indexes, so pandas aligned them to nothing and every
        self-consumption figure came back NaN.
        """
        cons = _consumption("2018-11-01")
        gen = align_generation(cons, _uk_generation_profile())

        assert list(gen.index) == list(cons.index)
        assert not gen.isna().any().any()
        assert (gen.clip(upper=cons).sum().sum()) > 0

    def test_seasonality_follows_the_real_month(self):
        cons = _consumption("2018-11-01")
        gen = align_generation(cons, _uk_generation_profile())
        by_month = gen.sum(axis=1).groupby(gen.index.month).mean()

        assert by_month.idxmax() in (5, 6, 7)
        assert by_month.idxmin() in (11, 12, 1)

    def test_leap_day_falls_back_to_28_february(self):
        cons = _consumption("2024-01-01", days=366)
        gen = align_generation(cons, _uk_generation_profile(2021))  # no 29 Feb
        assert not gen.isna().any().any()


class TestRecommendation:
    def test_returns_real_numbers_not_nan(self):
        cons = _consumption("2018-11-01")
        result = recommend_system_size(cons, _uk_generation_profile())

        for key in (
            "sc_rate",
            "offset_rate",
            "annual_generation_kwh",
            "self_consumed_kwh",
            "exported_kwh",
        ):
            assert np.isfinite(result[key]), f"{key} is not finite"
        assert result["kwp"] > 0
        assert 0.0 <= result["sc_rate"] <= 1.0

    def test_self_consumption_falls_as_the_array_grows(self):
        cons = _consumption("2018-11-01")
        curve = recommend_system_size(cons, _uk_generation_profile())["sizing_curve"]
        rates = [p["sc_rate"] for p in curve]
        assert rates == sorted(rates, reverse=True)

    def test_search_range_scales_to_site_demand(self):
        """A fixed 20 kWp ceiling is useless for a site on 1 GWh a year."""
        gen = _uk_generation_profile()
        big = recommend_system_size(_consumption("2018-11-01", level=100.0), gen)
        small = recommend_system_size(_consumption("2018-11-01", level=1.0), gen)

        assert big["sizing_curve"][-1]["kwp"] > 1000
        assert small["sizing_curve"][-1]["kwp"] < 100
        assert big["kwp"] > small["kwp"] * 20

    def test_energy_balance_holds(self):
        cons = _consumption("2018-11-01")
        r = recommend_system_size(cons, _uk_generation_profile())
        assert r["self_consumed_kwh"] + r["exported_kwh"] == pytest.approx(
            r["annual_generation_kwh"], rel=1e-3
        )

    def test_empty_consumption_is_rejected(self):
        cons = _consumption("2018-11-01", level=0.0)
        with pytest.raises(ValueError):
            recommend_system_size(cons, _uk_generation_profile())


class TestParser:
    def test_dates_come_from_the_file(self):
        dates = [
            (date(2018, 11, 1) + timedelta(days=i)).strftime("%d/%m/%Y")
            for i in range(365)
        ]
        body = pd.DataFrame(np.full((365, 48), 12.0))
        df, fmt, _ = load_and_normalise(_csv_bytes(body, dates), "hh.csv")

        assert fmt == "A"
        assert df.index[0] == pd.Timestamp("2018-11-01")
        assert df.index[-1] == pd.Timestamp("2019-10-31")

    def test_undated_rows_are_dropped(self):
        """Analyser templates carry stray pastes below the dated block."""
        dates = [
            (date(2018, 11, 1) + timedelta(days=i)).strftime("%d/%m/%Y")
            for i in range(365)
        ] + [""] * 20
        body = pd.DataFrame(
            np.vstack([np.full((365, 48), 12.0), np.full((20, 48), 999.0)])
        )
        df, _, warns = load_and_normalise(_csv_bytes(body, dates), "hh.csv")

        assert len(df) == 365
        assert df.values.max() == 12.0
        assert any("no date" in w for w in warns)

    def test_missing_dates_fall_back_with_a_warning(self):
        body = pd.DataFrame(np.full((365, 48), 12.0))
        df, _, warns = load_and_normalise(_csv_bytes(body), "hh.csv")

        assert len(df) == 365
        assert any("1 January" in w for w in warns)
