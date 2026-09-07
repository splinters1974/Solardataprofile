import re
from urllib.parse import quote

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

from app.services.pdf_report import build_report
from app.state import SESSION_STORE

router = APIRouter()


def _safe_filename(name: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9 _-]+", "", name).strip() or "site"
    return re.sub(r"\s+", "-", cleaned)[:60]


@router.get("/report/pdf")
async def download_report(session_id: str):
    session = SESSION_STORE.get(session_id)
    if session is None:
        raise HTTPException(404, "Session not found. Please re-upload your HH data.")
    if session.last_result is None or session.last_request is None:
        raise HTTPException(
            409, "Run the sizing first — there is nothing to report on yet."
        )

    result = session.last_result
    request = session.last_request
    site_name = session.site_name or "Unnamed site"
    consumption = session.consumption

    try:
        pdf = build_report(
            site_name=site_name,
            postcode=request.postcode.upper(),
            date_from=consumption.index[0].strftime("%d %b %Y"),
            date_to=consumption.index[-1].strftime("%d %b %Y"),
            days_analysed=result["days_analysed"],
            result=result,
            assumptions=result["assumptions"],
            tilt=request.roof_tilt,
            aspect=request.roof_aspect,
            data_warnings=session.warnings,
        )
    except Exception as e:  # a broken report should not read as a lost session
        raise HTTPException(500, f"Could not build the report: {e}")

    filename = f"{_safe_filename(site_name)}-solar-appraisal.pdf"
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={
            "Content-Disposition": (
                f"attachment; filename=\"{filename}\"; "
                f"filename*=UTF-8''{quote(filename)}"
            ),
            "Content-Length": str(len(pdf)),
        },
    )
