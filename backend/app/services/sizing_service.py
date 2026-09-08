"""
One path from a sizing request to a sizing result.

Both the sizing endpoint and the report endpoint go through here, so a
report rebuilt after a restart is computed exactly the same way as the
result the user saw on screen.
"""

from typing import Any

from app.services.economics import Assumptions
from app.services.postcode_lookup import postcode_to_latlon
from app.services.pvgis_client import fetch_generation_profile, yield_sanity_warning
from app.services.session_store import Session
from app.services.solar_sizing import recommend_system_size


class SizingError(Exception):
    """Bad input: the caller can fix this."""


class UpstreamError(Exception):
    """PVGIS or the postcode lookup let us down."""


async def run_sizing(session: Session, request: dict[str, Any]) -> tuple[dict, float, float]:
    """Returns (result, lat, lon)."""
    postcode = request["postcode"]
    tilt = request.get("roof_tilt", 35)
    aspect = request.get("roof_aspect", 0)

    try:
        lat, lon = await postcode_to_latlon(postcode)
    except ValueError as e:
        raise SizingError(str(e)) from e

    try:
        gen_1kwp = await fetch_generation_profile(lat, lon, tilt=tilt, aspect=aspect)
    except RuntimeError as e:
        raise UpstreamError(str(e)) from e

    try:
        result = recommend_system_size(
            session.consumption,
            gen_1kwp,
            max_payback_years=request.get("max_payback_years", 8.0),
            min_sc_rate=request.get("min_sc_rate", 0.50),
            assumptions=Assumptions(**(request.get("assumptions") or {})),
        )
    except ValueError as e:
        raise SizingError(str(e)) from e

    # Carried alongside the sizing warning, not merged into it: one is about
    # the site, the other is about whether to trust any of these numbers.
    result["yield_warning"] = yield_sanity_warning(gen_1kwp, tilt, aspect)

    return result, lat, lon
