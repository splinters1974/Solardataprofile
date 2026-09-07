"""
End-to-end tests through the HTTP layer, with the two outbound services
(postcodes.io and PVGIS) stubbed so the suite runs offline.
"""

import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

import app.routers.solar as solar_router
from app.main import app

from test_parser_and_sizing import _csv_bytes, _uk_generation_profile

from datetime import date, timedelta


@pytest.fixture(autouse=True)
def stub_external(monkeypatch):
    profile = _uk_generation_profile()

    async def fake_postcode(_postcode: str):
        return 54.32, -2.74

    async def fake_generation(lat, lon, tilt=35, aspect=0, loss=14):
        return profile.copy()

    monkeypatch.setattr(solar_router, "postcode_to_latlon", fake_postcode)
    monkeypatch.setattr(solar_router, "fetch_generation_profile", fake_generation)


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def hh_csv() -> bytes:
    dates = [
        (date(2018, 11, 1) + timedelta(days=i)).strftime("%d/%m/%Y")
        for i in range(365)
    ]
    # A workday-shaped profile so self-consumption behaves like a real site.
    shape = np.array([8.0 if 14 <= s <= 38 else 3.0 for s in range(48)])
    body = pd.DataFrame(np.tile(shape, (365, 1)))
    return _csv_bytes(body, dates)


def _size(client, session_id, **overrides):
    payload = {
        "session_id": session_id,
        "postcode": "LA9 4QQ",
        "site_name": "Test Leisure Centre",
        "target_sc_min": 0.70,
        "target_sc_max": 0.90,
        "roof_tilt": 35,
        "roof_aspect": 0,
    }
    payload.update(overrides)
    return client.post("/api/solar/size", json=payload)


def _upload(client, hh_csv):
    response = client.post("/api/upload", files={"file": ("hh.csv", hh_csv)})
    assert response.status_code == 200, response.text
    return response.json()


class TestUpload:
    def test_upload_reports_the_real_date_range(self, client, hh_csv):
        body = _upload(client, hh_csv)
        assert body["days_parsed"] == 365
        assert body["date_from"] == "2018-11-01"
        assert body["date_to"] == "2019-10-31"

    def test_unsupported_extension_is_rejected(self, client):
        response = client.post("/api/upload", files={"file": ("notes.pdf", b"x")})
        assert response.status_code == 400

    def test_empty_file_is_rejected(self, client):
        response = client.post("/api/upload", files={"file": ("hh.csv", b"")})
        assert response.status_code == 400


class TestSizing:
    def test_headline_numbers_are_finite(self, client, hh_csv):
        body = _upload(client, hh_csv)
        result = _size(client, body["session_id"]).json()

        assert result["recommended_kwp"] > 0
        assert 0 < result["sc_rate"] <= 1
        for value in result["economics"].values():
            if isinstance(value, (int, float)):
                assert np.isfinite(value)

    def test_energy_balance_is_consistent(self, client, hh_csv):
        body = _upload(client, hh_csv)
        r = _size(client, body["session_id"]).json()
        assert r["self_consumed_kwh"] + r["exported_kwh"] == pytest.approx(
            r["annual_generation_kwh"], rel=1e-3
        )

    def test_tariffs_change_the_answer(self, client, hh_csv):
        body = _upload(client, hh_csv)
        cheap = _size(client, body["session_id"], assumptions={
            "import_price_p_kwh": 10.0, "export_price_p_kwh": 1.0,
        }).json()
        dear = _size(client, body["session_id"], assumptions={
            "import_price_p_kwh": 40.0, "export_price_p_kwh": 1.0,
        }).json()
        assert (
            dear["economics"]["simple_payback_years"]
            < cheap["economics"]["simple_payback_years"]
        )

    def test_unknown_session_is_404(self, client):
        assert _size(client, "no-such-session").status_code == 404

    def test_inverted_band_is_422(self, client, hh_csv):
        body = _upload(client, hh_csv)
        response = _size(client, body["session_id"],
                         target_sc_min=0.9, target_sc_max=0.5)
        assert response.status_code == 422


class TestReportEndpoint:
    def test_pdf_downloads_after_sizing(self, client, hh_csv):
        body = _upload(client, hh_csv)
        assert _size(client, body["session_id"]).status_code == 200

        response = client.get(
            "/api/report/pdf", params={"session_id": body["session_id"]}
        )
        assert response.status_code == 200
        assert response.headers["content-type"] == "application/pdf"
        assert "attachment" in response.headers["content-disposition"]
        assert "Test-Leisure-Centre" in response.headers["content-disposition"]
        assert response.content.startswith(b"%PDF")

    def test_report_before_sizing_is_409(self, client, hh_csv):
        body = _upload(client, hh_csv)
        response = client.get(
            "/api/report/pdf", params={"session_id": body["session_id"]}
        )
        assert response.status_code == 409

    def test_report_for_unknown_session_is_404(self, client):
        response = client.get("/api/report/pdf", params={"session_id": "nope"})
        assert response.status_code == 404
