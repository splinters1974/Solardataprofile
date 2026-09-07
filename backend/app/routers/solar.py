from dataclasses import asdict

from fastapi import APIRouter, HTTPException

from app.models.schemas import (
    Economics,
    LocationInfo,
    MonthlySolarPoint,
    SizingCurvePoint,
    SolarSizeRequest,
    SolarSizeResponse,
)
from app.services.sizing_service import SizingError, UpstreamError, run_sizing
from app.state import SESSION_STORE

router = APIRouter()


def _curve_point(r: dict) -> SizingCurvePoint:
    return SizingCurvePoint(
        **{k: v for k, v in r.items() if k in SizingCurvePoint.model_fields}
    )


def build_response(result: dict, lat: float, lon: float, postcode: str) -> SolarSizeResponse:
    return SolarSizeResponse(
        recommended_kwp=result["kwp"],
        sc_rate=result["sc_rate"],
        offset_rate=result["offset_rate"],
        annual_consumption_kwh=result["annual_consumption_kwh"],
        annual_generation_kwh=result["annual_generation_kwh"],
        self_consumed_kwh=result["self_consumed_kwh"],
        exported_kwh=result["exported_kwh"],
        summer_export_kwh=result["summer_export_kwh"],
        days_analysed=result["days_analysed"],
        economics=Economics(**asdict(result["_appraisal"])),
        location=LocationInfo(lat=lat, lon=lon, postcode=postcode.upper()),
        monthly_chart=[MonthlySolarPoint(**m) for m in result["monthly_chart"]],
        sizing_curve=[_curve_point(s) for s in result["sizing_curve"]],
        alternative_max_onsite=(
            _curve_point(result["alternative_max_onsite"])
            if result.get("alternative_max_onsite")
            else None
        ),
        warning=result.get("warning"),
    )


@router.post("/solar/size", response_model=SolarSizeResponse)
async def size_solar_system(req: SolarSizeRequest):
    session = SESSION_STORE.get(req.session_id)
    if session is None:
        raise HTTPException(404, "Session not found. Please re-upload your HH data.")

    request = req.model_dump()

    try:
        result, lat, lon = await run_sizing(session, request)
    except SizingError as e:
        raise HTTPException(422, str(e))
    except UpstreamError as e:
        raise HTTPException(502, str(e))

    if req.site_name:
        session.site_name = req.site_name
    session.last_request = request
    session.last_result = result
    SESSION_STORE.touch(req.session_id, session)

    return build_response(result, lat, lon, req.postcode)
