import uuid
from fastapi import APIRouter, UploadFile, File, HTTPException

from app.models.schemas import UploadResponse, MonthlyTotal, HeatmapData
from app.services.excel_parser import load_and_normalise
from app.services.usage_analytics import monthly_totals, heatmap_matrix
from app.state import SESSION_STORE

router = APIRouter()


@router.post("/upload", response_model=UploadResponse)
async def upload_hh_data(file: UploadFile = File(...)):
    if not file.filename or not file.filename.lower().endswith((".xlsx", ".xls")):
        raise HTTPException(400, "Only .xlsx and .xls files are accepted.")

    contents = await file.read()
    if len(contents) == 0:
        raise HTTPException(400, "Uploaded file is empty.")

    try:
        df, fmt, warnings = load_and_normalise(contents)
    except Exception as e:
        raise HTTPException(422, f"Could not parse Excel file: {e}")

    session_id = str(uuid.uuid4())
    SESSION_STORE[session_id] = df

    totals = monthly_totals(df)
    hm = heatmap_matrix(df)

    return UploadResponse(
        session_id=session_id,
        detected_format=fmt,
        days_parsed=len(df),
        annual_kwh=round(df.values.sum(), 1),
        monthly_totals=[MonthlyTotal(**t) for t in totals],
        heatmap=HeatmapData(**hm),
        warnings=warnings,
    )
