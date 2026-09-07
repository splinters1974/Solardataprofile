import logging
import os
import tempfile
from datetime import date, timedelta
from pathlib import Path

import httpx
import numpy as np
import pandas as pd

log = logging.getLogger(__name__)

PVGIS_URL = "https://re.jrc.ec.europa.eu/api/v5_2/seriescalc"

# A single actual weather year, not a synthesised typical one. Say so in
# anything client-facing: a sunnier or duller year moves output either way.
PVGIS_WEATHER_YEAR = 2020
DEFAULT_SYSTEM_LOSS = 14  # %, PVGIS applies this to the 1 kWp output

# PVGIS is slow (~30s) and its answer for a given location and roof geometry
# does not change, so cache it. This is what lets a report be rebuilt after a
# restart without making the user wait on the API again.
CACHE_DIR = Path(
    os.environ.get("PVGIS_CACHE_DIR", Path(tempfile.gettempdir()) / "sdp-pvgis")
)


def _cache_key(lat: float, lon: float, tilt: int, aspect: int, loss: int) -> str:
    # ~100 m of resolution: finer than that makes no difference to irradiance.
    return f"{lat:.3f}_{lon:.3f}_{tilt}_{aspect}_{loss}".replace("-", "m")


# Annual yield bounds for 1 kWp, kWh. A north-facing vertical wall in
# Scotland still manages a couple of hundred; anything below the floor means
# the fetch failed rather than the roof being poor.
MIN_PLAUSIBLE_YIELD = 50.0
MAX_PLAUSIBLE_YIELD = 3_000.0


def _is_plausible(profile: pd.DataFrame) -> bool:
    """
    Reject a profile that cannot be real irradiance.

    A silently-zero profile is worse than an error: the sizing engine
    happily reports "0 kWp, could not reach 70% self-consumption", which
    reads as a finding about the site rather than a broken data feed.
    """
    if profile.empty or profile.isna().any().any():
        return False
    total = float(profile.values.sum())
    return MIN_PLAUSIBLE_YIELD <= total <= MAX_PLAUSIBLE_YIELD


def _read_cache(key: str) -> pd.DataFrame | None:
    path = CACHE_DIR / f"{key}.npz"
    if not path.exists():
        return None
    try:
        with np.load(path, allow_pickle=False) as data:
            return pd.DataFrame(
                data["values"],
                index=pd.DatetimeIndex(data["index"]),
                columns=list(range(data["values"].shape[1])),
            )
    except (OSError, ValueError, KeyError) as e:
        log.warning("Discarding unreadable PVGIS cache %s: %s", path, e)
        return None


def _write_cache(key: str, profile: pd.DataFrame) -> None:
    try:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        np.savez_compressed(
            CACHE_DIR / f"{key}.npz",
            values=profile.to_numpy(dtype=float),
            index=profile.index.to_numpy().astype("datetime64[ns]"),
        )
    except (OSError, ValueError) as e:
        log.warning("Could not cache PVGIS profile: %s", e)


async def fetch_generation_profile(
    lat: float,
    lon: float,
    tilt: int = 35,
    aspect: int = 0,
    loss: int = DEFAULT_SYSTEM_LOSS,
) -> pd.DataFrame:
    """
    Fetch hourly generation for 1 kWp from PVGIS and return a (365, 48)
    DataFrame of kWh per HH slot per day.

    Tries PVGIS-SARAH2 first; falls back to ERA5 if unavailable.
    """
    key = _cache_key(lat, lon, tilt, aspect, loss)
    cached = _read_cache(key)
    if cached is not None and _is_plausible(cached):
        return cached

    failures: list[str] = []
    for db in ("PVGIS-SARAH2", "ERA5"):
        try:
            df = await _fetch_pvgis(lat, lon, tilt, aspect, loss, db)
            profile = _hourly_to_halfhourly(df)
        except Exception as e:
            failures.append(f"{db}: {type(e).__name__}: {e}")
            continue

        if not _is_plausible(profile):
            # Cache nothing. A bad profile stored here would keep serving a
            # broken appraisal long after the underlying fault was fixed.
            failures.append(
                f"{db}: implausible yield "
                f"{profile.values.sum():.0f} kWh/kWp/year"
            )
            continue

        _write_cache(key, profile)
        return profile

    raise RuntimeError(
        f"Could not get usable irradiance data for lat={lat:.4f}, lon={lon:.4f}. "
        + " | ".join(failures)
    )


async def _fetch_pvgis(
    lat: float, lon: float, tilt: int, aspect: int, loss: int, raddatabase: str
) -> pd.Series:
    params = {
        "lat": round(lat, 4),
        "lon": round(lon, 4),
        "raddatabase": raddatabase,
        "browser": 0,
        "outputformat": "json",
        "usehorizon": 1,
        # Without this PVGIS returns irradiance only and no PV power field.
        # Omitting it is why every profile came back as zeros.
        "pvcalculation": 1,
        "peakpower": 1,
        "pvtechnology": "crystSi",
        "mountingplace": "building",
        "loss": loss,
        "angle": tilt,
        "aspect": aspect,
        "startyear": PVGIS_WEATHER_YEAR,
        "endyear": PVGIS_WEATHER_YEAR,
        "components": 0,
    }

    async with httpx.AsyncClient(timeout=60) as client:
        r = await client.get(PVGIS_URL, params=params)
        r.raise_for_status()
        data = r.json()

    hourly = data["outputs"]["hourly"]
    if not hourly:
        raise ValueError("PVGIS returned no hourly rows.")

    times, powers = [], []
    for entry in hourly:
        # time format: "20200101:0010"
        t_str = entry["time"]  # e.g. "20200101:0010"
        dt = pd.Timestamp(
            year=int(t_str[0:4]),
            month=int(t_str[4:6]),
            day=int(t_str[6:8]),
            hour=int(t_str[9:11]),
            minute=int(t_str[11:13]),
        )
        times.append(dt)
        # Never default a missing power to zero. Doing that turned a wrong
        # request into a plausible-looking profile of all zeros, which the
        # sizing engine then reported as "0 kWp, could not reach 70%".
        if "P" not in entry:
            raise ValueError(
                "PVGIS response has no PV power field. "
                "Check that pvcalculation=1 is being sent."
            )
        powers.append(float(entry["P"]))  # W for 1 kWp

    series = pd.Series(powers, index=pd.DatetimeIndex(times), name="power_w")
    # Convert W to kWh/h
    return series / 1000.0


def _hourly_to_halfhourly(hourly: pd.Series) -> pd.DataFrame:
    """
    Expand hourly kWh values to half-hourly by splitting each hour equally.
    Returns DataFrame shape (365, 48), index = date, columns = 0..47.
    """
    # Each hour → 2 HH slots, each = hourly_kWh / 2
    hh_values = hourly.values.repeat(2) / 2.0
    start = hourly.index[0].replace(minute=0)
    hh_index = pd.date_range(start=start, periods=len(hh_values), freq="30min")
    hh_series = pd.Series(hh_values, index=hh_index)

    # Pivot: rows = date, cols = slot index within day (0..47)
    hh_series_df = hh_series.to_frame("kwh")
    hh_series_df["day"] = hh_series_df.index.date
    hh_series_df["slot"] = (
        hh_series_df.index.hour * 2 + hh_series_df.index.minute // 30
    )
    pivot = hh_series_df.pivot(index="day", columns="slot", values="kwh")
    # Normalise the index so a freshly fetched profile and one read back from
    # the cache are identical, not merely equivalent.
    pivot.index = pd.DatetimeIndex(pivot.index).astype("datetime64[ns]")
    pivot.index.name = None
    pivot.columns = list(range(48))

    # Trim to 365 days (PVGIS 2020 is a leap year)
    pivot = pivot.iloc[:365]
    return pivot.clip(lower=0)
