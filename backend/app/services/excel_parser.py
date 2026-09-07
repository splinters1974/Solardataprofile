import re
import io
import csv
import warnings
from datetime import date, timedelta

import numpy as np
import pandas as pd


def _count_time_strings(series: pd.Series) -> int:
    pattern = re.compile(r"^\d{1,2}:\d{2}$|^HH\s*\d{1,2}$|^Period\s*\d+$", re.IGNORECASE)
    return sum(1 for v in series.dropna() if pattern.match(str(v).strip()))


def _is_date_like(val) -> bool:
    """Return True if val looks like a date (datetime object or date string)."""
    if isinstance(val, (pd.Timestamp, date)):
        return True
    s = str(val).strip()
    date_patterns = [
        r"^\d{4}-\d{2}-\d{2}$",
        r"^\d{2}/\d{2}/\d{4}$",
        r"^\d{2}-\d{2}-\d{4}$",
        r"^\d{1,2}/\d{1,2}/\d{2,4}$",
    ]
    return any(re.match(p, s) for p in date_patterns)


def _parse_dates(values) -> pd.Series | None:
    """
    Parse a column of mixed date values, day-first (UK convention).
    Returns a Series with NaT where a row has no usable date.
    """
    try:
        parsed = pd.to_datetime(pd.Series(list(values)), dayfirst=True, errors="coerce")
    except Exception:
        return None
    if parsed.notna().sum() < 30:
        return None
    return parsed


def _strip_headers(raw: pd.DataFrame) -> tuple[pd.DataFrame, list, list[str]]:
    """
    Strip non-data header rows and leading label/date columns.
    Returns (cleaned_body, date_column_values_or_empty, warnings).
    """
    df = raw.copy()
    warn_msgs: list[str] = []
    dates: list = []

    # Drop up to 8 leading rows where < 10% of cells are numeric. Real HH
    # exports carry a title block (site name, meter ID, start date) above
    # the data, and the CBS-style workbooks run to 6 such rows.
    for _ in range(8):
        if len(df) == 0:
            break
        row0 = df.iloc[0]
        numeric_frac = pd.to_numeric(row0, errors="coerce").notna().mean()
        if numeric_frac < 0.1:
            df = df.iloc[1:].reset_index(drop=True)
        else:
            break

    # Drop leading identifier columns until 48 half-hour columns remain, and
    # keep the date-like one. Meter IDs are numeric, so "stop at the first
    # numeric column" would leave the date column sitting in slot 0.
    for _ in range(10):
        if df.shape[1] <= 48:
            break
        col0 = df.iloc[:, 0]
        if sum(1 for v in col0.dropna() if _is_date_like(v)) > len(col0) * 0.3:
            dates = list(col0)
        df = df.iloc[:, 1:].reset_index(drop=True)

    # Layouts that are already 48 wide can still lead with a date column when
    # the export omits a slot; only strip it if it clearly is not a reading.
    if df.shape[1] > 48:
        df = df.iloc[:, :48]

    return df, dates, warn_msgs


def _detect_format(raw: pd.DataFrame) -> str:
    body, _, _ = _strip_headers(raw)
    nrows, ncols = body.shape

    # Exact match first
    if abs(nrows - 365) <= 15 and abs(ncols - 48) <= 4:
        return "A"
    if abs(nrows - 48) <= 4 and abs(ncols - 365) <= 15:
        return "B"
    if abs(nrows - 366) <= 3 and abs(ncols - 48) <= 4:
        return "A"
    if abs(nrows - 48) <= 4 and abs(ncols - 366) <= 3:
        return "B"

    # Tiebreak: look for time-like strings in first row or column of raw
    first_col_times = _count_time_strings(raw.iloc[:, 0])
    first_row_times = _count_time_strings(raw.iloc[0])
    if first_col_times > first_row_times:
        return "B"

    # Final fallback: whichever dimension is closer to 48
    if abs(nrows - 48) < abs(ncols - 48):
        return "B"
    return "A"


def _read_csv(file_bytes: bytes) -> pd.DataFrame:
    """Try to read as CSV, detecting delimiter automatically."""
    text = file_bytes.decode("utf-8", errors="replace")
    dialect = csv.Sniffer().sniff(text[:4096], delimiters=",\t;|")
    return pd.read_csv(io.StringIO(text), header=None, sep=dialect.delimiter)


def _sheet_score(df: pd.DataFrame) -> float:
    """
    How much this sheet looks like a block of HH readings.

    Analyser workbooks carry a User Guide, chart tabs and calculation tabs
    alongside the data, and pandas reads sheet 0 by default — which is why
    they used to fail on the guide tab. Score every sheet and take the best.
    """
    if df.empty:
        return 0.0
    numeric = df.apply(pd.to_numeric, errors="coerce")
    # Rows carrying a long run of numbers are the readings we want.
    per_row = numeric.notna().sum(axis=1)
    wide_rows = int((per_row >= 40).sum())
    if wide_rows == 0:
        # Transposed layouts have many numeric columns instead.
        per_col = numeric.notna().sum(axis=0)
        wide_rows = int((per_col >= 40).sum())
    return float(wide_rows)


def _read_excel(file_bytes: bytes) -> pd.DataFrame:
    """Read the sheet that actually holds the HH readings."""
    last_error: Exception | None = None
    for engine in ("openpyxl", "xlrd"):
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                book = pd.read_excel(
                    io.BytesIO(file_bytes), header=None, engine=engine, sheet_name=None
                )
        except Exception as e:  # noqa: PERF203 - try the next engine
            last_error = e
            continue

        scored = sorted(
            ((_sheet_score(df), name, df) for name, df in book.items()),
            key=lambda t: t[0],
            reverse=True,
        )
        if scored and scored[0][0] > 0:
            return scored[0][2]
        # No sheet looks like HH data — fall back to the first non-empty one.
        for _, _, df in scored:
            if not df.empty:
                return df

    raise ValueError(
        "Could not read file. Please save as .xlsx or .csv and try again. "
        f"({last_error})"
    )


def _to_numeric_body(df: pd.DataFrame) -> tuple[pd.DataFrame, list[str]]:
    warn_msgs: list[str] = []
    numeric = df.apply(pd.to_numeric, errors="coerce")
    n_bad = int(numeric.isna().sum().sum())
    if n_bad > 0:
        warn_msgs.append(f"{n_bad} non-numeric cells replaced with 0.")
    return numeric.fillna(0.0), warn_msgs


def load_and_normalise(
    file_bytes: bytes,
    filename: str = "",
) -> tuple[pd.DataFrame, str, list[str]]:
    """
    Parse an uploaded HH data file (xlsx, xlsm, xls, or csv).

    Returns:
        df:       DataFrame (N_days × 48), DatetimeIndex, columns 0..47
        fmt:      detected format "A" or "B"
        warnings: list of user-facing warning strings
    """
    all_warnings: list[str] = []

    # --- Read raw data ---
    lower = filename.lower()
    if lower.endswith(".csv") or lower.endswith(".txt"):
        try:
            raw = _read_csv(file_bytes)
        except Exception as e:
            raise ValueError(f"Could not parse CSV: {e}")
    else:
        raw = _read_excel(file_bytes)

    if raw.empty:
        raise ValueError("The file appears to be empty.")

    # --- Detect format before stripping (uses raw headers for clues) ---
    fmt = _detect_format(raw)

    # --- Strip headers and date columns ---
    body, date_values, strip_warns = _strip_headers(raw)
    all_warnings.extend(strip_warns)

    # --- Convert to numeric ---
    numeric, num_warns = _to_numeric_body(body)
    all_warnings.extend(num_warns)

    # --- Orient to (days × 48) ---
    if fmt == "B":
        numeric = numeric.T.reset_index(drop=True)
        date_values = []  # dates live in the header row, not usable here yet

    # Trim to exactly 48 HH columns
    if numeric.shape[1] < 48:
        raise ValueError(
            f"Expected 48 half-hour columns but found {numeric.shape[1]}. "
            "Please check the file format."
        )
    numeric = numeric.iloc[:, :48].copy()
    numeric.columns = list(range(48))

    # --- Put the data on its own calendar ---
    # This matters more than it looks: solar generation is seasonal, so if
    # consumption sits on the wrong dates, summer load gets matched against
    # winter sun and the recommended array size is wrong.
    parsed = _parse_dates(date_values) if len(date_values) == len(numeric) else None

    if parsed is not None:
        # A dated row is a real reading; an undated one is template padding or
        # a stray paste. Analyser workbooks routinely carry both.
        keep = parsed.notna().to_numpy()
        dropped = int((~keep).sum())
        numeric = numeric[keep].reset_index(drop=True)
        idx = pd.DatetimeIndex(parsed[keep].to_numpy())
        if dropped:
            all_warnings.append(
                f"Ignored {dropped} row(s) with no date — these look like "
                "template padding or data pasted below the dated block."
            )
        numeric.index = idx
        numeric = numeric[~numeric.index.duplicated(keep="first")].sort_index()
    else:
        # Fall back to trimming trailing blank rows and assuming a Jan start.
        nonzero = numeric.sum(axis=1) > 0
        if nonzero.any():
            last = int(np.flatnonzero(nonzero.to_numpy())[-1])
            numeric = numeric.iloc[: last + 1]
        start = date(2024, 1, 1)
        numeric.index = pd.DatetimeIndex(
            [start + timedelta(days=i) for i in range(len(numeric))]
        )
        all_warnings.append(
            "No usable date column found — assumed the data starts on 1 January. "
            "Seasonal solar matching may be shifted if that is wrong."
        )

    # Pin the index to nanosecond resolution. pandas picks microseconds for
    # some inputs, and that difference would otherwise survive into the
    # session store and show up as a dtype mismatch on reload.
    numeric.index = numeric.index.astype("datetime64[ns]")

    n_days = len(numeric)
    if n_days == 0:
        raise ValueError("No readings found in the file.")
    if n_days < 300:
        all_warnings.append(
            f"Only {n_days} days of data found (expected ~365). "
            "Results are based on a partial year."
        )

    gaps = int((numeric.index.to_series().diff().dt.days.fillna(1) > 1).sum())
    if gaps:
        all_warnings.append(
            f"{gaps} gap(s) in the date sequence — some days are missing from the file."
        )

    return numeric, fmt, all_warnings
