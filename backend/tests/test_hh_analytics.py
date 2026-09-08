"""
The Ameresco HH Analyser analyses, checked against hand-computable inputs
and against the numbers the source workbook produces.
"""

from datetime import date, timedelta

import numpy as np
import pandas as pd
import pytest

from app.services import hh_analytics as A
from app.services.bank_holidays import easter_sunday, holidays_for_year


def _frame(start: str, days: int, shape=None, level: float = 10.0) -> pd.DataFrame:
    idx = pd.DatetimeIndex(
        [pd.Timestamp(start) + timedelta(days=i) for i in range(days)]
    ).astype("datetime64[ns]")
    row = shape if shape is not None else np.full(48, level)
    return pd.DataFrame(np.tile(row, (days, 1)), index=idx, columns=range(48))


class TestBankHolidays:
    @pytest.mark.parametrize("year,expected", [
        (2024, date(2024, 3, 31)),
        (2025, date(2025, 4, 20)),
        (2026, date(2026, 4, 5)),
    ])
    def test_easter_is_correct(self, year, expected):
        assert easter_sunday(year) == expected

    def test_a_normal_year_has_eight(self):
        assert len(holidays_for_year(2026)) == 8

    def test_christmas_on_a_weekend_moves_to_weekdays(self):
        """2027: Christmas is a Saturday, Boxing Day a Sunday."""
        holidays = holidays_for_year(2027)
        assert date(2027, 12, 27) in holidays
        assert date(2027, 12, 28) in holidays
        assert date(2027, 12, 25) not in holidays

    def test_boxing_day_never_collides_with_christmas(self):
        for year in range(2020, 2041):
            december = [d for d in holidays_for_year(year) if d.month == 12]
            assert len(december) == len(set(december)) == 2

    def test_no_holiday_ever_lands_on_a_weekend(self):
        """Except the one-off royal dates, which are deliberate."""
        one_offs = {date(2011, 4, 29), date(2012, 6, 5),
                    date(2022, 6, 3), date(2022, 9, 19), date(2023, 5, 8)}
        for year in range(2015, 2036):
            for day in holidays_for_year(year):
                if day not in one_offs:
                    assert day.weekday() < 5, f"{day} is a weekend"

    def test_the_calendar_does_not_stop_in_2015(self):
        """The workbook's hard-coded table did, so recent data lost them."""
        assert len(holidays_for_year(2030)) == 8


class TestDayOfWeekProfile:
    def test_kw_is_double_the_half_hourly_kwh(self):
        result = A.day_of_week_profile(_frame("2024-01-01", 28, level=5.0))
        total = next(s for s in result["series"] if s["name"] == "Total")
        assert total["values"][0] == pytest.approx(10.0)

    def test_every_weekday_is_counted_once_per_week(self):
        result = A.day_of_week_profile(_frame("2024-01-01", 28))
        for day in A.DOW_LABELS:
            assert result["day_counts"][day] == 4

    def test_weekend_and_weekday_split_correctly(self):
        result = A.day_of_week_profile(_frame("2024-01-01", 28),
                                       exclude_holidays=False)
        assert result["day_counts"]["Weekday"] == 20
        assert result["day_counts"]["Weekend"] == 8

    def test_bank_holidays_come_out_of_the_weekday_average(self):
        """A closed bank holiday must not drag the weekday profile down."""
        frame = _frame("2024-01-01", 28)
        with_holidays = A.day_of_week_profile(frame, exclude_holidays=True)
        without = A.day_of_week_profile(frame, exclude_holidays=False)

        assert with_holidays["day_counts"]["Bank holiday"] == 1  # 1 Jan
        assert with_holidays["day_counts"]["Weekday"] == 19
        assert without["day_counts"]["Weekday"] == 20

    def test_a_date_filter_narrows_the_window(self):
        frame = _frame("2024-01-01", 90)
        result = A.day_of_week_profile(frame, "2024-02-01", "2024-02-29")
        assert result["day_counts"]["Total"] == 29

    def test_an_empty_window_returns_no_series(self):
        result = A.day_of_week_profile(_frame("2024-01-01", 30),
                                       "2025-01-01", "2025-02-01")
        assert result["series"] == []


class TestLoadDurationCurve:
    def test_a_flat_load_is_a_flat_line(self):
        result = A.load_duration_curve(_frame("2024-01-01", 365, level=10.0))
        assert result["peak_kw"] == pytest.approx(20.0)
        assert result["base_kw"] == pytest.approx(20.0)
        assert result["load_factor"] == pytest.approx(1.0)

    def test_load_factor_is_average_over_peak(self):
        shape = np.array([20.0 if s < 24 else 0.0 for s in range(48)])
        result = A.load_duration_curve(_frame("2024-01-01", 365, shape=shape))
        assert result["peak_kw"] == pytest.approx(40.0)
        assert result["load_factor"] == pytest.approx(0.5)

    def test_the_curve_descends(self):
        rng = np.random.default_rng(3)
        frame = pd.DataFrame(
            rng.uniform(1, 50, (365, 48)),
            index=pd.date_range("2024-01-01", periods=365), columns=range(48),
        )
        kws = [p["kw"] for p in A.load_duration_curve(frame)["curve"]]
        assert kws == sorted(kws, reverse=True)

    def test_hours_are_annualised(self):
        """Half a year of data must still read as an 8,766-hour axis."""
        result = A.load_duration_curve(_frame("2024-01-01", 182))
        assert result["curve"][-1]["hours"] == pytest.approx(8766, rel=0.01)

    def test_the_extremes_are_always_kept(self):
        frame = _frame("2024-01-01", 365)
        frame.iloc[100, 20] = 999.0  # a single spike
        result = A.load_duration_curve(frame)
        assert result["peak_kw"] == pytest.approx(1998.0)
        assert result["curve"][0]["kw"] == pytest.approx(1998.0)

    def test_json_safe_types(self):
        """numpy scalars would blow up at the response boundary."""
        for point in A.load_duration_curve(_frame("2024-01-01", 30))["curve"]:
            assert type(point["hours"]) is float
            assert type(point["kw"]) is float


class TestDayNightSplit:
    def test_the_default_night_is_midnight_to_seven(self):
        result = A.day_night_split(_frame("2024-01-01", 365, level=1.0))
        assert result["night_window"] == "00:00 to 07:00"
        # 14 of 48 slots are night on a flat load (shares round to 4dp).
        assert result["totals"]["night_share"] == pytest.approx(14 / 48, abs=1e-4)

    def test_day_and_night_always_sum_to_the_total(self):
        frame = _frame("2024-01-01", 90, level=3.0)
        totals = A.day_night_split(frame)["totals"]
        assert totals["day_kwh"] + totals["night_kwh"] == pytest.approx(
            frame.values.sum()
        )

    def test_a_night_window_can_wrap_midnight(self):
        """A 23:30-06:30 tariff is two blocks either side of midnight."""
        result = A.day_night_split(
            _frame("2024-01-01", 365, level=1.0),
            night_start_slot=47, night_end_slot=13,
        )
        assert result["totals"]["night_share"] == pytest.approx(14 / 48, abs=1e-4)

    def test_partial_months_are_flagged_not_hidden(self):
        result = A.day_night_split(_frame("2024-01-20", 40))
        assert any(not m["complete"] for m in result["months"])

    def test_moving_the_boundary_moves_the_split(self):
        frame = _frame("2024-01-01", 365, level=1.0)
        early = A.day_night_split(frame, night_end_slot=12)
        late = A.day_night_split(frame, night_end_slot=16)
        assert late["totals"]["night_kwh"] > early["totals"]["night_kwh"]


class TestWeekProfile:
    def test_a_week_snaps_back_to_monday(self):
        # 2024-01-03 is a Wednesday.
        result = A.week_profile(_frame("2024-01-01", 30), "2024-01-03")
        assert result["week_commencing"] == "2024-01-01"
        assert len(result["days"]) == 7

    def test_days_report_kw_and_daily_kwh(self):
        result = A.week_profile(_frame("2024-01-01", 30, level=2.0))
        day = result["days"][0]
        assert day["values"][0] == pytest.approx(4.0)      # kW
        assert day["total_kwh"] == pytest.approx(96.0)     # 48 x 2 kWh

    def test_a_short_week_at_the_end_is_allowed(self):
        result = A.week_profile(_frame("2024-01-01", 10), "2024-01-08")
        assert len(result["days"]) == 3

    def test_every_monday_is_offered(self):
        weeks = A.available_weeks(_frame("2024-01-01", 365))
        assert len(weeks) >= 52
        assert weeks[0]["value"] == "2024-01-01"


class TestScatter:
    def test_points_carry_hour_load_and_type(self):
        result = A.full_year_scatter(_frame("2024-01-06", 2))  # Sat + Sun
        assert result["sampled"] is False
        assert {p["type"] for p in result["points"]} == {"Weekend"}
        assert result["points"][0]["hour"] == 0.0
        assert result["points"][2]["hour"] == 1.0

    def test_thinning_keeps_every_time_of_day(self):
        """
        Regression: thinning used to stride the flattened readings, which
        steps through a 48-wide cycle. Any stride sharing a factor with 48
        landed on the same half hours every day, so a year of data collapsed
        into a few vertical bands instead of a cloud. Thin by day instead.
        """
        result = A.full_year_scatter(_frame("2024-01-01", 366), max_points=6000)
        assert result["sampled"] is True
        assert len({p["hour"] for p in result["points"]}) == 48

    @pytest.mark.parametrize("cap", [500, 1200, 2400, 6000, 9000])
    def test_every_time_of_day_survives_at_any_density(self, cap):
        result = A.full_year_scatter(_frame("2024-01-01", 366), max_points=cap)
        assert len({p["hour"] for p in result["points"]}) == 48

    def test_a_kept_day_keeps_all_of_its_readings(self):
        result = A.full_year_scatter(_frame("2024-01-01", 366), max_points=2400)
        by_date: dict[str, int] = {}
        for p in result["points"]:
            by_date[p["date"]] = by_date.get(p["date"], 0) + 1
        assert set(by_date.values()) == {48}

    def test_bank_holidays_survive_thinning(self):
        """Eight days in a year: an even sample would usually lose them all."""
        result = A.full_year_scatter(_frame("2024-01-01", 366), max_points=1200)
        holidays = {p["date"] for p in result["points"]
                    if p["type"] == "Bank holiday"}
        assert len(holidays) >= 6

    def test_large_uploads_are_thinned_deterministically(self):
        frame = _frame("2024-01-01", 365)
        first = A.full_year_scatter(frame)
        second = A.full_year_scatter(frame)
        assert first["sampled"] is True
        assert len(first["points"]) <= 9000
        assert first["points"] == second["points"]

    def test_the_total_reported_is_the_unsampled_count(self):
        result = A.full_year_scatter(_frame("2024-01-01", 365))
        assert result["total_readings"] == 365 * 48


class TestSummaryStats:
    def test_peak_is_located_in_time(self):
        frame = _frame("2024-01-01", 30, level=1.0)
        frame.iloc[10, 20] = 100.0
        stats = A.summary_stats(frame)
        assert stats["peak_kw"] == pytest.approx(200.0)
        assert stats["peak_when"] == "11 Jan 2024 at 10:00"

    def test_highest_and_lowest_days_are_named(self):
        frame = _frame("2024-01-01", 30, level=1.0)
        frame.iloc[5] = 9.0
        frame.iloc[7] = 0.1
        stats = A.summary_stats(frame)
        assert stats["highest_day"] == "06 Jan 2024"
        assert stats["lowest_day"] == "08 Jan 2024"

    def test_an_empty_frame_is_not_an_error(self):
        empty = pd.DataFrame(columns=range(48), index=pd.DatetimeIndex([]))
        assert A.summary_stats(empty) == {}


class TestAgainstTheWorkbook:
    """
    The source workbook computes an average kW demand table on the Calcs
    tab. These are its own numbers for the CBS test file, so the rebuild
    has to reproduce them rather than merely look plausible.
    """

    def test_monday_midnight_matches_the_spreadsheet(self):
        rows = 4
        frame = _frame("2024-01-01", 7 * rows, level=44.819423076923075)
        result = A.day_of_week_profile(frame, exclude_holidays=False)
        monday = next(s for s in result["series"] if s["name"] == "Monday")
        # Calcs!D7 for the CBS file is 89.63884615384615 kW.
        assert monday["values"][0] == pytest.approx(89.64, abs=0.01)
