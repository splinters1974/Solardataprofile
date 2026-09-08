"""
Financial appraisal for a PV array sized against real half-hourly demand.

Every rate here is a default the user can override on the form. They are
starting points for a first-pass appraisal, not Ameresco pricing.
"""

from dataclasses import dataclass, field

DEFAULT_CAPEX_PER_KWP = 800.0      # £/kWp installed, rooftop, inclusive of margin
DEFAULT_IMPORT_PRICE_P = 25.0      # p/kWh, fully inclusive customer purchase price
DEFAULT_EXPORT_PRICE_P = 5.0       # p/kWh, assumed export rate
DEFAULT_OPEX_PER_KWP = 10.0        # £/kWp/year, O&M, monitoring, insurance
DEFAULT_IMPORT_INFLATION = 0.02    # 2%/year on the price the customer avoids
DEFAULT_EXPORT_INFLATION = 0.0     # export held flat unless told otherwise
DEFAULT_OPEX_INFLATION = 0.03      # 3%/year on operating cost
DEFAULT_DISCOUNT_RATE = 0.035      # HM Treasury Green Book social discount rate
DEFAULT_SYSTEM_LIFE_YEARS = 25
DEFAULT_DEGRADATION = 0.005        # 0.5%/year output loss
DEFAULT_CARBON_FACTOR = 0.196      # kgCO2e/kWh displaced grid electricity


@dataclass
class Assumptions:
    """
    Every rate is overridable on the form; these are the house defaults.

    Import and operating costs inflate at different rates on purpose: the
    saving grows with the energy price the customer avoids, while the cost
    of running the array grows with general cost inflation, and the two are
    not the same number.
    """

    import_price_p_kwh: float = DEFAULT_IMPORT_PRICE_P
    export_price_p_kwh: float = DEFAULT_EXPORT_PRICE_P
    capex_per_kwp: float = DEFAULT_CAPEX_PER_KWP
    opex_per_kwp_year: float = DEFAULT_OPEX_PER_KWP
    import_price_inflation: float = DEFAULT_IMPORT_INFLATION
    export_price_inflation: float = DEFAULT_EXPORT_INFLATION
    opex_inflation: float = DEFAULT_OPEX_INFLATION
    discount_rate: float = DEFAULT_DISCOUNT_RATE
    system_life_years: int = DEFAULT_SYSTEM_LIFE_YEARS
    degradation_rate: float = DEFAULT_DEGRADATION
    carbon_factor: float = DEFAULT_CARBON_FACTOR

    def capex_rate(self, kwp: float) -> float:
        """
        £/kWp installed. Flat: a single rate inclusive of margin, rather
        than a size-tiered curve, because that is how the price is quoted.
        """
        return float(self.capex_per_kwp)


@dataclass
class Appraisal:
    capex: float
    capex_per_kwp: float
    year_one_saving: float
    year_one_import_saving: float
    year_one_export_income: float
    annual_opex: float
    lifetime_saving: float
    npv: float
    irr: float | None
    simple_payback_years: float | None
    discounted_payback_years: float | None
    lcoe_p_kwh: float | None
    carbon_saved_tonnes_year: float
    cashflow: list[float] = field(default_factory=list)


def _npv(rate: float, cashflow: list[float]) -> float:
    return sum(cf / (1.0 + rate) ** i for i, cf in enumerate(cashflow))


def _irr(cashflow: list[float]) -> float | None:
    """
    Bisection on the discount rate. Returns None when the project never
    pays back, which is a real outcome worth showing rather than hiding.
    """
    if not cashflow or cashflow[0] >= 0:
        return None
    if sum(cashflow) <= 0:
        return None

    low, high = -0.9499, 10.0
    f_low = _npv(low, cashflow)
    f_high = _npv(high, cashflow)
    if f_low * f_high > 0:
        return None

    for _ in range(200):
        mid = (low + high) / 2.0
        f_mid = _npv(mid, cashflow)
        if abs(f_mid) < 1e-6:
            return mid
        if f_low * f_mid < 0:
            high, f_high = mid, f_mid
        else:
            low, f_low = mid, f_mid
    return (low + high) / 2.0


def _payback(cashflow: list[float], rate: float = 0.0) -> float | None:
    """Years to cumulative break-even, interpolated within the crossing year."""
    cumulative = 0.0
    for year, cf in enumerate(cashflow):
        discounted = cf / (1.0 + rate) ** year
        previous = cumulative
        cumulative += discounted
        if year > 0 and previous < 0 <= cumulative and discounted > 0:
            return round(year - 1 + (-previous / discounted), 1)
    return None


def appraise(
    kwp: float,
    self_consumed_kwh: float,
    exported_kwh: float,
    assumptions: Assumptions,
) -> Appraisal:
    """Build the cashflow for one system size and derive the headline metrics."""
    capex_rate = assumptions.capex_rate(kwp)
    capex = capex_rate * kwp
    opex = assumptions.opex_per_kwp_year * kwp

    import_saving = self_consumed_kwh * assumptions.import_price_p_kwh / 100.0
    export_income = exported_kwh * assumptions.export_price_p_kwh / 100.0
    year_one_saving = import_saving + export_income - opex

    # Each stream escalates on its own rate. Lumping them together under one
    # inflation figure would tie the customer's avoided energy price to the
    # cost of maintaining the array, which are unrelated.
    cashflow = [-capex]
    for year in range(1, assumptions.system_life_years + 1):
        output = (1.0 - assumptions.degradation_rate) ** (year - 1)
        cashflow.append(
            import_saving * output
            * (1.0 + assumptions.import_price_inflation) ** (year - 1)
            + export_income * output
            * (1.0 + assumptions.export_price_inflation) ** (year - 1)
            - opex * (1.0 + assumptions.opex_inflation) ** (year - 1)
        )

    npv = _npv(assumptions.discount_rate, cashflow)

    # LCOE: whole-life cost over whole-life output, discounted consistently.
    disc_costs = capex + sum(
        opex * (1.0 + assumptions.opex_inflation) ** (y - 1)
        / (1.0 + assumptions.discount_rate) ** y
        for y in range(1, assumptions.system_life_years + 1)
    )
    disc_output = sum(
        (self_consumed_kwh + exported_kwh)
        * (1.0 - assumptions.degradation_rate) ** (y - 1)
        / (1.0 + assumptions.discount_rate) ** y
        for y in range(1, assumptions.system_life_years + 1)
    )
    lcoe = round(disc_costs / disc_output * 100.0, 2) if disc_output > 0 else None

    return Appraisal(
        capex=round(capex, 0),
        capex_per_kwp=round(capex_rate, 0),
        year_one_saving=round(year_one_saving, 0),
        year_one_import_saving=round(import_saving, 0),
        year_one_export_income=round(export_income, 0),
        annual_opex=round(opex, 0),
        lifetime_saving=round(sum(cashflow[1:]), 0),
        npv=round(npv, 0),
        irr=round(_irr(cashflow), 4) if _irr(cashflow) is not None else None,
        simple_payback_years=_payback(cashflow),
        discounted_payback_years=_payback(cashflow, assumptions.discount_rate),
        lcoe_p_kwh=lcoe,
        carbon_saved_tonnes_year=round(
            (self_consumed_kwh + exported_kwh) * assumptions.carbon_factor / 1000.0, 1
        ),
        cashflow=[round(c, 0) for c in cashflow],
    )
