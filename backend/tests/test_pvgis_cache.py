"""
The PVGIS cache is what makes a rebuilt report fast instead of a 30-second
wait on an external API, so it needs to actually be hit.
"""

import numpy as np
import pandas as pd
import pytest

import app.services.pvgis_client as pvgis


@pytest.fixture(autouse=True)
def cache_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(pvgis, "CACHE_DIR", tmp_path / "pvgis")
    return tmp_path / "pvgis"


@pytest.fixture
def profile() -> pd.DataFrame:
    idx = pd.date_range("2020-01-01", periods=366, freq="D")
    values = np.random.default_rng(1).uniform(0, 0.4, (366, 48))
    return pd.DataFrame(values, index=idx, columns=list(range(48)))


@pytest.fixture
def counting_fetch(monkeypatch, profile):
    calls = {"n": 0}

    async def fake_fetch(lat, lon, tilt, aspect, loss, raddatabase):
        calls["n"] += 1
        # The real client returns an hourly Series; hand back something the
        # half-hourly converter can chew on.
        hours = pd.date_range("2020-01-01", periods=366 * 24, freq="h")
        return pd.Series(
            np.random.default_rng(2).uniform(0, 0.8, len(hours)), index=hours
        )

    monkeypatch.setattr(pvgis, "_fetch_pvgis", fake_fetch)
    return calls


@pytest.mark.asyncio
async def test_second_call_is_served_from_cache(counting_fetch):
    first = await pvgis.fetch_generation_profile(54.32, -2.74, tilt=35, aspect=0)
    second = await pvgis.fetch_generation_profile(54.32, -2.74, tilt=35, aspect=0)

    assert counting_fetch["n"] == 1
    pd.testing.assert_frame_equal(first, second)


@pytest.mark.asyncio
async def test_different_geometry_is_a_different_entry(counting_fetch):
    await pvgis.fetch_generation_profile(54.32, -2.74, tilt=35, aspect=0)
    await pvgis.fetch_generation_profile(54.32, -2.74, tilt=10, aspect=0)
    await pvgis.fetch_generation_profile(51.50, -0.12, tilt=35, aspect=0)

    assert counting_fetch["n"] == 3


@pytest.mark.asyncio
async def test_nearby_coordinates_share_an_entry(counting_fetch):
    """Sub-100m precision makes no difference to irradiance."""
    await pvgis.fetch_generation_profile(54.32001, -2.74001)
    await pvgis.fetch_generation_profile(54.32002, -2.74002)

    assert counting_fetch["n"] == 1


@pytest.mark.asyncio
async def test_a_corrupt_cache_entry_is_refetched(counting_fetch, cache_dir):
    await pvgis.fetch_generation_profile(54.32, -2.74)
    for entry in cache_dir.iterdir():
        entry.write_bytes(b"not an npz file")

    await pvgis.fetch_generation_profile(54.32, -2.74)
    assert counting_fetch["n"] == 2


@pytest.mark.asyncio
async def test_an_unwritable_cache_does_not_break_the_call(monkeypatch, tmp_path,
                                                           counting_fetch):
    blocker = tmp_path / "not-a-dir"
    blocker.write_text("")
    monkeypatch.setattr(pvgis, "CACHE_DIR", blocker / "pvgis")

    result = await pvgis.fetch_generation_profile(54.32, -2.74)
    assert result.shape == (365, 48)
