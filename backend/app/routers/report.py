import re
from urllib.parse import quote

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

from app.services.pdf_report import build_report
from app.services.sizing_service import SizingError, UpstreamError, run_sizing
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
    if session.last_request is None:
        raise HTTPException(
            409, "Run the sizing first — there is nothing to report on yet."
        )

    # After a restart the computed result is gone but the inputs survive, so
    # rebuild it rather than sending the user back to the sizing form. The
    # PVGIS profile is cached, so this is fast.
    result = session.last_result
    if result is None:
        try:
            result, _lat, _lon = await run_sizing(session, session.last_request)
        except SizingError as e:
            raise HTTPException(422, str(e))
        except UpstreamError as e:
            raise HTTPException(502, str(e))
        session.last_result = result
        SESSION_STORE.touch(session_id, session)

    request = session.last_request
    site_name = session.site_name or "Unnamed site"
    consumption = session.consumption

    try:
        pdf = build_report(
            site_name=site_name,
            postcode=request["postcode"].upper(),
            date_from=consumption.index[0].strftime("%d %b %Y"),
            date_to=consumption.index[-1].strftime("%d %b %Y"),
            days_analysed=result["days_analysed"],
            result=result,
            assumptions=result["assumptions"],
            tilt=request.get("roof_tilt", 35),
            aspect=request.get("roof_aspect", 0),
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
