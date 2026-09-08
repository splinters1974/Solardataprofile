"""
The analyses the CBS HH Analyser workbook does, rebuilt on the parsed frame.

Everything works on the same (days x 48) DataFrame the rest of the app uses:
index is the calendar date, columns 0..47 are half-hour slots, values are kWh
per slot.

Demand is reported in kW throughout, because that is what the workbook shows
and what people mean when they talk about a site's load. A half-hourly
reading of X kWh is an average of 2X kW across that half hour.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from app.services.bank_holidays import holidays_between

KW_PER_KWH_PER_HH = 2.0

DOW_LABELS = ["Monday", "Tuesday", "Wednesday", "Thursday",
              "Friday", "Saturday", "Sunday"]

# Default night window. The source workbook used 00:30-07:00 and counted the
# midnight half hour as day, which splits the night block in two and looks
# like an off-by-one rather than a tariff definition. A contiguous
# 00:00-07:00 night is the sane default; the boundary is a parameter so a
# real tariff can be matched when one applies.
DEFAULT_NIGHT_START_SLOT = 0   # 00:00
DEFAULT_NIGHT_END_SLOT = 14    # 07:00, exclusive


def hh_labels() -> list[str]:
    return [f"{h:02d}:{m:02d}" for h in range(24) for m in (0, 30)]


def _slice(df: pd.DataFrame, date_from: str | None, date_to: str | None) -> pd.DataFrame:
    """Apply the date-range filter that every chart in the workbook has."""
    out = df
    if date_from:
        out = out[out.index >= pd.Timestamp(date_from)]
    if date_to:
        out = out[out.index <= pd.Timestamp(date_to)]
    return out


def _classify_days(index: pd.DatetimeIndex, exclude_holidays: bool) -> pd.Series:
    """Weekday / Weekend / Bank holiday for each date."""
    labels = pd.Series(
        np.where(index.dayofweek >= 5, "Weekend", "Weekday"), index=index
    )
    if exclude_holidays and len(index):
        holidays = holidays_between(index.min().date(), index.max().date())
        if holidays:
            is_holiday = pd.Series(
                [d.date() in holidays for d in index], index=index
            )
            labels[is_holiday] = "Bank holiday"
    return labels


def day_of_week_profile(
    df: pd.DataFrame,
    date_from: str | None = None,
    date_to: str | None = None,
    exclude_holidays: bool = True,
) -> dict:
    """
    Average kW for each half hour, by day of week, plus weekday, weekend
    and total averages. The workbook's headline chart.
    """
    window = _slice(df, date_from, date_to)
    if window.empty:
        return {"labels": hh_labels(), "series": [], "day_counts": {}}

    kw = window * KW_PER_KWH_PER_HH
    classes = _classify_days(window.index, exclude_holidays)

    series: list[dict] = []
    counts: dict[str, int] = {}

    for i, name in enumerate(DOW_LABELS):
        subset = kw[window.index.dayofweek == i]
        counts[name] = int(len(subset))
        if len(subset):
            series.append({
                "name": name,
                "group": "day",
                "values": [round(v, 2) for v in subset.mean(axis=0)],
            })

    for name in ("Weekday", "Weekend", "Bank holiday"):
        subset = kw[(classes == name).to_numpy()]
        counts[name] = int(len(subset))
        if len(subset):
            series.append({
                "name": name,
                "group": "summary",
                "values": [round(v, 2) for v in subset.mean(axis=0)],
            })

    counts["Total"] = int(len(kw))
    series.append({
        "name": "Total",
        "group": "summary",
        "values": [round(v, 2) for v in kw.mean(axis=0)],
    })

    return {"labels": hh_labels(), "series": series, "day_counts": counts}


def load_duration_curve(
    df: pd.DataFrame,
    date_from: str | None = None,
    date_to: str | None = None,
    points: int = 250,
) -> dict:
    """
    Load in kW against the hours per year at or above it.

    Sorting every half-hour reading descending gives the exact curve; the
    workbook approximated it with 20 frequency bins. Sampled down to a few
    hundred points so the payload stays small and the shape stays honest,
    with the extremes always kept because that is where the answer is.
    """
    window = _slice(df, date_from, date_to)
    values = window.to_numpy(dtype=float).ravel()
    values = values[~np.isnan(values)]
    if values.size == 0:
        return {"curve": [], "peak_kw": 0.0, "base_kw": 0.0,
                "average_kw": 0.0, "load_factor": 0.0, "hours_covered": 0.0}

    kw = np.sort(values * KW_PER_KWH_PER_HH)[::-1]
    total_hours = kw.size / 2.0  # each reading covers half an hour

    # Annualise so the x axis reads "hours per year" whatever the upload spans.
    scale = 8766.0 / total_hours if total_hours else 1.0

    if kw.size <= points:
        idx = np.arange(kw.size)
    else:
        idx = np.unique(
            np.concatenate([
                np.linspace(0, kw.size - 1, points).astype(int),
                [0, kw.size - 1],
            ])
        )

    # float(), not just round(): numpy scalars are not JSON serialisable and
    # would fail at the response boundary rather than here.
    curve = [
        {"hours": round(float(i + 1) / 2.0 * scale, 1),
         "kw": round(float(kw[i]), 2)}
        for i in idx
    ]

    peak = float(kw[0])
    average = float(kw.mean())
    return {
        "curve": curve,
        "peak_kw": round(peak, 2),
        "base_kw": round(float(kw[-1]), 2),
        "average_kw": round(average, 2),
        # Load factor: how much of the peak the site actually uses on average.
        # A low number means an expensive peak carried for a fraction of the year.
        "load_factor": round(average / peak, 4) if peak > 0 else 0.0,
        "hours_covered": round(total_hours, 1),
    }


def day_night_split(
    df: pd.DataFrame,
    date_from: str | None = None,
    date_to: str | None = None,
    night_start_slot: int = DEFAULT_NIGHT_START_SLOT,
    night_end_slot: int = DEFAULT_NIGHT_END_SLOT,
) -> dict:
    """
    Monthly kWh split into day and night.

    The night window wraps midnight when start > end, which is what a
    23:30-06:30 style tariff needs.
    """
    window = _slice(df, date_from, date_to)
    if window.empty:
        return {"months": [], "night_window": "", "totals": {}}

    slots = np.arange(48)
    if night_start_slot <= night_end_slot:
        night_mask = (slots >= night_start_slot) & (slots < night_end_slot)
    else:  # wraps midnight
        night_mask = (slots >= night_start_slot) | (slots < night_end_slot)

    night = window.loc[:, night_mask].sum(axis=1)
    day = window.loc[:, ~night_mask].sum(axis=1)

    monthly_night = night.resample("ME").sum()
    monthly_day = day.resample("ME").sum()
    days_per_month = window.index.to_series().resample("ME").count()

    months = []
    for period in monthly_day.index:
        # Partial months at either end distort a month-on-month comparison,
        # so flag them rather than quietly plotting a short bar.
        complete = bool(days_per_month[period] >= 26)
        months.append({
            "month": period.strftime("%b %Y"),
            "day_kwh": round(float(monthly_day[period]), 1),
            "night_kwh": round(float(monthly_night[period]), 1),
            "days": int(days_per_month[period]),
            "complete": complete,
        })

    labels = hh_labels()
    total_day = float(day.sum())
    total_night = float(night.sum())
    total = total_day + total_night

    return {
        "months": months,
        "night_window": f"{labels[night_start_slot]} to {labels[night_end_slot % 48]}",
        "totals": {
            "day_kwh": round(total_day, 1),
            "night_kwh": round(total_night, 1),
            "night_share": round(total_night / total, 4) if total else 0.0,
        },
    }


def week_profile(
    df: pd.DataFrame,
    week_commencing: str | None = None,
) -> dict:
    """Half-hourly kW for each day of one chosen week."""
    if df.empty:
        return {"labels": hh_labels(), "days": [], "week_commencing": None}

    if week_commencing:
        start = pd.Timestamp(week_commencing)
    else:
        start = df.index[0]
    start = start - pd.Timedelta(days=start.dayofweek)  # snap to Monday

    window = df[(df.index >= start) & (df.index < start + pd.Timedelta(days=7))]
    kw = window * KW_PER_KWH_PER_HH

    days = [
        {
            "date": ts.strftime("%Y-%m-%d"),
            "label": ts.strftime("%a %d %b"),
            "values": [round(v, 2) for v in row],
            "total_kwh": round(float(row.sum()) / KW_PER_KWH_PER_HH, 1),
        }
        for ts, row in kw.iterrows()
    ]

    return {
        "labels": hh_labels(),
        "days": days,
        "week_commencing": start.strftime("%Y-%m-%d"),
    }


def available_weeks(df: pd.DataFrame) -> list[dict]:
    """Every Monday the data covers, for the week picker."""
    if df.empty:
        return []
    mondays = pd.date_range(
        df.index[0] - pd.Timedelta(days=int(df.index[0].dayofweek)),
        df.index[-1],
        freq="W-MON",
    )
    return [
        {"value": d.strftime("%Y-%m-%d"), "label": d.strftime("%d %b %Y")}
        for d in mondays
    ]


def full_year_scatter(
    df: pd.DataFrame,
    exclude_holidays: bool = True,
    max_points: int = 6000,
) -> dict:
    """
    Every half-hourly reading as load against time of day, split weekday
    from weekend. Shows the spread behind the averages: how tight the
    weekday shape is, and how far the outliers sit from it.
    """
    if df.empty:
        return {"points": [], "sampled": False, "total_readings": 0}

    classes = _classify_days(df.index, exclude_holidays)
    kw = df.to_numpy(dtype=float) * KW_PER_KWH_PER_HH
    n_days, n_slots = kw.shape

    slot_hours = np.tile(np.arange(n_slots) / 2.0, n_days)
    values = kw.ravel()
    day_class = np.repeat(classes.to_numpy(), n_slots)
    dates = np.repeat(df.index.strftime("%Y-%m-%d").to_numpy(), n_slots)

    total = values.size
    sampled = total > max_points
    if sampled:
        # Deterministic thinning so the chart does not shuffle between runs.
        step = int(np.ceil(total / max_points))
        keep = np.arange(0, total, step)
        slot_hours, values = slot_hours[keep], values[keep]
        day_class, dates = day_class[keep], dates[keep]

    points = [
        {"hour": round(float(h), 2), "kw": round(float(v), 2),
         "type": str(c), "date": str(d)}
        for h, v, c, d in zip(slot_hours, values, day_class, dates)
    ]

    return {"points": points, "sampled": sampled, "total_readings": int(total)}


def summary_stats(df: pd.DataFrame) -> dict:
    """The numbers worth putting above the charts."""
    if df.empty:
        return {}

    kw = df.to_numpy(dtype=float) * KW_PER_KWH_PER_HH
    daily = df.sum(axis=1)
    peak_kw = float(kw.max())
    average_kw = float(kw.mean())

    peak_at = np.unravel_index(int(kw.argmax()), kw.shape)
    labels = hh_labels()

    return {
        "days": int(len(df)),
        "total_kwh": round(float(df.values.sum()), 1),
        "peak_kw": round(peak_kw, 2),
        "peak_when": (
            f"{df.index[peak_at[0]].strftime('%d %b %Y')} at {labels[peak_at[1]]}"
        ),
        "average_kw": round(average_kw, 2),
        "base_kw": round(float(kw.min()), 2),
        "load_factor": round(average_kw / peak_kw, 4) if peak_kw else 0.0,
        "highest_day_kwh": round(float(daily.max()), 1),
        "highest_day": daily.idxmax().strftime("%d %b %Y"),
        "lowest_day_kwh": round(float(daily.min()), 1),
        "lowest_day": daily.idxmin().strftime("%d %b %Y"),
        "average_day_kwh": round(float(daily.mean()), 1),
    }
