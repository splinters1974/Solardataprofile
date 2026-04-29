import pandas as pd


def hh_series(df: pd.DataFrame) -> list[dict]:
    """Return every half-hourly reading as {datetime, kwh} for granular charting."""
    result = []
    for date_ts, row in df.iterrows():
        date_str = date_ts.strftime("%Y-%m-%d")
        for slot in range(min(48, len(row))):
            hour = slot // 2
            minute = (slot % 2) * 30
            result.append({
                "datetime": f"{date_str}T{hour:02d}:{minute:02d}",
                "kwh": round(float(row.iloc[slot]), 3),
            })
    return result


def daily_series(df: pd.DataFrame) -> list[dict]:
    """Return daily kWh totals as list of {date, kwh} for line chart."""
    daily = df.sum(axis=1)
    return [
        {"date": ts.strftime("%Y-%m-%d"), "kwh": round(float(kwh), 2)}
        for ts, kwh in daily.items()
    ]


def monthly_totals(df: pd.DataFrame) -> list[dict]:
    """Sum HH kWh per calendar month. Returns list of {month, kwh}."""
    daily_totals = df.sum(axis=1)
    monthly = daily_totals.resample("ME").sum()
    return [
        {"month": ts.strftime("%Y-%m"), "kwh": round(float(kwh), 2)}
        for ts, kwh in monthly.items()
    ]


def heatmap_matrix(df: pd.DataFrame) -> dict:
    """
    Returns a 7×48 matrix: average kWh per half-hour slot by day-of-week.
    Rows = Mon(0)..Sun(6), Cols = HH slot 0..47.
    """
    df_copy = df.copy()
    df_copy["dow"] = df_copy.index.dayofweek  # 0=Mon, 6=Sun

    matrix = []
    for dow in range(7):
        subset = df_copy[df_copy["dow"] == dow].drop(columns="dow")
        if len(subset) == 0:
            matrix.append([0.0] * 48)
        else:
            row = subset.mean(axis=0).tolist()
            matrix.append([round(v, 4) for v in row])

    dow_labels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    hh_labels = [
        f"{h:02d}:{m:02d}"
        for h in range(24)
        for m in (0, 30)
    ]

    return {
        "dow_labels": dow_labels,
        "hh_labels": hh_labels,
        "matrix": matrix,
    }
