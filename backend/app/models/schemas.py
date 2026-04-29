from pydantic import BaseModel
from typing import Optional


class MonthlyTotal(BaseModel):
    month: str  # "2023-01"
    kwh: float


class HeatmapData(BaseModel):
    dow_labels: list[str]
    hh_labels: list[str]
    matrix: list[list[float]]  # shape (7, 48)


class DailyPoint(BaseModel):
    date: str   # "2024-01-01"
    kwh: float  # daily total


class HHPoint(BaseModel):
    datetime: str  # "2024-01-01T00:00"
    kwh: float     # half-hourly kWh


class UploadResponse(BaseModel):
    session_id: str
    detected_format: str
    days_parsed: int
    annual_kwh: float
    monthly_totals: list[MonthlyTotal]
    heatmap: HeatmapData
    daily_series: list[DailyPoint]
    hh_series: list[HHPoint]
    warnings: list[str]


class SolarSizeRequest(BaseModel):
    session_id: str
    postcode: str
    target_sc_min: float = 0.80
    target_sc_max: float = 0.90
    roof_tilt: int = 35
    roof_aspect: int = 0  # 0 = south


class MonthlySolarPoint(BaseModel):
    month: str
    generation_kwh: float
    consumption_kwh: float
    self_consumed_kwh: float
    exported_kwh: float


class SizingCurvePoint(BaseModel):
    kwp: float
    sc_rate: float
    annual_generation_kwh: float
    exported_kwh: float
    summer_export_kwh: float


class LocationInfo(BaseModel):
    lat: float
    lon: float
    postcode: str


class SolarSizeResponse(BaseModel):
    recommended_kwp: float
    sc_rate: float
    annual_generation_kwh: float
    self_consumed_kwh: float
    exported_kwh: float
    summer_export_kwh: float
    location: LocationInfo
    monthly_chart: list[MonthlySolarPoint]
    sizing_curve: list[SizingCurvePoint]
    warning: Optional[str] = None
