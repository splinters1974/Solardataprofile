"""
End-to-end tests through the HTTP layer, with the two outbound services
(postcodes.io and PVGIS) stubbed so the suite runs offline.
"""

import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

import app.services.sizing_service as sizing_service
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

    monkeypatch.setattr(sizing_service, "postcode_to_latlon", fake_postcode)
    monkeypatch.setattr(sizing_service, "fetch_generation_profile", fake_generation)


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
        "max_payback_years": 8.0,
        "min_sc_rate": 0.50,
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

    def test_upload_echoes_the_filename(self, client, hh_csv):
        body = _upload(client, hh_csv)
        assert body["filename"] == "hh.csv"

    def test_each_upload_gets_its_own_session(self, client, hh_csv):
        """A second file must not land in the first one's session."""
        first = _upload(client, hh_csv)
        second = _upload(client, hh_csv)
        assert first["session_id"] != second["session_id"]

    def test_a_rejected_upload_leaves_the_previous_one_alone(self, client, hh_csv):
        body = _upload(client, hh_csv)
        client.post("/api/upload", files={"file": ("bad.csv", b"nonsense,data\n1,2")})

        # The good session is untouched and still sizes.
        assert _size(client, body["session_id"]).status_code == 200


class TestForgetSession:
    def test_clearing_removes_the_session(self, client, hh_csv):
        body = _upload(client, hh_csv)
        assert _size(client, body["session_id"]).status_code == 200

        assert client.delete(f"/api/session/{body['session_id']}").status_code == 204
        assert _size(client, body["session_id"]).status_code == 404

    def test_the_report_goes_with_it(self, client, hh_csv):
        body = _upload(client, hh_csv)
        _size(client, body["session_id"])
        client.delete(f"/api/session/{body['session_id']}")

        response = client.get(
            "/api/report/pdf", params={"session_id": body["session_id"]}
        )
        assert response.status_code == 404

    def test_clearing_an_unknown_session_is_not_an_error(self, client):
        """The UI resets regardless, so this must never fail the request."""
        assert client.delete("/api/session/never-existed").status_code == 204

    def test_clearing_one_session_leaves_others(self, client, hh_csv):
        keep = _upload(client, hh_csv)
        drop = _upload(client, hh_csv)

        client.delete(f"/api/session/{drop['session_id']}")
        assert _size(client, keep["session_id"]).status_code == 200
        assert _size(client, drop["session_id"]).status_code == 404


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

    def test_a_nonsense_hurdle_is_422(self, client, hh_csv):
        body = _upload(client, hh_csv)
        response = _size(client, body["session_id"], max_payback_years=0)
        assert response.status_code == 422


class TestAnalyserEndpoints:
    ANALYSER_PATHS = [
        "overview", "day-profile", "load-duration",
        "day-night", "week", "scatter", "report/pdf",
    ]

    @pytest.mark.parametrize("path", ANALYSER_PATHS)
    def test_each_endpoint_answers(self, client, hh_csv, path):
        body = _upload(client, hh_csv)
        response = client.get(
            f"/api/analyser/{path}", params={"session_id": body["session_id"]}
        )
        assert response.status_code == 200, response.text

    @pytest.mark.parametrize("path", ANALYSER_PATHS)
    def test_a_missing_session_is_recoverable_shaped(self, client, path):
        """
        The frontend spots a lost session by status 404 plus "session" in the
        detail, and only then re-uploads. An endpoint that 404s differently
        is one the user cannot recover from — which is exactly how the
        analyser broke while the solar side silently repaired itself.
        """
        response = client.get(
            f"/api/analyser/{path}", params={"session_id": "no-such-session"}
        )
        assert response.status_code == 404
        assert "session" in response.json()["detail"].lower()

    def test_the_solar_and_analyser_404s_match(self, client):
        """Both sides must be recoverable in the same way."""
        analyser = client.get(
            "/api/analyser/overview", params={"session_id": "nope"}
        )
        solar = _size(client, "nope")
        assert analyser.status_code == solar.status_code == 404
        assert analyser.json()["detail"] == solar.json()["detail"]

    def test_the_pdf_covers_every_chart(self, client, hh_csv):
        body = _upload(client, hh_csv)
        response = client.get("/api/analyser/report/pdf", params={
            "session_id": body["session_id"],
            "week_a": "2018-11-05", "week_b": "2019-06-17",
        })
        assert response.status_code == 200
        assert response.headers["content-type"] == "application/pdf"
        assert "hh-analysis.pdf" in response.headers["content-disposition"]
        assert response.content.startswith(b"%PDF")
        assert len(response.content) > 20_000  # charts, not just text

    def test_the_pdf_follows_the_on_screen_filters(self, client, hh_csv):
        """A narrower window must produce a different document, not the same one."""
        body = _upload(client, hh_csv)
        whole = client.get("/api/analyser/report/pdf",
                           params={"session_id": body["session_id"]}).content
        narrow = client.get("/api/analyser/report/pdf", params={
            "session_id": body["session_id"],
            "date_from": "2019-01-01", "date_to": "2019-03-31",
        }).content
        assert whole != narrow

    def test_a_window_with_no_data_is_a_clear_422(self, client, hh_csv):
        body = _upload(client, hh_csv)
        response = client.get("/api/analyser/report/pdf", params={
            "session_id": body["session_id"],
            "date_from": "2030-01-01", "date_to": "2030-02-01",
        })
        assert response.status_code == 422
        assert "widen" in response.json()["detail"].lower()

    def test_the_pdf_is_recoverable_like_everything_else(self, client):
        response = client.get("/api/analyser/report/pdf",
                              params={"session_id": "nope"})
        assert response.status_code == 404
        assert "session" in response.json()["detail"].lower()

    def test_overview_carries_what_the_pickers_need(self, client, hh_csv):
        body = _upload(client, hh_csv)
        data = client.get(
            "/api/analyser/overview", params={"session_id": body["session_id"]}
        ).json()
        assert data["summary"]["days"] == 365
        assert len(data["weeks"]) >= 52
        assert data["date_from"] == "2018-11-01"


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
