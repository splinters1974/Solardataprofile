"""
Client-facing PDF of the sizing result.

Built with reportlab rather than a headless browser: no system libraries, no
Chromium, so it runs inside Render's free-tier memory budget.
"""

import io
from datetime import date

from reportlab.graphics.charts.barcharts import VerticalBarChart
from reportlab.graphics.charts.lineplots import LinePlot
from reportlab.graphics.charts.legends import Legend
from reportlab.graphics.shapes import Drawing, String
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    KeepTogether,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)

BRAND = colors.HexColor("#0f766e")
BRAND_LIGHT = colors.HexColor("#14b8a6")
ACCENT = colors.HexColor("#f59e0b")
INK = colors.HexColor("#1e293b")
MUTED = colors.HexColor("#64748b")
RULE = colors.HexColor("#e2e8f0")
PANEL = colors.HexColor("#f8fafc")

DISCLAIMER = (
    "This report is an indicative desktop appraisal produced from the "
    "half-hourly consumption data supplied and modelled irradiance for the "
    "site postcode. It is not a design, a quotation, or a guarantee of "
    "performance. Generation is modelled from PVGIS using a typical "
    "meteorological year, so actual output will vary year to year. Costs, "
    "tariffs and discount rates are the assumptions listed in this report "
    "and should be replaced with project-specific figures before the "
    "numbers are relied on. No allowance has been made for roof area, "
    "structural capacity, shading surveys, grid connection constraints or "
    "planning."
)


def _styles() -> dict:
    base = getSampleStyleSheet()
    return {
        "title": ParagraphStyle(
            "title", parent=base["Title"], fontName="Helvetica-Bold",
            fontSize=24, leading=28, textColor=INK, alignment=0, spaceAfter=2,
        ),
        "subtitle": ParagraphStyle(
            "subtitle", parent=base["Normal"], fontName="Helvetica",
            fontSize=11, leading=15, textColor=MUTED, spaceAfter=14,
        ),
        "h2": ParagraphStyle(
            "h2", parent=base["Heading2"], fontName="Helvetica-Bold",
            fontSize=13, leading=16, textColor=BRAND, spaceBefore=16, spaceAfter=8,
        ),
        "body": ParagraphStyle(
            "body", parent=base["Normal"], fontName="Helvetica",
            fontSize=9.5, leading=14, textColor=INK, spaceAfter=6,
        ),
        "small": ParagraphStyle(
            "small", parent=base["Normal"], fontName="Helvetica",
            fontSize=7.5, leading=10.5, textColor=MUTED,
        ),
        "headline_num": ParagraphStyle(
            "headline_num", parent=base["Normal"], fontName="Helvetica-Bold",
            fontSize=19, leading=22, textColor=BRAND, alignment=TA_CENTER,
        ),
        "headline_lbl": ParagraphStyle(
            "headline_lbl", parent=base["Normal"], fontName="Helvetica",
            fontSize=7.5, leading=10, textColor=MUTED, alignment=TA_CENTER,
        ),
    }


def _money(v: float | None) -> str:
    if v is None:
        return "n/a"
    return f"-£{abs(v):,.0f}" if v < 0 else f"£{v:,.0f}"


def _kwh(v: float | None) -> str:
    return "n/a" if v is None else f"{v:,.0f} kWh"


def _pct(v: float | None, dp: int = 1) -> str:
    return "n/a" if v is None else f"{v * 100:.{dp}f}%"


def _years(v: float | None) -> str:
    return "Never" if v is None else f"{v:.1f} yrs"


def _headline_band(styles, cells: list[tuple[str, str]]) -> Table:
    row = [
        [Paragraph(value, styles["headline_num"]) for value, _ in cells],
        [Paragraph(label, styles["headline_lbl"]) for _, label in cells],
    ]
    width = (A4[0] - 40 * mm) / len(cells)
    table = Table(row, colWidths=[width] * len(cells), rowHeights=[26, 14])
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), PANEL),
        ("BOX", (0, 0), (-1, -1), 0.6, RULE),
        ("LINEBEFORE", (1, 0), (-1, -1), 0.6, RULE),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, 0), 8),
        ("BOTTOMPADDING", (0, 1), (-1, 1), 8),
    ]))
    return table


def _data_table(rows: list[list[str]], widths: list[float], header=True) -> Table:
    table = Table(rows, colWidths=widths, repeatRows=1 if header else 0)
    style = [
        ("FONTNAME", (0, 0), (-1, -1), "Helvetica"),
        ("FONTSIZE", (0, 0), (-1, -1), 8.5),
        ("TEXTCOLOR", (0, 0), (-1, -1), INK),
        ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 7),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("LINEBELOW", (0, 0), (-1, -2), 0.4, RULE),
        ("BOX", (0, 0), (-1, -1), 0.6, RULE),
    ]
    if header:
        style += [
            ("BACKGROUND", (0, 0), (-1, 0), BRAND),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("ALIGN", (0, 0), (0, -1), "LEFT"),
        ]
        style.append(("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, PANEL]))
    else:
        style.append(("ROWBACKGROUNDS", (0, 0), (-1, -1), [colors.white, PANEL]))
        style.append(("ALIGN", (0, 0), (0, -1), "LEFT"))
    table.setStyle(TableStyle(style))
    return table


def _monthly_chart(monthly: list[dict]) -> Drawing:
    """Consumption against self-consumed and exported generation, by month."""
    width, height = 480, 210
    drawing = Drawing(width, height)

    months = [m["month"] for m in monthly]
    consumption = [m["consumption_kwh"] for m in monthly]
    self_used = [m["self_consumed_kwh"] for m in monthly]
    exported = [m["exported_kwh"] for m in monthly]

    chart = VerticalBarChart()
    chart.x, chart.y = 44, 46
    chart.width, chart.height = width - 70, height - 76
    chart.data = [consumption, self_used, exported]
    chart.categoryAxis.categoryNames = months
    chart.categoryAxis.labels.fontName = "Helvetica"
    chart.categoryAxis.labels.fontSize = 7
    chart.categoryAxis.labels.angle = 0 if len(months) <= 13 else 90
    chart.categoryAxis.labels.dy = -3
    chart.valueAxis.valueMin = 0
    chart.valueAxis.labels.fontName = "Helvetica"
    chart.valueAxis.labels.fontSize = 7
    chart.valueAxis.labelTextFormat = lambda v: f"{v / 1000:,.0f}k" if v >= 1000 else f"{v:,.0f}"
    chart.bars[0].fillColor = colors.HexColor("#cbd5e1")
    chart.bars[1].fillColor = BRAND
    chart.bars[2].fillColor = ACCENT
    for i in range(3):
        chart.bars[i].strokeWidth = 0
    chart.groupSpacing = 6
    chart.barSpacing = 0.5
    drawing.add(chart)

    legend = Legend()
    legend.x, legend.y = 44, 16
    legend.alignment = "right"
    legend.fontName = "Helvetica"
    legend.fontSize = 7.5
    legend.columnMaximum = 1
    legend.deltax = 108
    legend.dxTextSpace = 5
    legend.boxAnchor = "sw"
    legend.colorNamePairs = [
        (colors.HexColor("#cbd5e1"), "Site consumption"),
        (BRAND, "Solar used on site"),
        (ACCENT, "Exported"),
    ]
    drawing.add(legend)
    drawing.add(String(0, height - 12, "Monthly energy balance (kWh)",
                       fontName="Helvetica-Bold", fontSize=9.5, fillColor=INK))
    return drawing


def _payback_chart(curve: list[dict], chosen_kwp: float) -> Drawing:
    """Payback and self-consumption against array size, so the choice is visible."""
    width, height = 480, 210
    drawing = Drawing(width, height)

    points = [p for p in curve if p.get("simple_payback_years") is not None]
    if not points:
        drawing.add(String(0, height / 2, "Payback could not be calculated.",
                           fontName="Helvetica", fontSize=9, fillColor=MUTED))
        return drawing

    payback = [(p["kwp"], p["simple_payback_years"]) for p in points]
    sc = [(p["kwp"], p["sc_rate"] * 100) for p in points]

    max_pay = max(v for _, v in payback)
    max_sc = 100.0
    scale = max_pay / max_sc if max_sc else 1.0
    sc_scaled = [(k, v * scale) for k, v in sc]

    chosen = next((p for p in points if p["kwp"] == chosen_kwp), None)
    marker = [(chosen["kwp"], chosen["simple_payback_years"])] if chosen else []

    plot = LinePlot()
    plot.x, plot.y = 44, 44
    plot.width, plot.height = width - 78, height - 76
    plot.data = [payback, sc_scaled] + ([marker] if marker else [])
    plot.lines[0].strokeColor = BRAND
    plot.lines[0].strokeWidth = 1.8
    plot.lines[1].strokeColor = colors.HexColor("#94a3b8")
    plot.lines[1].strokeWidth = 1.2
    plot.lines[1].strokeDashArray = (3, 2)
    if marker:
        plot.lines[2].strokeColor = colors.transparent
        plot.lines[2].symbol = None
        plot.lines[2].strokeWidth = 0
    plot.xValueAxis.valueMin = 0
    plot.xValueAxis.labels.fontName = "Helvetica"
    plot.xValueAxis.labels.fontSize = 7
    plot.xValueAxis.labelTextFormat = "%0.0f"
    plot.yValueAxis.valueMin = 0
    plot.yValueAxis.labels.fontName = "Helvetica"
    plot.yValueAxis.labels.fontSize = 7
    plot.yValueAxis.labelTextFormat = "%0.0f"
    drawing.add(plot)

    drawing.add(String(0, height - 12,
                       "Payback and self-consumption against array size",
                       fontName="Helvetica-Bold", fontSize=9.5, fillColor=INK))
    drawing.add(String(44, 26, "Array size (kWp)  |  solid line: simple payback (years, "
                               "left axis)  |  dashed line: self-consumption, 0-100% scaled",
                       fontName="Helvetica", fontSize=7, fillColor=MUTED))
    if chosen:
        drawing.add(String(
            44, 12,
            f"Recommended: {chosen['kwp']:,.0f} kWp at "
            f"{chosen['simple_payback_years']:.1f} year payback and "
            f"{chosen['sc_rate'] * 100:.0f}% self-consumption",
            fontName="Helvetica-Bold", fontSize=7.5, fillColor=BRAND))
    return drawing


def build_report(
    *,
    site_name: str,
    postcode: str,
    date_from: str,
    date_to: str,
    days_analysed: int,
    result: dict,
    assumptions,
    tilt: int,
    aspect: int,
    data_warnings: list[str],
) -> bytes:
    styles = _styles()
    appraisal = result["_appraisal"]
    buffer = io.BytesIO()

    def decorate(canvas, doc):
        canvas.saveState()
        canvas.setFillColor(BRAND)
        canvas.rect(0, A4[1] - 6 * mm, A4[0], 6 * mm, stroke=0, fill=1)
        canvas.setFont("Helvetica", 7.5)
        canvas.setFillColor(MUTED)
        canvas.drawString(20 * mm, 12 * mm, f"{site_name} — solar sizing appraisal")
        canvas.drawRightString(A4[0] - 20 * mm, 12 * mm, f"Page {doc.page}")
        canvas.setStrokeColor(RULE)
        canvas.line(20 * mm, 15 * mm, A4[0] - 20 * mm, 15 * mm)
        canvas.restoreState()

    doc = BaseDocTemplate(
        buffer, pagesize=A4,
        leftMargin=20 * mm, rightMargin=20 * mm,
        topMargin=18 * mm, bottomMargin=20 * mm,
        title=f"{site_name} — Solar Sizing Appraisal",
        author="Solar Data Profile",
    )
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="main")
    doc.addPageTemplates([PageTemplate(id="all", frames=[frame], onPage=decorate)])

    story = []
    story.append(Paragraph("Solar Sizing Appraisal", styles["title"]))
    story.append(Paragraph(
        f"{site_name} &nbsp;·&nbsp; {postcode} &nbsp;·&nbsp; "
        f"issued {date.today().strftime('%d %B %Y')}",
        styles["subtitle"],
    ))

    story.append(_headline_band(styles, [
        (f"{result['kwp']:,.0f}", "RECOMMENDED kWp"),
        (_years(appraisal.simple_payback_years), "SIMPLE PAYBACK"),
        (_money(appraisal.year_one_saving), "YEAR 1 SAVING"),
        (_pct(result["sc_rate"], 0), "SELF-CONSUMPTION"),
        (f"{appraisal.carbon_saved_tonnes_year:,.0f} t", "CO2e SAVED / YEAR"),
    ]))
    story.append(Spacer(1, 14))

    story.append(Paragraph(
        f"Sized against {days_analysed} days of half-hourly metered consumption "
        f"({date_from} to {date_to}), giving an annualised demand of "
        f"{result['annual_consumption_kwh']:,.0f} kWh. A "
        f"{result['kwp']:,.0f} kWp array on a {tilt}° roof at "
        f"{_aspect_label(aspect)} would generate "
        f"{result['annual_generation_kwh']:,.0f} kWh a year, of which "
        f"{_pct(result['sc_rate'], 0)} is used on site. That meets "
        f"{_pct(result['offset_rate'], 0)} of the site's total electricity demand "
        f"and returns {_money(appraisal.year_one_saving)} in year one against a "
        f"capital cost of {_money(appraisal.capex)}.",
        styles["body"],
    ))

    if result.get("warning"):
        story.append(Spacer(1, 4))
        note = Table([[Paragraph(f"<b>Note:</b> {result['warning']}", styles["body"])]],
                     colWidths=[doc.width])
        note.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#fffbeb")),
            ("BOX", (0, 0), (-1, -1), 0.6, ACCENT),
            ("LEFTPADDING", (0, 0), (-1, -1), 9),
            ("RIGHTPADDING", (0, 0), (-1, -1), 9),
            ("TOPPADDING", (0, 0), (-1, -1), 7),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
        ]))
        story.append(note)

    # --- Energy and financial summary -------------------------------------
    story.append(Paragraph("Energy and financial summary", styles["h2"]))
    half = doc.width / 2 - 4
    energy = _data_table([
        ["Energy", "Per year"],
        ["Site consumption", _kwh(result["annual_consumption_kwh"])],
        ["Solar generation", _kwh(result["annual_generation_kwh"])],
        ["Used on site", _kwh(result["self_consumed_kwh"])],
        ["Exported to grid", _kwh(result["exported_kwh"])],
        ["Self-consumption rate", _pct(result["sc_rate"])],
        ["Demand met by solar", _pct(result["offset_rate"])],
        ["Yield", f"{result['annual_generation_kwh'] / result['kwp']:,.0f} kWh/kWp"],
    ], [half * 0.58, half * 0.42])

    financial = _data_table([
        ["Financial", "Value"],
        ["Capital cost", _money(appraisal.capex)],
        ["Cost per kWp", _money(appraisal.capex_per_kwp)],
        ["Year 1 import saving", _money(appraisal.year_one_import_saving)],
        ["Year 1 export income", _money(appraisal.year_one_export_income)],
        ["Annual O&M", _money(appraisal.annual_opex)],
        ["Simple payback", _years(appraisal.simple_payback_years)],
        ["Discounted payback", _years(appraisal.discounted_payback_years)],
    ], [half * 0.58, half * 0.42])

    side_by_side = Table([[energy, financial]], colWidths=[half + 4, half + 4])
    side_by_side.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (0, -1), 8),
    ]))
    story.append(side_by_side)
    story.append(Spacer(1, 10))

    story.append(_data_table([
        ["Whole-life position", f"Over {assumptions.system_life_years} years"],
        ["Net present value", _money(appraisal.npv)],
        ["Internal rate of return",
         "n/a" if appraisal.irr is None else _pct(appraisal.irr)],
        ["Undiscounted lifetime saving", _money(appraisal.lifetime_saving)],
        ["Levelised cost of energy",
         "n/a" if appraisal.lcoe_p_kwh is None
         else f"{appraisal.lcoe_p_kwh:.1f}p/kWh vs "
              f"{assumptions.import_price_p_kwh:.1f}p import"],
        ["Carbon avoided",
         f"{appraisal.carbon_saved_tonnes_year:,.1f} tCO2e/yr "
         f"({appraisal.carbon_saved_tonnes_year * assumptions.system_life_years:,.0f} t lifetime)"],
    ], [doc.width * 0.42, doc.width * 0.58]))

    story.append(PageBreak())

    # --- Charts ------------------------------------------------------------
    story.append(Paragraph("How generation matches demand", styles["h2"]))
    story.append(Paragraph(
        "Grey is what the site draws. Green is solar the site uses as it is "
        "generated, which displaces import at "
        f"{assumptions.import_price_p_kwh:.1f}p/kWh. Amber is surplus exported at "
        f"{assumptions.export_price_p_kwh:.1f}p/kWh. Sizing is driven by keeping "
        "the amber band small enough that the array still pays back quickly.",
        styles["body"],
    ))
    story.append(_monthly_chart(result["monthly_chart"]))
    story.append(Spacer(1, 12))

    story.append(Paragraph("Why this size", styles["h2"]))
    story.append(Paragraph(
        "Payback improves with scale at first, because fixed costs spread over "
        "more panels. Past the point where the site can absorb what the array "
        "makes, surplus is exported at a fraction of the import price and payback "
        "worsens again. The recommendation sits at the turning point, inside the "
        f"{_pct(result.get('target_sc_min', 0.70), 0)} to "
        f"{_pct(result.get('target_sc_max', 0.90), 0)} self-consumption band.",
        styles["body"],
    ))
    story.append(_payback_chart(result["sizing_curve"], result["kwp"]))
    story.append(Spacer(1, 10))

    alt = result.get("alternative_max_onsite")
    if alt:
        story.append(Paragraph("Alternative: maximum energy on site", styles["h2"]))
        story.append(Paragraph(
            f"If the priority is displacing as much grid import as possible "
            f"rather than the shortest payback, {alt['kwp']:,.0f} kWp is the "
            f"largest array that still keeps self-consumption at or above "
            f"{_pct(result.get('target_sc_min', 0.70), 0)}. It generates "
            f"{alt['annual_generation_kwh']:,.0f} kWh a year and uses "
            f"{alt['self_consumed_kwh']:,.0f} kWh on site, at "
            f"{_years(alt['simple_payback_years'])} payback and "
            f"{_money(alt['npv'])} NPV against "
            f"{_years(appraisal.simple_payback_years)} and "
            f"{_money(appraisal.npv)} for the recommendation.",
            styles["body"],
        ))

    story.append(PageBreak())

    # --- Assumptions and cashflow -----------------------------------------
    story.append(Paragraph("Assumptions", styles["h2"]))
    story.append(Paragraph(
        "Replace these with project-specific figures before the numbers are used "
        "in a business case.", styles["body"],
    ))
    story.append(_data_table([
        ["Assumption", "Value"],
        ["Import price", f"{assumptions.import_price_p_kwh:.2f} p/kWh"],
        ["Export price", f"{assumptions.export_price_p_kwh:.2f} p/kWh"],
        ["Installed cost", f"£{appraisal.capex_per_kwp:,.0f} per kWp"],
        ["Operating cost", f"£{assumptions.opex_per_kwp_year:,.2f} per kWp per year"],
        ["Energy price inflation", _pct(assumptions.price_inflation)],
        ["Discount rate", _pct(assumptions.discount_rate)],
        ["System life", f"{assumptions.system_life_years} years"],
        ["Annual output degradation", _pct(assumptions.degradation_rate, 2)],
        ["Grid carbon factor", f"{assumptions.carbon_factor:.3f} kgCO2e/kWh"],
        ["Roof pitch and orientation", f"{tilt}° at {_aspect_label(aspect)}"],
        ["Irradiance source", "PVGIS typical meteorological year"],
        ["Consumption data", f"{days_analysed} days, {date_from} to {date_to}"],
    ], [doc.width * 0.42, doc.width * 0.58]))

    if data_warnings:
        story.append(Paragraph("Data notes", styles["h2"]))
        for item in data_warnings:
            story.append(Paragraph(f"• {item}", styles["body"]))

    story.append(Paragraph("Indicative cashflow", styles["h2"]))
    rows = [["Year", "Net cashflow", "Cumulative"]]
    cumulative = 0.0
    for year, flow in enumerate(appraisal.cashflow):
        cumulative += flow
        rows.append([
            "0 (build)" if year == 0 else str(year),
            _money(flow),
            _money(cumulative),
        ])
    story.append(_data_table(
        rows, [doc.width * 0.2, doc.width * 0.4, doc.width * 0.4]
    ))

    story.append(Spacer(1, 14))
    story.append(KeepTogether([
        Paragraph("Basis and limitations", styles["h2"]),
        Paragraph(DISCLAIMER, styles["small"]),
    ]))

    doc.build(story)
    return buffer.getvalue()


def _aspect_label(aspect: int) -> str:
    names = {
        0: "due south", -45: "south-east", 45: "south-west",
        -90: "east", 90: "west", -135: "north-east", 135: "north-west",
        180: "north", -180: "north",
    }
    return names.get(aspect, f"{aspect}° from south")
