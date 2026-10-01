"""
Build test files and the Python backend's answers for them.

The standalone app re-implements the backend in TypeScript. This script is
the yardstick: it writes awkward-but-realistic HH files, runs the Python
engine over them, and saves what it got. tests/parity.test.ts then runs the
browser engine over the same files and checks it agrees.

Run from the repo root:  python frontend/tests/parity/generate.py
"""

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "backend"))

from app.services import hh_analytics as H  # noqa: E402
from app.services.excel_parser import load_and_normalise  # noqa: E402
from app.services.usage_analytics import heatmap_matrix, monthly_totals  # noqa: E402

OUT = Path(__file__).parent
rng = np.random.default_rng(7)


def site_load(dates: pd.DatetimeIndex) -> np.ndarray:
    """An office-ish site: weekday daytime load, base load overnight, seasonal swing."""
    slots = np.arange(48)
    rows = []
    for d in dates:
        working = d.dayofweek < 5
        season = 1.0 + 0.25 * np.cos((d.dayofyear - 15) / 365 * 2 * np.pi)
        shape = np.where((slots >= 15) & (slots < 37), 9.0 if working else 3.5, 2.2)
        rows.append(np.round(shape * season + rng.normal(0, 0.4, 48).clip(-1, 1), 3))
    return np.array(rows)


def write_workbook_a(path: Path) -> None:
    """Guide sheet first, title block, meter id + date columns, and some mess."""
    dates = pd.date_range("2023-03-15", periods=400, freq="D")
    load = site_load(dates)
    rows = [["Half hourly data", None], ["Site", "Example Leisure Centre"], [None]]
    header = ["MPAN", "Date"] + [f"{h:02d}:{m:02d}" for h in range(24) for m in (0, 30)]
    rows.append(header)
    for i, d in enumerate(dates):
        if i == 40:   # a missing day: leaves a gap
            continue
        values = list(load[i])
        if i == 100:
            values[5] = "n/a"   # a non-numeric reading
        rows.append([1200012345678, d.to_pydatetime()] + values)
        if i == 200:  # a pasted duplicate of the same day
            rows.append([1200012345678, d.to_pydatetime()] + list(load[i] * 3))
    rows.append([1200012345678, None] + [0.0] * 48)   # template padding
    with pd.ExcelWriter(path, engine="openpyxl") as xw:
        pd.DataFrame([["Paste your data on the next tab."], ["Nothing else here."]]).to_excel(
            xw, sheet_name="User Guide", header=False, index=False)
        pd.DataFrame(rows).to_excel(xw, sheet_name="HH Data", header=False, index=False)


def write_csv(path: Path) -> None:
    """Semicolon separated, UK day-first date strings, one header row."""
    dates = pd.date_range("2024-01-01", periods=366, freq="D")
    load = site_load(dates)
    lines = ["Date;" + ";".join(f"HH{i + 1}" for i in range(48))]
    for d, row in zip(dates, load):
        lines.append(d.strftime("%d/%m/%Y") + ";" + ";".join(f"{v:.3f}" for v in row))
    path.write_text("\n".join(lines) + "\n")


def write_workbook_b(path: Path) -> None:
    """Transposed: one row per half hour, one column per day, dates across the top."""
    dates = pd.date_range("2024-04-01", periods=365, freq="D")
    load = site_load(dates)
    rows = [["Time"] + [d.strftime("%Y-%m-%d") for d in dates]]
    for s in range(48):
        rows.append([f"{s // 2:02d}:{(s % 2) * 30:02d}"] + list(load[:, s]))
    with pd.ExcelWriter(path, engine="openpyxl") as xw:
        pd.DataFrame(rows).to_excel(xw, sheet_name="Data", header=False, index=False)


def expected_for(path: Path) -> dict:
    df, fmt, warnings = load_and_normalise(path.read_bytes(), filename=path.name)
    first, last = df.index[0].strftime("%Y-%m-%d"), df.index[-1].strftime("%Y-%m-%d")
    mid = df.index[len(df) // 3].strftime("%Y-%m-%d")
    late = df.index[2 * len(df) // 3].strftime("%Y-%m-%d")
    weeks = H.available_weeks(df)
    scatter = H.full_year_scatter(df, True)
    return {
        "format": fmt,
        "warnings": warnings,
        "dates": [d.strftime("%Y-%m-%d") for d in df.index],
        "row_sums": [round(float(v), 6) for v in df.sum(axis=1)],
        "monthly_totals": monthly_totals(df),
        "heatmap": heatmap_matrix(df)["matrix"],
        "summary": H.summary_stats(df),
        "weeks": weeks,
        "profile": H.day_of_week_profile(df, mid, late, True),
        "profile_all_no_holidays": H.day_of_week_profile(df, None, None, False),
        "ldc": H.load_duration_curve(df, None, None),
        "ldc_window": H.load_duration_curve(df, mid, late),
        "day_night": H.day_night_split(df, None, None, 0, 14),
        "day_night_wrap": H.day_night_split(df, first, last, 46, 13),
        "week": H.week_profile(df, weeks[3]["value"]),
        "scatter": {
            "count": len(scatter["points"]),
            "sampled": scatter["sampled"],
            "total_readings": scatter["total_readings"],
            "first": scatter["points"][:5],
            "holidays": sum(1 for p in scatter["points"] if p["type"] == "Bank holiday"),
        },
        "scatter_print": len(H.full_year_scatter(df, True, max_points=2400)["points"]),
    }


def main() -> None:
    write_workbook_a(OUT / "workbook_a.xlsx")
    write_csv(OUT / "semicolon.csv")
    write_workbook_b(OUT / "transposed_b.xlsx")

    expected = {
        name: expected_for(OUT / name)
        for name in ("workbook_a.xlsx", "semicolon.csv")
    }
    (OUT / "expected.json").write_text(json.dumps(expected, default=float))
    print("wrote fixtures and expected.json")


if __name__ == "__main__":
    main()
