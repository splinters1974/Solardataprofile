from pydantic import BaseModel, Field
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
    filename: str = ""
    date_from: Optional[str] = None
    date_to: Optional[str] = None
    monthly_totals: list[MonthlyTotal]
    heatmap: HeatmapData
    daily_series: list[DailyPoint]
    hh_series: list[HHPoint]
    warnings: list[str]


class EconomicAssumptions(BaseModel):
    """All editable on the form. Defaults are the house assumptions."""

    import_price_p_kwh: float = Field(25.0, gt=0, le=200)
    export_price_p_kwh: float = Field(5.0, ge=0, le=200)
    # Blank means use the banded size curve in economics.py. A number here
    # overrides the whole curve with one flat rate.
    capex_per_kwp: Optional[float] = Field(None, gt=0, le=10_000)
    opex_per_kwp_year: float = Field(10.0, ge=0, le=500)
    import_price_inflation: float = Field(0.02, ge=-0.1, le=0.25)
    export_price_inflation: float = Field(0.0, ge=-0.1, le=0.25)
    opex_inflation: float = Field(0.03, ge=-0.1, le=0.25)
    discount_rate: float = Field(0.035, ge=0, le=0.5)
    system_life_years: int = Field(25, ge=5, le=40)
    degradation_rate: float = Field(0.005, ge=0, le=0.05)
    carbon_factor: float = Field(0.196, ge=0, le=2)


class SolarSizeRequest(BaseModel):
    session_id: str
    postcode: str
    max_payback_years: float = Field(8.0, gt=0, le=40)
    min_sc_rate: float = Field(0.50, gt=0, le=1)
    roof_tilt: int = Field(35, ge=0, le=90)
    roof_aspect: int = Field(0, ge=-180, le=180)  # 0 = south
    site_name: Optional[str] = None
    assumptions: EconomicAssumptions = EconomicAssumptions()


class MonthlySolarPoint(BaseModel):
    month: str
    generation_kwh: float
    consumption_kwh: float
    self_consumed_kwh: float
    exported_kwh: float


class SizingCurvePoint(BaseModel):
    kwp: float
    sc_rate: float
    offset_rate: float = 0.0
    annual_generation_kwh: float
    self_consumed_kwh: float = 0.0
    exported_kwh: float
    summer_export_kwh: float
    capex: float = 0.0
    year_one_saving: float = 0.0
    simple_payback_years: Optional[float] = None
    npv: float = 0.0
    irr: Optional[float] = None


class Economics(BaseModel):
    capex: float
    capex_per_kwp: float
    year_one_saving: float
    year_one_import_saving: float
    year_one_export_income: float
    annual_opex: float
    lifetime_saving: float
    npv: float
    irr: Optional[float] = None
    simple_payback_years: Optional[float] = None
    discounted_payback_years: Optional[float] = None
    lcoe_p_kwh: Optional[float] = None
    carbon_saved_tonnes_year: float
    cashflow: list[float]


class LocationInfo(BaseModel):
    lat: float
    lon: float
    postcode: str


class SolarSizeResponse(BaseModel):
    recommended_kwp: float
    sc_rate: float
    offset_rate: float = 0.0
    annual_consumption_kwh: float = 0.0
    annual_generation_kwh: float
    self_consumed_kwh: float
    exported_kwh: float
    summer_export_kwh: float
    days_analysed: int = 0
    economics: Economics
    location: LocationInfo
    annual_yield_kwh_per_kwp: float = 0.0
    monthly_chart: list[MonthlySolarPoint]
    sizing_curve: list[SizingCurvePoint]
    alternative_best_payback: Optional[SizingCurvePoint] = None
    warning: Optional[str] = None
    yield_warning: Optional[str] = None
