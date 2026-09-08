"""Ameresco HH Analyser endpoints."""

from fastapi import APIRouter, HTTPException, Query

from app.services import hh_analytics
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
