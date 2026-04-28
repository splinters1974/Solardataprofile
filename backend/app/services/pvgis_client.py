from datetime import date, timedelta

import httpx
import pandas as pd

PVGIS_URL = "https://re.jrc.ec.europa.eu/api/v5_2/seriescalc"


async def fetch_generation_profile(
    lat: float,
    lon: float,
    tilt: int = 35,
    aspect: int = 0,
    loss: int = 14,
) -> pd.DataFrame:
    """
    Fetch hourly generation for 1 kWp from PVGIS and return a (365, 48)
    DataFrame of kWh per HH slot per day.

    Tries PVGIS-SARAH2 first; falls back to ERA5 if unavailable.
    """
    for db in ("PVGIS-SARAH2", "ERA5"):
        try:
            df = await _fetch_pvgis(lat, lon, tilt, aspect, loss, db)
            return _hourly_to_halfhourly(df)
        except Exception:
            continue

    raise RuntimeError(
        f"PVGIS returned no usable data for lat={lat:.4f}, lon={lon:.4f}"
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
        "peakpower": 1,
        "pvtechnology": "crystSi",
        "mountingplace": "building",
        "loss": loss,
        "angle": tilt,
        "aspect": aspect,
        "startyear": 2020,
        "endyear": 2020,
        "components": 0,
    }

    async with httpx.AsyncClient(timeout=60) as client:
        r = await client.get(PVGIS_URL, params=params)
        r.raise_for_status()
        data = r.json()

    hourly = data["outputs"]["hourly"]
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
        powers.append(float(entry.get("P", 0)))  # W for 1 kWp

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
    pivot.index = pd.DatetimeIndex(pivot.index)
    pivot.columns = list(range(48))

    # Trim to 365 days (PVGIS 2020 is a leap year)
    pivot = pivot.iloc[:365]
    return pivot.clip(lower=0)
