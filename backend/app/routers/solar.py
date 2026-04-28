from fastapi import APIRouter, HTTPException

from app.models.schemas import (
    SolarSizeRequest,
    SolarSizeResponse,
    MonthlySolarPoint,
    SizingCurvePoint,
    LocationInfo,
)
from app.services.postcode_lookup import postcode_to_latlon
from app.services.pvgis_client import fetch_generation_profile
from app.services.solar_sizing import recommend_system_size
from app.state import SESSION_STORE

router = APIRouter()


@router.post("/solar/size", response_model=SolarSizeResponse)
async def size_solar_system(req: SolarSizeRequest):
    if req.session_id not in SESSION_STORE:
        raise HTTPException(404, "Session not found. Please re-upload your HH data.")

    consumption_df = SESSION_STORE[req.session_id]

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

    result = recommend_system_size(
        consumption_df,
        gen_1kwp,
        target_sc_min=req.target_sc_min,
        target_sc_max=req.target_sc_max,
    )

    return SolarSizeResponse(
        recommended_kwp=result["kwp"],
        sc_rate=result["sc_rate"],
        annual_generation_kwh=result["annual_generation_kwh"],
        self_consumed_kwh=result["self_consumed_kwh"],
        exported_kwh=result["exported_kwh"],
        summer_export_kwh=result["summer_export_kwh"],
        location=LocationInfo(lat=lat, lon=lon, postcode=req.postcode.upper()),
        monthly_chart=[MonthlySolarPoint(**m) for m in result["monthly_chart"]],
        sizing_curve=[SizingCurvePoint(**s) for s in result["sizing_curve"]],
        warning=result.get("warning"),
    )
