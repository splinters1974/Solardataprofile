"""
One path from a sizing request to a sizing result.

Both the sizing endpoint and the report endpoint go through here, so a
report rebuilt after a restart is computed exactly the same way as the
result the user saw on screen.
"""

from typing import Any

from app.services.economics import Assumptions
from app.services.postcode_lookup import postcode_to_latlon
from app.services.pvgis_client import fetch_generation_profile
from app.services.session_store import Session
from app.services.solar_sizing import recommend_system_size


class SizingError(Exception):
    """Bad input: the caller can fix this."""


class UpstreamError(Exception):
    """PVGIS or the postcode lookup let us down."""


async def run_sizing(session: Session, request: dict[str, Any]) -> tuple[dict, float, float]:
    """Returns (result, lat, lon)."""
    postcode = request["postcode"]
    target_min = request.get("target_sc_min", 0.70)
    target_max = request.get("target_sc_max", 0.90)

    if target_min > target_max:
        raise SizingError("Minimum self-consumption cannot be higher than the maximum.")

    try:
        lat, lon = await postcode_to_latlon(postcode)
    except ValueError as e:
        raise SizingError(str(e)) from e

    try:
        gen_1kwp = await fetch_generation_profile(
            lat,
            lon,
            tilt=request.get("roof_tilt", 35),
            aspect=request.get("roof_aspect", 0),
        )
    except RuntimeError as e:
        raise UpstreamError(str(e)) from e

    try:
        result = recommend_system_size(
            session.consumption,
            gen_1kwp,
            target_sc_min=target_min,
            target_sc_max=target_max,
            assumptions=Assumptions(**(request.get("assumptions") or {})),
        )
    except ValueError as e:
        raise SizingError(str(e)) from e

    return result, lat, lon
