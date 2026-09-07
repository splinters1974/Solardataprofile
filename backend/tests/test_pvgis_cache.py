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
        # The real client returns an hourly Series. Keep the annual total in
        # the plausible range or the profile guard rejects it, correctly.
        hours = pd.date_range("2020-01-01", periods=366 * 24, freq="h")
        daylight = np.array([
            max(0.0, np.sin(np.pi * (h.hour - 6) / 12)) for h in hours
        ])
        return pd.Series(daylight * (950 / daylight.sum()), index=hours)

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


class TestZeroProfileGuard:
    """
    A silently-zero profile once reached a client PDF as "0 kWp, could not
    reach 70% self-consumption" — a broken data feed dressed up as a finding
    about the site. Every path that could produce one is closed here.
    """

    @pytest.mark.asyncio
    async def test_the_request_asks_for_pv_power(self, monkeypatch):
        """Without pvcalculation=1 PVGIS returns irradiance and no P field."""
        seen = {}

        class FakeResponse:
            def raise_for_status(self): pass
            def json(self):
                return {"outputs": {"hourly": [
                    {"time": "20200101:0010", "P": 0.0}
                ]}}

        class FakeClient:
            async def __aenter__(self): return self
            async def __aexit__(self, *a): return False
            async def get(self, url, params=None):
                seen.update(params or {})
                return FakeResponse()

        monkeypatch.setattr(pvgis.httpx, "AsyncClient", lambda **kw: FakeClient())
        try:
            await pvgis._fetch_pvgis(54.3, -2.7, 35, 0, 14, "PVGIS-SARAH2")
        except Exception:
            pass

        assert seen.get("pvcalculation") == 1
        assert seen.get("peakpower") == 1

    @pytest.mark.asyncio
    async def test_a_response_without_power_is_an_error_not_zeros(self, monkeypatch):
        class FakeResponse:
            def raise_for_status(self): pass
            def json(self):
                # Irradiance-only response: the shape PVGIS returns when
                # pvcalculation is not set.
                return {"outputs": {"hourly": [
                    {"time": "20200101:0010", "G(i)": 0.0, "T2m": 4.1}
                ]}}

        class FakeClient:
            async def __aenter__(self): return self
            async def __aexit__(self, *a): return False
            async def get(self, url, params=None): return FakeResponse()

        monkeypatch.setattr(pvgis.httpx, "AsyncClient", lambda **kw: FakeClient())
        with pytest.raises(ValueError, match="no PV power field"):
            await pvgis._fetch_pvgis(54.3, -2.7, 35, 0, 14, "PVGIS-SARAH2")

    @pytest.mark.asyncio
    async def test_a_zero_profile_raises_instead_of_being_returned(self, monkeypatch):
        async def zero_fetch(lat, lon, tilt, aspect, loss, raddatabase):
            hours = pd.date_range("2020-01-01", periods=366 * 24, freq="h")
            return pd.Series(np.zeros(len(hours)), index=hours)

        monkeypatch.setattr(pvgis, "_fetch_pvgis", zero_fetch)
        with pytest.raises(RuntimeError, match="implausible yield"):
            await pvgis.fetch_generation_profile(54.3, -2.7)

    @pytest.mark.asyncio
    async def test_a_zero_profile_is_never_cached(self, monkeypatch, cache_dir):
        async def zero_fetch(lat, lon, tilt, aspect, loss, raddatabase):
            hours = pd.date_range("2020-01-01", periods=366 * 24, freq="h")
            return pd.Series(np.zeros(len(hours)), index=hours)

        monkeypatch.setattr(pvgis, "_fetch_pvgis", zero_fetch)
        with pytest.raises(RuntimeError):
            await pvgis.fetch_generation_profile(54.3, -2.7)

        assert not cache_dir.exists() or not list(cache_dir.iterdir())

    @pytest.mark.asyncio
    async def test_a_cached_zero_profile_is_not_trusted(self, monkeypatch, cache_dir):
        """A bad entry written by an older build must not keep being served."""
        zeros = pd.DataFrame(
            np.zeros((365, 48)),
            index=pd.date_range("2020-01-01", periods=365), columns=range(48),
        )
        pvgis._write_cache(pvgis._cache_key(54.3, -2.7, 35, 0, 14), zeros)

        good = pd.DataFrame(
            np.full((365, 48), 950 / (365 * 48)),
            index=pd.date_range("2020-01-01", periods=365), columns=range(48),
        )

        async def good_fetch(lat, lon, tilt, aspect, loss, raddatabase):
            hours = pd.date_range("2020-01-01", periods=365 * 24, freq="h")
            return pd.Series(np.full(len(hours), 950 / (365 * 24)), index=hours)

        monkeypatch.setattr(pvgis, "_fetch_pvgis", good_fetch)
        result = await pvgis.fetch_generation_profile(54.3, -2.7, 35, 0, 14)
        assert result.values.sum() > pvgis.MIN_PLAUSIBLE_YIELD

    @pytest.mark.asyncio
    async def test_a_wildly_high_profile_is_rejected(self, monkeypatch):
        async def silly_fetch(lat, lon, tilt, aspect, loss, raddatabase):
            hours = pd.date_range("2020-01-01", periods=366 * 24, freq="h")
            return pd.Series(np.full(len(hours), 5.0), index=hours)

        monkeypatch.setattr(pvgis, "_fetch_pvgis", silly_fetch)
        with pytest.raises(RuntimeError, match="implausible yield"):
            await pvgis.fetch_generation_profile(54.3, -2.7)


@pytest.mark.asyncio
async def test_an_unwritable_cache_does_not_break_the_call(monkeypatch, tmp_path,
                                                           counting_fetch):
    blocker = tmp_path / "not-a-dir"
    blocker.write_text("")
    monkeypatch.setattr(pvgis, "CACHE_DIR", blocker / "pvgis")

    result = await pvgis.fetch_generation_profile(54.32, -2.74)
    assert result.shape == (365, 48)
