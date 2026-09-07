"""
Persistence tests. The point of the store is that a restart does not lose
the user's upload, so every test here proves something survives one.
"""

import time
from datetime import date, timedelta

import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

import app.services.sizing_service as sizing_service
import app.state as state
from app.main import app
from app.services.session_store import Session, SessionStore

from test_parser_and_sizing import _csv_bytes, _uk_generation_profile


@pytest.fixture
def store(tmp_path) -> SessionStore:
    return SessionStore(root=tmp_path / "sessions", ttl=3600)


@pytest.fixture
def session() -> Session:
    idx = pd.DatetimeIndex(
        [pd.Timestamp("2018-11-01") + timedelta(days=i) for i in range(365)]
    )
    frame = pd.DataFrame(
        np.random.default_rng(0).uniform(1, 50, (365, 48)),
        index=idx, columns=range(48),
    )
    frame.index = frame.index.astype("datetime64[ns]")
    return Session(
        consumption=frame,
        filename="hh.csv",
        site_name="Test Leisure Centre",
        warnings=["Ignored 3 rows with no date."],
        detected_format="A",
    )


class TestRoundTrip:
    def test_consumption_survives_a_restart(self, store, session):
        store.save("abc123", session)
        store._cache.clear()  # a restart loses memory but not the disk

        loaded = store.get("abc123")
        assert loaded is not None
        pd.testing.assert_frame_equal(
            loaded.consumption, session.consumption, check_column_type=False
        )

    def test_metadata_survives_a_restart(self, store, session):
        session.last_request = {"postcode": "LA9 4QQ", "roof_tilt": 30}
        store.save("abc123", session)
        store._cache.clear()

        loaded = store.get("abc123")
        assert loaded.site_name == "Test Leisure Centre"
        assert loaded.warnings == ["Ignored 3 rows with no date."]
        assert loaded.last_request["postcode"] == "LA9 4QQ"
        assert loaded.detected_format == "A"

    def test_unknown_session_returns_none(self, store):
        assert store.get("does-not-exist") is None

    def test_delete_removes_it(self, store, session):
        store.save("abc123", session)
        store.delete("abc123")
        assert store.get("abc123") is None


class TestHousekeeping:
    def test_expired_sessions_are_dropped(self, tmp_path, session):
        store = SessionStore(root=tmp_path / "s", ttl=0)
        store.save("abc123", session)
        store._cache.clear()
        time.sleep(0.01)
        assert store.get("abc123") is None

    def test_purge_removes_expired_sessions_from_disk(self, tmp_path, session):
        store = SessionStore(root=tmp_path / "s", ttl=0)
        store.save("stale", session)
        store._cache.clear()

        assert store.purge_expired() == 1
        assert not (store.root / "stale").exists()

    def test_purge_keeps_live_sessions(self, tmp_path, session):
        store = SessionStore(root=tmp_path / "s", ttl=3600)
        store.save("live", session)

        assert store.purge_expired() == 0
        assert store.get("live") is not None

    def test_memory_cache_is_bounded(self, store, session):
        for i in range(40):
            store.save(f"session{i}", session)
        assert len(store._cache) <= 16

    def test_a_traversal_id_cannot_escape_the_store(self, store, session):
        for bad in ("../escape", "a/b", "..", ""):
            assert store.get(bad) is None

    def test_an_unwritable_location_still_serves_from_memory(self, tmp_path, session):
        blocker = tmp_path / "not-a-directory"
        blocker.write_text("")
        store = SessionStore(root=blocker / "sessions", ttl=3600)

        store.save("abc123", session)
        assert store.get("abc123") is not None  # memory cache carries it


class TestRestartRecovery:
    """The behaviour users actually notice."""

    @pytest.fixture(autouse=True)
    def stub_external(self, monkeypatch, tmp_path):
        profile = _uk_generation_profile()

        async def fake_postcode(_postcode):
            return 54.32, -2.74

        async def fake_generation(lat, lon, tilt=35, aspect=0, loss=14):
            return profile.copy()

        monkeypatch.setattr(sizing_service, "postcode_to_latlon", fake_postcode)
        monkeypatch.setattr(sizing_service, "fetch_generation_profile", fake_generation)
        monkeypatch.setattr(
            state.SESSION_STORE, "root", tmp_path / "live-sessions"
        )
        state.SESSION_STORE.root.mkdir(parents=True, exist_ok=True)
        state.SESSION_STORE._cache.clear()

    @pytest.fixture
    def client(self):
        return TestClient(app)

    @pytest.fixture
    def hh_csv(self):
        dates = [
            (date(2018, 11, 1) + timedelta(days=i)).strftime("%d/%m/%Y")
            for i in range(365)
        ]
        shape = np.array([8.0 if 14 <= s <= 38 else 3.0 for s in range(48)])
        return _csv_bytes(pd.DataFrame(np.tile(shape, (365, 1))), dates)

    def _size(self, client, session_id):
        return client.post("/api/solar/size", json={
            "session_id": session_id, "postcode": "LA9 4QQ",
            "site_name": "Test Leisure Centre",
            "target_sc_min": 0.70, "target_sc_max": 0.90,
        })

    def test_sizing_works_after_a_restart(self, client, hh_csv):
        session_id = client.post(
            "/api/upload", files={"file": ("hh.csv", hh_csv)}
        ).json()["session_id"]

        before = self._size(client, session_id).json()
        state.SESSION_STORE._cache.clear()  # the restart
        after = self._size(client, session_id).json()

        assert after["recommended_kwp"] == before["recommended_kwp"]
        assert after["economics"]["simple_payback_years"] == pytest.approx(
            before["economics"]["simple_payback_years"]
        )

    def test_report_rebuilds_itself_after_a_restart(self, client, hh_csv):
        """The result is gone but the inputs are not, so rebuild rather than 404."""
        session_id = client.post(
            "/api/upload", files={"file": ("hh.csv", hh_csv)}
        ).json()["session_id"]
        assert self._size(client, session_id).status_code == 200

        state.SESSION_STORE._cache.clear()

        response = client.get("/api/report/pdf", params={"session_id": session_id})
        assert response.status_code == 200
        assert response.content.startswith(b"%PDF")
        assert "Test-Leisure-Centre" in response.headers["content-disposition"]
