import numpy as np
import pandas as pd
import pytest

from app.services.economics import Assumptions, appraise
from app.services.solar_sizing import recommend_system_size

from test_parser_and_sizing import _consumption, _uk_generation_profile


def _flat() -> Assumptions:
    """No inflation, no degradation, no discounting: hand-checkable maths."""
    return Assumptions(
        import_price_p_kwh=20.0,
        export_price_p_kwh=0.0,
        capex_per_kwp=1000.0,
        opex_per_kwp_year=0.0,
        price_inflation=0.0,
        discount_rate=0.0,
        degradation_rate=0.0,
        system_life_years=25,
    )


class TestAppraisal:
    def test_simple_payback_is_capex_over_saving(self):
        # 100 kWp at £1,000/kWp = £100,000. 100,000 kWh at 20p = £20,000/yr.
        result = appraise(100.0, 100_000.0, 0.0, _flat())
        assert result.capex == 100_000
        assert result.year_one_saving == 20_000
        assert result.simple_payback_years == pytest.approx(5.0, abs=0.05)

    def test_export_earns_less_than_displaced_import(self):
        cheap_export = Assumptions(
            import_price_p_kwh=25.0, export_price_p_kwh=5.0,
            capex_per_kwp=800.0, opex_per_kwp_year=0.0,
        )
        used = appraise(100.0, 100_000.0, 0.0, cheap_export)
        dumped = appraise(100.0, 0.0, 100_000.0, cheap_export)
        assert used.year_one_saving == pytest.approx(dumped.year_one_saving * 5)

    def test_npv_equals_undiscounted_total_at_zero_rate(self):
        result = appraise(100.0, 100_000.0, 0.0, _flat())
        assert result.npv == pytest.approx(-100_000 + 25 * 20_000, rel=1e-6)

    def test_irr_recovers_a_known_rate(self):
        result = appraise(100.0, 100_000.0, 0.0, _flat())
        assert result.irr == pytest.approx(0.1987, abs=0.005)

    def test_a_project_that_never_pays_back_says_so(self):
        hopeless = Assumptions(
            import_price_p_kwh=0.1, export_price_p_kwh=0.0,
            capex_per_kwp=5000.0, opex_per_kwp_year=0.0,
        )
        result = appraise(100.0, 1_000.0, 0.0, hopeless)
        assert result.simple_payback_years is None
        assert result.irr is None
        assert result.npv < 0

    def test_capex_per_kwp_falls_with_scale(self):
        tiered = Assumptions()
        assert tiered.capex_rate(5.0) > tiered.capex_rate(500.0)
        assert tiered.capex_rate(500.0) > tiered.capex_rate(5000.0)

    def test_explicit_capex_overrides_the_curve(self):
        fixed = Assumptions(capex_per_kwp=777.0)
        assert fixed.capex_rate(5.0) == 777.0
        assert fixed.capex_rate(5000.0) == 777.0

    def test_carbon_scales_with_total_generation(self):
        result = appraise(100.0, 60_000.0, 40_000.0, Assumptions(carbon_factor=0.2))
        assert result.carbon_saved_tonnes_year == pytest.approx(20.0)


class TestEconomicSelection:
    def test_recommendation_lands_inside_the_band(self):
        cons = _consumption("2018-11-01", level=60.0)
        r = recommend_system_size(cons, _uk_generation_profile(),
                                  target_sc_min=0.70, target_sc_max=0.90)
        assert 0.70 <= r["sc_rate"] <= 0.90

    def test_recommendation_has_the_best_payback_in_the_band(self):
        cons = _consumption("2018-11-01", level=60.0)
        r = recommend_system_size(cons, _uk_generation_profile(),
                                  target_sc_min=0.70, target_sc_max=0.90)
        in_band = [
            p for p in r["sizing_curve"]
            if 0.70 <= p["sc_rate"] <= 0.90
            and p["simple_payback_years"] is not None
        ]
        best = min(p["simple_payback_years"] for p in in_band)
        assert r["simple_payback_years"] == best

    def test_worthless_export_pushes_the_array_smaller(self):
        cons = _consumption("2018-11-01", level=60.0)
        gen = _uk_generation_profile()
        paid = recommend_system_size(
            cons, gen, assumptions=Assumptions(export_price_p_kwh=15.0))
        unpaid = recommend_system_size(
            cons, gen, assumptions=Assumptions(export_price_p_kwh=0.0))
        assert unpaid["kwp"] <= paid["kwp"]

    def test_a_part_year_upload_is_annualised(self):
        """Six months of data must not halve the reported annual saving."""
        gen = _uk_generation_profile()
        full = recommend_system_size(_consumption("2018-01-01", days=365), gen)
        half = recommend_system_size(_consumption("2018-01-01", days=182), gen)
        assert half["annual_consumption_kwh"] == pytest.approx(
            full["annual_consumption_kwh"], rel=0.02
        )

    def test_alternative_is_never_smaller_than_the_recommendation(self):
        cons = _consumption("2018-11-01", level=60.0)
        r = recommend_system_size(cons, _uk_generation_profile())
        alt = r["alternative_max_onsite"]
        if alt:
            assert alt["kwp"] >= r["kwp"]
            assert alt["self_consumed_kwh"] >= r["self_consumed_kwh"]

    def test_inverted_band_is_rejected(self):
        with pytest.raises(ValueError):
            recommend_system_size(
                _consumption("2018-11-01"), _uk_generation_profile(),
                target_sc_min=0.9, target_sc_max=0.5,
            )


class TestReport:
    def test_pdf_is_produced_for_a_real_result(self):
        from app.services.pdf_report import build_report

        cons = _consumption("2018-11-01", level=60.0)
        assumptions = Assumptions()
        r = recommend_system_size(cons, _uk_generation_profile(),
                                  assumptions=assumptions)
        pdf = build_report(
            site_name="Test Leisure Centre", postcode="LA9 6PT",
            date_from="01 Nov 2018", date_to="01 Nov 2019",
            days_analysed=r["days_analysed"], result=r,
            assumptions=assumptions, tilt=35, aspect=0,
            data_warnings=["Example warning."],
        )
        assert pdf.startswith(b"%PDF")
        assert len(pdf) > 5_000
