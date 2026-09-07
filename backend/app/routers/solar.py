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
from app.services.economics import Assumptions
from app.services.postcode_lookup import postcode_to_latlon
from app.services.pvgis_client import fetch_generation_profile
from app.services.solar_sizing import recommend_system_size
from app.state import SESSION_STORE

router = APIRouter()


def _curve_point(r: dict) -> SizingCurvePoint:
    return SizingCurvePoint(**{k: v for k, v in r.items() if not k.startswith("_")
                               and k in SizingCurvePoint.model_fields})


@router.post("/solar/size", response_model=SolarSizeResponse)
async def size_solar_system(req: SolarSizeRequest):
    session = SESSION_STORE.get(req.session_id)
    if session is None:
        raise HTTPException(404, "Session not found. Please re-upload your HH data.")

    if req.target_sc_min > req.target_sc_max:
        raise HTTPException(
            422, "Minimum self-consumption cannot be higher than the maximum."
        )

    try:
        lat, lon = await postcode_to_latlon(req.postcode)
    except ValueError as e:
        raise HTTPException(422, str(e))

    try:
        gen_1kwp = await fetch_generation_profile(
            lat, lon, tilt=req.roof_tilt, aspect=req.roof_aspect
        )
    except RuntimeError as e:
        raise HTTPException(502, str(e))

    try:
        result = recommend_system_size(
            session.consumption,
            gen_1kwp,
            target_sc_min=req.target_sc_min,
            target_sc_max=req.target_sc_max,
            assumptions=Assumptions(**req.assumptions.model_dump()),
        )
    except ValueError as e:
        raise HTTPException(422, str(e))

    if req.site_name:
        session.site_name = req.site_name
    session.last_result = result
    session.last_request = req

    appraisal = asdict(result["_appraisal"])

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
        economics=Economics(**appraisal),
        location=LocationInfo(lat=lat, lon=lon, postcode=req.postcode.upper()),
        monthly_chart=[MonthlySolarPoint(**m) for m in result["monthly_chart"]],
        sizing_curve=[_curve_point(s) for s in result["sizing_curve"]],
        alternative_max_onsite=(
            _curve_point(result["alternative_max_onsite"])
            if result.get("alternative_max_onsite")
            else None
        ),
        warning=result.get("warning"),
    )
