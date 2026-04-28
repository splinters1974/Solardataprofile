import httpx


async def postcode_to_latlon(postcode: str) -> tuple[float, float]:
    clean = postcode.strip().upper().replace(" ", "")

    async with httpx.AsyncClient(timeout=10) as client:
        try:
            r = await client.get(f"https://api.postcodes.io/postcodes/{clean}")
            if r.status_code == 200:
                data = r.json()["result"]
                return data["latitude"], data["longitude"]
        except Exception:
            pass

    async with httpx.AsyncClient(
        timeout=10,
        headers={"User-Agent": "SolarDataProfile/1.0"},
    ) as client:
        try:
            r = await client.get(
                "https://nominatim.openstreetmap.org/search",
                params={"q": f"{clean}, UK", "format": "json", "limit": 1},
            )
            if r.status_code == 200 and r.json():
                result = r.json()[0]
                return float(result["lat"]), float(result["lon"])
        except Exception:
            pass

    raise ValueError(f"Could not resolve postcode: {postcode}")
