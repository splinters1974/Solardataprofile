"""Ameresco HH Analyser endpoints."""

import re
from urllib.parse import quote

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response

from app.services import hh_analytics
from app.services.analyser_report import build_analyser_report
from app.state import SESSION_STORE

router = APIRouter()


def _session(session_id: str):
    session = SESSION_STORE.get(session_id)
    if session is None:
        raise HTTPException(404, "Session not found. Please re-upload your HH data.")
    return session


@router.get("/analyser/overview")
async def overview(session_id: str):
    """Headline stats plus the pickers the other endpoints need."""
    session = _session(session_id)
    df = session.consumption
    return {
        "summary": hh_analytics.summary_stats(df),
        "weeks": hh_analytics.available_weeks(df),
        "date_from": df.index[0].strftime("%Y-%m-%d") if len(df) else None,
        "date_to": df.index[-1].strftime("%Y-%m-%d") if len(df) else None,
        "site_name": session.site_name,
        "filename": session.filename,
    }


@router.get("/analyser/day-profile")
async def day_profile(
    session_id: str,
    date_from: str | None = None,
    date_to: str | None = None,
    exclude_holidays: bool = True,
):
    return hh_analytics.day_of_week_profile(
        _session(session_id).consumption, date_from, date_to, exclude_holidays
    )


@router.get("/analyser/load-duration")
async def load_duration(
    session_id: str,
    date_from: str | None = None,
    date_to: str | None = None,
):
    return hh_analytics.load_duration_curve(
        _session(session_id).consumption, date_from, date_to
    )


@router.get("/analyser/day-night")
async def day_night(
    session_id: str,
    date_from: str | None = None,
    date_to: str | None = None,
    night_start_slot: int = Query(hh_analytics.DEFAULT_NIGHT_START_SLOT, ge=0, le=47),
    night_end_slot: int = Query(hh_analytics.DEFAULT_NIGHT_END_SLOT, ge=0, le=48),
):
    return hh_analytics.day_night_split(
        _session(session_id).consumption,
        date_from, date_to, night_start_slot, night_end_slot,
    )


@router.get("/analyser/week")
async def week(session_id: str, week_commencing: str | None = None):
    return hh_analytics.week_profile(
        _session(session_id).consumption, week_commencing
    )


@router.get("/analyser/scatter")
async def scatter(session_id: str, exclude_holidays: bool = True):
    return hh_analytics.full_year_scatter(
        _session(session_id).consumption, exclude_holidays
    )


def _safe_filename(name: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9 _-]+", "", name).strip() or "site"
    return re.sub(r"\s+", "-", cleaned)[:60]


@router.get("/analyser/report/pdf")
async def analyser_report(
    session_id: str,
    date_from: str | None = None,
    date_to: str | None = None,
    exclude_holidays: bool = True,
    night_start_slot: int = Query(hh_analytics.DEFAULT_NIGHT_START_SLOT, ge=0, le=47),
    night_end_slot: int = Query(hh_analytics.DEFAULT_NIGHT_END_SLOT, ge=0, le=48),
    week_a: str | None = None,
    week_b: str | None = None,
):
    """
    Every analyser chart and the numbers behind it, built from the same
    filters the user has on screen so the document matches what they see.
    """
    session = _session(session_id)
    df = session.consumption
    if df.empty:
        raise HTTPException(422, "There is no data to report on.")

    window = df
    if date_from:
        window = window[window.index >= date_from]
    if date_to:
        window = window[window.index <= date_to]
    if window.empty:
        raise HTTPException(
            422, "No data falls inside the selected dates. Widen the range."
        )

    site_name = session.site_name or session.filename or "Unnamed site"
    whole_period = len(window) == len(df)
    filter_note = (
        f"Covers the whole uploaded period, {len(window)} days."
        if whole_period
        else f"Filtered to {len(window)} days of the {len(df)} uploaded."
    )

    try:
        pdf = build_analyser_report(
            site_name=site_name,
            filename=session.filename,
            date_from=window.index[0].strftime("%d %b %Y"),
            date_to=window.index[-1].strftime("%d %b %Y"),
            summary=hh_analytics.summary_stats(window),
            profile=hh_analytics.day_of_week_profile(
                df, date_from, date_to, exclude_holidays),
            ldc=hh_analytics.load_duration_curve(df, date_from, date_to),
            day_night=hh_analytics.day_night_split(
                df, date_from, date_to, night_start_slot, night_end_slot),
            week_a=hh_analytics.week_profile(df, week_a),
            week_b=hh_analytics.week_profile(df, week_b) if week_b else None,
            # Fewer points for print, thinned by day inside the analytics
            # so every half hour still appears.
            scatter=hh_analytics.full_year_scatter(
                window, exclude_holidays, max_points=2400),
            exclude_holidays=exclude_holidays,
            filter_note=filter_note,
        )
    except Exception as e:
        raise HTTPException(500, f"Could not build the report: {e}")

    name = f"{_safe_filename(site_name)}-hh-analysis.pdf"
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={
            "Content-Disposition": (
                f'attachment; filename="{name}"; '
                f"filename*=UTF-8\'\'{quote(name)}"
            ),
            "Content-Length": str(len(pdf)),
        },
    )
