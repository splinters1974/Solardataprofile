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
        import_price_inflation=0.0,
        export_price_inflation=0.0,
        opex_inflation=0.0,
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

    def test_capex_rate_falls_through_the_size_bands(self):
        house = Assumptions()
        assert house.capex_rate(100.0) == 1000.0
        assert house.capex_rate(300.0) == 900.0
        assert house.capex_rate(750.0) == 800.0
        assert house.capex_rate(1500.0) == 700.0
        assert house.capex_rate(3000.0) == 600.0

    def test_a_bigger_array_never_costs_less_in_total(self):
        """
        Read naively the bands have cliffs: 200 kWp at £1,000 is £200,000 and
        201 kWp at £900 is £180,900, so the client pays less for more. The
        total is clamped non-decreasing to kill that, which also stops the
        sizing search chasing the cliff instead of a real saving.
        """
        house = Assumptions()
        sizes = [round(0.5 * i, 1) for i in range(1, 6001)]
        totals = [house.capex_total(k) for k in sizes]
        assert totals == sorted(totals)

        # Cost holds flat across a boundary until the cheaper rate catches up.
        assert house.capex_total(201.0) == house.capex_total(200.0) == 200_000.0
        assert house.capex_total(230.0) == pytest.approx(207_000.0)

    def test_capex_can_be_overridden_with_one_flat_rate(self):
        fixed = Assumptions(capex_per_kwp=777.0)
        assert fixed.capex_rate(5.0) == 777.0
        assert fixed.capex_rate(5000.0) == 777.0

    def test_import_and_opex_escalate_on_their_own_rates(self):
        """
        The avoided energy price and the cost of running the array are
        unrelated, so one inflation figure for both would be wrong.
        """
        a = Assumptions(
            import_price_p_kwh=25.0, export_price_p_kwh=0.0,
            capex_per_kwp=800.0, opex_per_kwp_year=10.0,
            import_price_inflation=0.02, opex_inflation=0.03,
            degradation_rate=0.0, discount_rate=0.0, system_life_years=25,
        )
        result = appraise(100.0, 100_000.0, 0.0, a)

        # Year 1: 100,000 kWh x 25p = £25,000, less £1,000 O&M.
        assert result.cashflow[1] == pytest.approx(24_000, abs=1)
        # Year 2: saving up 2%, O&M up 3%.
        assert result.cashflow[2] == pytest.approx(
            25_000 * 1.02 - 1_000 * 1.03, abs=1
        )

    def test_savings_grow_year_on_year(self):
        a = Assumptions(export_price_p_kwh=0.0, degradation_rate=0.0)
        flows = appraise(100.0, 100_000.0, 0.0, a).cashflow[1:]
        assert flows == sorted(flows)

    def test_everything_on_site_avoids_import_and_the_rest_exports(self):
        a = Assumptions(import_price_p_kwh=25.0, export_price_p_kwh=5.0,
                        opex_per_kwp_year=0.0)
        result = appraise(100.0, 80_000.0, 20_000.0, a)
        assert result.year_one_import_saving == pytest.approx(20_000)  # 80k x 25p
        assert result.year_one_export_income == pytest.approx(1_000)   # 20k x 5p

    def test_carbon_scales_with_total_generation(self):
        result = appraise(100.0, 60_000.0, 40_000.0, Assumptions(carbon_factor=0.2))
        assert result.carbon_saved_tonnes_year == pytest.approx(20.0)


class TestEconomicSelection:
    def test_recommendation_respects_both_constraints(self):
        cons = _consumption("2018-11-01", level=60.0)
        r = recommend_system_size(cons, _uk_generation_profile(),
                                  max_payback_years=8.0, min_sc_rate=0.50)
        assert r["simple_payback_years"] is not None
        assert r["simple_payback_years"] <= 8.0
        assert r["sc_rate"] >= 0.50

    def test_recommendation_is_the_largest_array_that_clears_the_hurdle(self):
        cons = _consumption("2018-11-01", level=60.0)
        r = recommend_system_size(cons, _uk_generation_profile(),
                                  max_payback_years=8.0, min_sc_rate=0.50)
        eligible = [
            p for p in r["sizing_curve"]
            if p["sc_rate"] >= 0.50
            and p["simple_payback_years"] is not None
            and p["simple_payback_years"] <= 8.0
        ]
        assert r["kwp"] == max(p["kwp"] for p in eligible)

    def test_a_looser_hurdle_buys_a_bigger_array(self):
        """
        The whole point of the rule: relax what the business case must clear
        and the tool covers more of the site's demand.

        Run on a cheap tariff so the payback hurdle is the binding constraint.
        At 25p the array pays back inside eight years across almost the whole
        curve, and the self-consumption floor sets the answer instead.
        """
        cons = _consumption("2018-11-01", level=60.0)
        gen = _uk_generation_profile()
        lean = Assumptions(import_price_p_kwh=12.0)
        tight = recommend_system_size(
            cons, gen, max_payback_years=10.0, assumptions=lean)
        loose = recommend_system_size(
            cons, gen, max_payback_years=12.0, assumptions=lean)

        assert loose["kwp"] > tight["kwp"]
        assert loose["self_consumed_kwh"] > tight["self_consumed_kwh"]
        assert loose["sc_rate"] < tight["sc_rate"]

    def test_the_self_consumption_floor_binds_when_payback_does_not(self):
        """
        At a 25p import price solar clears an eight year payback across a very
        wide range of sizes, so the hurdle alone would let the tool recommend a
        mostly-exporting array. The floor is what stops that, and raising it
        pulls the recommendation back.
        """
        cons = _consumption("2018-11-01", level=60.0)
        gen = _uk_generation_profile()
        sizes = [
            recommend_system_size(cons, gen, min_sc_rate=f)["kwp"]
            for f in (0.4, 0.5, 0.6, 0.7, 0.8)
        ]
        assert sizes == sorted(sizes, reverse=True)

    def test_an_unreachable_hurdle_is_reported_not_hidden(self):
        cons = _consumption("2018-11-01", level=60.0)
        r = recommend_system_size(cons, _uk_generation_profile(),
                                  max_payback_years=0.5)
        assert r["warning"] is not None
        assert "0.5 years" in r["warning"]

    def test_the_old_rule_would_have_picked_the_smallest_array(self):
        """
        Guards the reason this rule changed. Payback worsens monotonically
        with size, so "shortest payback in a band" always returned the small
        end of that band. Anything that reintroduces a payback-minimising
        selection will show up here.
        """
        cons = _consumption("2018-11-01", level=60.0)
        r = recommend_system_size(cons, _uk_generation_profile(),
                                  max_payback_years=8.0, min_sc_rate=0.50)
        eligible = [
            p for p in r["sizing_curve"]
            if p["sc_rate"] >= 0.50 and p["simple_payback_years"] is not None
            and p["simple_payback_years"] <= 8.0
        ]
        fastest = min(p["simple_payback_years"] for p in eligible)
        assert r["simple_payback_years"] > fastest

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

    def test_the_alternative_is_the_faster_smaller_option(self):
        cons = _consumption("2018-11-01", level=60.0)
        r = recommend_system_size(cons, _uk_generation_profile())
        alt = r["alternative_best_payback"]
        if alt:
            assert alt["kwp"] <= r["kwp"]
            assert alt["simple_payback_years"] <= r["simple_payback_years"]
            assert alt["self_consumed_kwh"] <= r["self_consumed_kwh"]

    def test_a_small_site_gets_a_small_array(self):
        """
        Regression: the search used to start at 0.5 kWp whatever the site.
        A 900 kWh/year flat load exports most of a 0.5 kWp array at midday,
        so no candidate reached the target and the tool answered "0.5 kWp,
        could not reach 80%" when the real answer was a fraction of that.
        """
        cons = _consumption("2024-01-01", level=0.05)  # ~876 kWh/year
        r = recommend_system_size(cons, _uk_generation_profile())

        assert r["kwp"] > 0
        # The grid has to resolve below the old 0.5 kWp floor to find this.
        assert r["sizing_curve"][0]["kwp"] < 0.1

    def test_the_answer_scales_with_the_load(self):
        """A site ten times bigger wants an array ten times bigger."""
        gen = _uk_generation_profile()
        small = recommend_system_size(_consumption("2024-01-01", level=1.0), gen)
        large = recommend_system_size(_consumption("2024-01-01", level=10.0), gen)

        assert large["kwp"] == pytest.approx(small["kwp"] * 10, rel=0.15)
        assert large["sc_rate"] == pytest.approx(small["sc_rate"], abs=0.05)

    @pytest.mark.parametrize("level", [0.01, 0.05, 0.5, 5.0, 50.0, 500.0])
    def test_a_flat_load_is_sizeable_at_every_scale(self, level):
        """Flat profiles are the simplest input anyone will test with."""
        cons = _consumption("2024-01-01", level=level)
        r = recommend_system_size(cons, _uk_generation_profile())

        assert r["kwp"] > 0
        assert r["sc_rate"] >= 0.50
        assert r["simple_payback_years"] is not None

    def test_the_search_starts_well_below_the_full_offset_size(self):
        cons = _consumption("2024-01-01", level=1.0)
        gen = _uk_generation_profile()
        curve = recommend_system_size(cons, gen)["sizing_curve"]

        full_offset = cons.values.sum() / gen.values.sum()
        assert curve[0]["kwp"] < full_offset * 0.1
        assert curve[0]["sc_rate"] > 0.98  # a tiny array is fully absorbed
        assert len(set(p["kwp"] for p in curve)) == len(curve)  # no collisions

    def test_a_nonsense_hurdle_is_rejected(self):
        with pytest.raises(ValueError):
            recommend_system_size(
                _consumption("2018-11-01"), _uk_generation_profile(),
                max_payback_years=0,
            )

    def test_yield_per_kwp_is_reported(self):
        """
        Everything downstream is a multiple of this, so it has to be visible
        rather than buried inside the generation total.
        """
        cons = _consumption("2018-11-01", level=60.0)
        gen = _uk_generation_profile()
        r = recommend_system_size(cons, gen)
        assert r["annual_yield_kwh_per_kwp"] == pytest.approx(
            gen.values.sum(), rel=0.02
        )


class TestYieldSanity:
    def test_a_believable_uk_yield_passes_quietly(self):
        from app.services.pvgis_client import yield_sanity_warning
        assert yield_sanity_warning(_uk_generation_profile(), 35, 0) is None

    def test_a_yield_well_below_the_uk_range_is_flagged(self):
        """The failure mode this exists for: a live feed quietly 35% out."""
        from app.services.pvgis_client import yield_sanity_warning
        thin = _uk_generation_profile() * 0.6
        warning = yield_sanity_warning(thin, 35, 0)
        assert warning is not None
        assert "below" in warning

    def test_an_oddly_oriented_roof_is_left_alone(self):
        """A north wall really does yield a few hundred. Not an alarm."""
        from app.services.pvgis_client import yield_sanity_warning
        thin = _uk_generation_profile() * 0.4
        assert yield_sanity_warning(thin, 90, 180) is None


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
