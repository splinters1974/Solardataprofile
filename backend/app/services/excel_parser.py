import re
import io
import warnings
from datetime import date, timedelta

import numpy as np
import pandas as pd


def _count_time_strings(series: pd.Series) -> int:
    pattern = re.compile(r"^\d{1,2}:\d{2}$|^HH\s*\d{1,2}$", re.IGNORECASE)
    return sum(1 for v in series.dropna() if pattern.match(str(v).strip()))


def _strip_headers(raw: pd.DataFrame) -> pd.DataFrame:
    """Drop leading rows/cols that are entirely non-numeric."""
    df = raw.copy()
    # Drop rows where fewer than 10% of cells are numeric
    for i in range(min(5, len(df))):
        numeric_count = pd.to_numeric(df.iloc[0], errors="coerce").notna().sum()
        if numeric_count < 0.1 * len(df.columns):
            df = df.iloc[1:].reset_index(drop=True)
        else:
            break
    # Drop columns where fewer than 10% of cells are numeric
    for _ in range(min(5, len(df.columns))):
        numeric_count = pd.to_numeric(df.iloc[:, 0], errors="coerce").notna().sum()
        if numeric_count < 0.1 * len(df):
            df = df.iloc[:, 1:].reset_index(drop=True)
        else:
            break
    return df


def _detect_format(raw: pd.DataFrame) -> str:
    body = _strip_headers(raw)
    nrows, ncols = body.shape

    if abs(nrows - 365) <= 15 and abs(ncols - 48) <= 4:
        return "A"
    if abs(nrows - 48) <= 4 and abs(ncols - 365) <= 15:
        return "B"
    if abs(nrows - 366) <= 2 and abs(ncols - 48) <= 4:
        return "A"
    if abs(nrows - 48) <= 4 and abs(ncols - 366) <= 2:
        return "B"

    # Tiebreak via time-string detection
    first_col_times = _count_time_strings(raw.iloc[:, 0])
    first_row_times = _count_time_strings(raw.iloc[0])
    return "B" if first_col_times > first_row_times else "A"


def _to_numeric_body(raw: pd.DataFrame) -> tuple[pd.DataFrame, list[str]]:
    warn_msgs: list[str] = []
    body = _strip_headers(raw)

    numeric = body.apply(pd.to_numeric, errors="coerce")
    n_bad = numeric.isna().sum().sum()
    if n_bad > 0:
        warn_msgs.append(f"{n_bad} non-numeric cells filled with 0.")
    numeric = numeric.fillna(0.0)
    return numeric, warn_msgs


def load_and_normalise(
    file_bytes: bytes,
) -> tuple[pd.DataFrame, str, list[str]]:
    """
    Returns:
        df:        DataFrame shape (N_days, 48), DatetimeIndex, columns 0..47
        fmt:       detected format "A" or "B"
        warnings:  list of warning strings
    """
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        raw = pd.read_excel(io.BytesIO(file_bytes), header=None, engine="openpyxl")

    fmt = _detect_format(raw)
    body, warn_msgs = _to_numeric_body(raw)

    if fmt == "B":
        # Rows = 48 HH periods, cols = days → transpose to (days, 48)
        body = body.T.reset_index(drop=True)

    # body is now (N_days, 48) — trim to exactly 48 columns
    body = body.iloc[:, :48].copy()
    body.columns = list(range(48))

    # Build a synthetic DatetimeIndex starting from Jan 1 of year 1
    n_days = len(body)
    start = date(2024, 1, 1)  # use a non-leap year as reference
    idx = pd.DatetimeIndex([start + timedelta(days=i) for i in range(n_days)])
    body.index = idx

    return body, fmt, warn_msgs
