import uuid
from fastapi import APIRouter, UploadFile, File, HTTPException

from app.models.schemas import UploadResponse, MonthlyTotal, HeatmapData, DailyPoint, HHPoint
from app.services.excel_parser import load_and_normalise
from app.services.usage_analytics import monthly_totals, heatmap_matrix, daily_series, hh_series
from app.state import SESSION_STORE, Session

router = APIRouter()


ACCEPTED_EXTENSIONS = (".xlsx", ".xlsm", ".xls", ".csv", ".txt")


@router.post("/upload", response_model=UploadResponse)
async def upload_hh_data(file: UploadFile = File(...)):
    filename = file.filename or ""
    if not any(filename.lower().endswith(ext) for ext in ACCEPTED_EXTENSIONS):
        raise HTTPException(
            400,
            f"Unsupported file type. Please upload an Excel (.xlsx, .xlsm, .xls) or CSV (.csv) file.",
        )

    contents = await file.read()
    if len(contents) == 0:
        raise HTTPException(400, "Uploaded file is empty.")

    try:
        df, fmt, warnings = load_and_normalise(contents, filename=filename)
    except ValueError as e:
        raise HTTPException(422, str(e))
    except Exception as e:
        raise HTTPException(422, f"Could not parse file: {e}")

    SESSION_STORE.purge_expired()

    session_id = str(uuid.uuid4())
    SESSION_STORE.save(session_id, Session(
        consumption=df,
        filename=filename,
        warnings=warnings,
        detected_format=fmt,
    ))

    totals = monthly_totals(df)
    hm = heatmap_matrix(df)
    ds = daily_series(df)
    hhs = hh_series(df)

    return UploadResponse(
        session_id=session_id,
        detected_format=fmt,
        days_parsed=len(df),
        date_from=df.index[0].strftime("%Y-%m-%d"),
        date_to=df.index[-1].strftime("%Y-%m-%d"),
        annual_kwh=round(df.values.sum(), 1),
        monthly_totals=[MonthlyTotal(**t) for t in totals],
        heatmap=HeatmapData(**hm),
        daily_series=[DailyPoint(**d) for d in ds],
        hh_series=[HHPoint(**h) for h in hhs],
        warnings=warnings,
    )
