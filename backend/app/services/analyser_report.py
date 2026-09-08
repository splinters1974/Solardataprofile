"""
PDF of the Half Hourly Data Analyser: every chart plus the numbers behind it.

Built server-side from the same functions the screen uses, so the document
and the page can never disagree. Charts use reportlab's own graphics rather
than a screenshot of the browser, so the output is vector and stays sharp
in print.
"""

import io
from datetime import date

from reportlab.graphics.charts.barcharts import VerticalBarChart
from reportlab.graphics.charts.legends import Legend
from reportlab.graphics.charts.lineplots import LinePlot, ScatterPlot
from reportlab.graphics.shapes import Drawing, String
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    BaseDocTemplate, Frame, PageBreak, PageTemplate, Paragraph, Spacer,
    Table, TableStyle,
)

from app.services import hh_analytics as A

INK = colors.HexColor("#1e293b")
BRAND = colors.HexColor("#1d4ed8")      # blue, matching the analyser tab
MUTED = colors.HexColor("#64748b")
RULE = colors.HexColor("#e2e8f0")
PANEL = colors.HexColor("#f8fafc")

# Weekday family runs cool, weekend and summary lines sit outside it, same
# as on screen so the document reads as the same tool.
SERIES_COLOURS = {
    "Monday": colors.HexColor("#0f766e"), "Tuesday": colors.HexColor("#0d9488"),
    "Wednesday": colors.HexColor("#14b8a6"), "Thursday": colors.HexColor("#2dd4bf"),
    "Friday": colors.HexColor("#5eead4"), "Saturday": colors.HexColor("#f59e0b"),
    "Sunday": colors.HexColor("#ef4444"), "Weekday": colors.HexColor("#1e293b"),
    "Weekend": colors.HexColor("#7c3aed"),
    "Bank holiday": colors.HexColor("#db2777"),
    "Total": colors.HexColor("#64748b"),
}
DAY_COLOURS = [
    colors.HexColor("#0f766e"), colors.HexColor("#0d9488"),
    colors.HexColor("#14b8a6"), colors.HexColor("#2dd4bf"),
    colors.HexColor("#5eead4"), colors.HexColor("#f59e0b"),
    colors.HexColor("#ef4444"),
]

DISCLAIMER = (
    "Produced from the half-hourly consumption data supplied. Demand is shown "
    "in kW, which is twice the kWh recorded in each half hour. Bank holidays "
    "are England and Wales. Figures describe the metered period stated above "
    "and are not weather-corrected or adjusted for changes in occupancy or "
    "operation since."
)


def _styles() -> dict:
    base = getSampleStyleSheet()
    return {
        "title": ParagraphStyle("t", parent=base["Title"], fontName="Helvetica-Bold",
                                fontSize=22, leading=26, textColor=INK,
                                alignment=0, spaceAfter=2),
        "subtitle": ParagraphStyle("s", parent=base["Normal"], fontName="Helvetica",
                                   fontSize=10.5, leading=14, textColor=MUTED,
                                   spaceAfter=12),
        "h2": ParagraphStyle("h2", parent=base["Heading2"], fontName="Helvetica-Bold",
                             fontSize=13, leading=16, textColor=BRAND,
                             spaceBefore=14, spaceAfter=6),
        "body": ParagraphStyle("b", parent=base["Normal"], fontName="Helvetica",
                               fontSize=9.5, leading=13.5, textColor=INK,
                               spaceAfter=6),
        "small": ParagraphStyle("sm", parent=base["Normal"], fontName="Helvetica",
                                fontSize=7.5, leading=10.5, textColor=MUTED),
        "num": ParagraphStyle("n", parent=base["Normal"], fontName="Helvetica-Bold",
                              fontSize=17, leading=20, textColor=BRAND,
                              alignment=TA_CENTER),
        "lbl": ParagraphStyle("l", parent=base["Normal"], fontName="Helvetica",
                              fontSize=7.5, leading=10, textColor=MUTED,
                              alignment=TA_CENTER),
    }


def _tiles(styles, cells: list[tuple[str, str]], width: float) -> Table:
    table = Table(
        [[Paragraph(v, styles["num"]) for v, _ in cells],
         [Paragraph(l, styles["lbl"]) for _, l in cells]],
        colWidths=[width / len(cells)] * len(cells), rowHeights=[24, 14],
    )
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), PANEL),
        ("BOX", (0, 0), (-1, -1), 0.6, RULE),
        ("LINEBEFORE", (1, 0), (-1, -1), 0.6, RULE),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, 0), 7),
        ("BOTTOMPADDING", (0, 1), (-1, 1), 7),
    ]))
    return table


def _table(rows: list[list[str]], widths: list[float], font_size=7.5) -> Table:
    table = Table(rows, colWidths=widths, repeatRows=1)
    table.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (-1, -1), "Helvetica"),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), font_size),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("BACKGROUND", (0, 0), (-1, 0), BRAND),
        ("TEXTCOLOR", (0, 1), (-1, -1), INK),
        ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
        ("ALIGN", (0, 0), (0, -1), "LEFT"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 2.5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2.5),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, PANEL]),
        ("BOX", (0, 0), (-1, -1), 0.6, RULE),
        ("LINEBELOW", (0, 0), (-1, -2), 0.3, RULE),
    ]))
    return table


def _legend(x: float, y: float, pairs, columns=6, width=95) -> Legend:
    legend = Legend()
    legend.x, legend.y = x, y
    legend.boxAnchor = "sw"
    legend.fontName = "Helvetica"
    legend.fontSize = 7
    legend.columnMaximum = max(1, -(-len(pairs) // columns))
    legend.deltax = width
    legend.deltay = 10
    legend.dxTextSpace = 4
    legend.colorNamePairs = pairs
    return legend


def _hh_axis(plot) -> None:
    """Label the x axis in hours rather than 0..47 slot numbers."""
    plot.xValueAxis.valueMin = 0
    plot.xValueAxis.valueMax = 24
    plot.xValueAxis.valueStep = 3
    plot.xValueAxis.labels.fontName = "Helvetica"
    plot.xValueAxis.labels.fontSize = 7
    plot.xValueAxis.labelTextFormat = lambda v: f"{int(v):02d}:00"


def _profile_chart(profile: dict, width=740, height=236) -> Drawing:
    drawing = Drawing(width, height)
    shown = [s for s in profile["series"] if s["group"] == "summary"] + [
        s for s in profile["series"] if s["group"] == "day"
    ]
    if not shown:
        return drawing

    plot = LinePlot()
    plot.x, plot.y = 44, 46
    plot.width, plot.height = width - 70, height - 76
    plot.data = [
        [(i / 2.0, v) for i, v in enumerate(s["values"])] for s in shown
    ]
    for i, s in enumerate(shown):
        plot.lines[i].strokeColor = SERIES_COLOURS.get(s["name"], MUTED)
        plot.lines[i].strokeWidth = 1.8 if s["group"] == "summary" else 0.9
    _hh_axis(plot)
    plot.yValueAxis.valueMin = 0
    plot.yValueAxis.labels.fontName = "Helvetica"
    plot.yValueAxis.labels.fontSize = 7
    drawing.add(plot)
    drawing.add(_legend(44, 8, [
        (SERIES_COLOURS.get(s["name"], MUTED), s["name"]) for s in shown
    ]))
    drawing.add(String(0, height - 12, "Average demand by day of week (kW)",
                       fontName="Helvetica-Bold", fontSize=9.5, fillColor=INK))
    return drawing


def _ldc_chart(ldc: dict, width=740, height=196) -> Drawing:
    drawing = Drawing(width, height)
    if not ldc["curve"]:
        return drawing

    plot = LinePlot()
    plot.x, plot.y = 48, 34
    plot.width, plot.height = width - 74, height - 62
    plot.data = [[(p["hours"], p["kw"]) for p in ldc["curve"]]]
    plot.lines[0].strokeColor = BRAND
    plot.lines[0].strokeWidth = 1.8
    plot.xValueAxis.valueMin = 0
    plot.xValueAxis.valueMax = 8766
    plot.xValueAxis.valueStep = 1000
    plot.xValueAxis.labels.fontName = "Helvetica"
    plot.xValueAxis.labels.fontSize = 7
    plot.xValueAxis.labelTextFormat = lambda v: f"{int(v / 1000)}k"
    plot.yValueAxis.valueMin = 0
    plot.yValueAxis.labels.fontName = "Helvetica"
    plot.yValueAxis.labels.fontSize = 7
    drawing.add(plot)
    drawing.add(String(0, height - 12, "Load duration curve (kW against hours per year)",
                       fontName="Helvetica-Bold", fontSize=9.5, fillColor=INK))
    drawing.add(String(48, 8, "Hours per year at or above this load",
                       fontName="Helvetica", fontSize=7, fillColor=MUTED))
    return drawing


def _day_night_chart(day_night: dict, width=740, height=230) -> Drawing:
    drawing = Drawing(width, height)
    months = day_night["months"]
    if not months:
        return drawing

    chart = VerticalBarChart()
    chart.x, chart.y = 48, 48
    chart.width, chart.height = width - 74, height - 82
    chart.data = [[m["day_kwh"] for m in months], [m["night_kwh"] for m in months]]
    chart.categoryAxis.categoryNames = [m["month"] for m in months]
    chart.categoryAxis.labels.fontName = "Helvetica"
    chart.categoryAxis.labels.fontSize = 6.5
    chart.categoryAxis.labels.angle = 40
    chart.categoryAxis.labels.boxAnchor = "e"
    chart.categoryAxis.labels.dy = -4
    chart.valueAxis.valueMin = 0
    chart.valueAxis.labels.fontName = "Helvetica"
    chart.valueAxis.labels.fontSize = 7
    chart.valueAxis.labelTextFormat = lambda v: (
        f"{v / 1000:,.0f}k" if v >= 1000 else f"{v:,.0f}"
    )
    chart.categoryAxis.style = "stacked"
    chart.bars[0].fillColor = colors.HexColor("#f59e0b")
    chart.bars[1].fillColor = colors.HexColor("#1e293b")
    chart.bars[0].strokeWidth = 0
    chart.bars[1].strokeWidth = 0
    drawing.add(chart)
    drawing.add(_legend(48, 8, [
        (colors.HexColor("#f59e0b"), "Day"),
        (colors.HexColor("#1e293b"), f"Night ({day_night['night_window']})"),
    ], columns=2, width=150))
    drawing.add(String(0, height - 12, "Day and night consumption by month (kWh)",
                       fontName="Helvetica-Bold", fontSize=9.5, fillColor=INK))
    return drawing


def _week_chart(week: dict, title: str, width=740, height=214) -> Drawing:
    drawing = Drawing(width, height)
    if not week["days"]:
        drawing.add(String(0, height / 2, "No data in this week.",
                           fontName="Helvetica", fontSize=9, fillColor=MUTED))
        return drawing

    plot = LinePlot()
    plot.x, plot.y = 44, 44
    plot.width, plot.height = width - 70, height - 74
    plot.data = [
        [(i / 2.0, v) for i, v in enumerate(d["values"])] for d in week["days"]
    ]
    for i in range(len(week["days"])):
        plot.lines[i].strokeColor = DAY_COLOURS[i % len(DAY_COLOURS)]
        plot.lines[i].strokeWidth = 1.3
    _hh_axis(plot)
    plot.yValueAxis.valueMin = 0
    plot.yValueAxis.labels.fontName = "Helvetica"
    plot.yValueAxis.labels.fontSize = 7
    drawing.add(plot)
    drawing.add(_legend(44, 8, [
        (DAY_COLOURS[i % len(DAY_COLOURS)], d["label"])
        for i, d in enumerate(week["days"])
    ], columns=7, width=100))
    drawing.add(String(0, height - 12, title,
                       fontName="Helvetica-Bold", fontSize=9.5, fillColor=INK))
    return drawing


def _scatter_chart(scatter: dict, width=740, height=214) -> Drawing:
    """
    Every reading, at whatever density the caller asked for.

    Do not thin the point list here: it arrives ordered day by day, so
    striding it drops the same half hours on every day and the plot
    collapses into vertical bands. Ask hh_analytics for fewer points
    instead, which thins by whole days and keeps all 48 slots.
    """
    drawing = Drawing(width, height)
    points = scatter["points"]
    if not points:
        return drawing

    groups = [
        ("Weekday", colors.HexColor("#0f766e")),
        ("Weekend", colors.HexColor("#f59e0b")),
        ("Bank holiday", colors.HexColor("#db2777")),
    ]
    series = [[(p["hour"], p["kw"]) for p in points if p["type"] == name]
              for name, _ in groups]
    present = [(s, g) for s, g in zip(series, groups) if s]
    if not present:
        return drawing

    plot = ScatterPlot()
    plot.x, plot.y = 44, 44
    plot.width, plot.height = width - 76, height - 76
    plot.data = [s for s, _ in present]
    plot.joinedLines = 0
    for i, (_, (_, colour)) in enumerate(present):
        plot.lines[i].strokeColor = colour
        plot.lines[i].symbol.kind = "FilledCircle"
        plot.lines[i].symbol.size = 1.1
        plot.lines[i].symbol.fillColor = colour
        plot.lines[i].symbol.strokeColor = colour
    # reportlab prints a numeric label beside every point by default, which
    # at these densities is a solid black smudge over the whole plot.
    plot.lineLabelFormat = None
    plot.xLabel = ""
    plot.yLabel = ""
    plot.outerBorderOn = 0
    _hh_axis(plot)
    plot.yValueAxis.valueMin = 0
    plot.yValueAxis.labels.fontName = "Helvetica"
    plot.yValueAxis.labels.fontSize = 7
    drawing.add(plot)
    drawing.add(_legend(44, 8, [(c, n) for _, (n, c) in present],
                        columns=3, width=110))
    drawing.add(String(0, height - 12,
                       "Every half-hourly reading, load against time of day (kW)",
                       fontName="Helvetica-Bold", fontSize=9.5, fillColor=INK))
    return drawing


def _fmt(v: float, dp: int = 0) -> str:
    return f"{v:,.{dp}f}"


def build_analyser_report(
    *,
    site_name: str,
    filename: str,
    date_from: str,
    date_to: str,
    summary: dict,
    profile: dict,
    ldc: dict,
    day_night: dict,
    week_a: dict,
    week_b: dict,
    scatter: dict,
    exclude_holidays: bool,
    filter_note: str,
) -> bytes:
    styles = _styles()
    buffer = io.BytesIO()
    page = landscape(A4)  # wide charts read far better across a landscape page

    def decorate(canvas, doc):
        canvas.saveState()
        canvas.setFillColor(BRAND)
        canvas.rect(0, page[1] - 5 * mm, page[0], 5 * mm, stroke=0, fill=1)
        canvas.setFont("Helvetica", 7.5)
        canvas.setFillColor(MUTED)
        canvas.drawString(15 * mm, 10 * mm,
                          f"{site_name} — half hourly data analysis")
        canvas.drawRightString(page[0] - 15 * mm, 10 * mm, f"Page {doc.page}")
        canvas.setStrokeColor(RULE)
        canvas.line(15 * mm, 13 * mm, page[0] - 15 * mm, 13 * mm)
        canvas.restoreState()

    doc = BaseDocTemplate(
        buffer, pagesize=page,
        leftMargin=15 * mm, rightMargin=15 * mm,
        topMargin=14 * mm, bottomMargin=17 * mm,
        title=f"{site_name} — Half Hourly Data Analysis",
        author="Half Hourly Data Analyser",
    )
    doc.addPageTemplates([PageTemplate(
        id="all",
        frames=[Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height)],
        onPage=decorate,
    )])
    W = doc.width

    story: list = [
        Paragraph("Half Hourly Data Analysis", styles["title"]),
        Paragraph(
            f"{site_name} &nbsp;·&nbsp; {date_from} to {date_to} &nbsp;·&nbsp; "
            f"issued {date.today().strftime('%d %B %Y')}",
            styles["subtitle"],
        ),
        _tiles(styles, [
            (f"{_fmt(summary['peak_kw'])} kW", "PEAK DEMAND"),
            (f"{_fmt(summary['average_kw'])} kW", "AVERAGE DEMAND"),
            (f"{summary['load_factor'] * 100:.0f}%", "LOAD FACTOR"),
            (f"{_fmt(summary['total_kwh'])}", "TOTAL kWh"),
            (f"{_fmt(summary['average_day_kwh'])}", "kWh PER DAY"),
        ], W),
        Spacer(1, 10),
        Paragraph(filter_note, styles["body"]),
    ]

    # --- Profile -----------------------------------------------------------
    story += [
        Paragraph("Average demand by day of week", styles["h2"]),
        Paragraph(
            "Mean kW in each half hour. Bank holidays are "
            + ("shown separately, so they do not flatten the weekday average."
               if exclude_holidays
               else "included in the weekday average."),
            styles["body"],
        ),
        _profile_chart(profile, width=W),
        PageBreak(),
        Paragraph("Average demand by day of week — hourly values (kW)", styles["h2"]),
    ]

    # Half-hourly would be 48 rows and unreadable; hourly keeps it to a page.
    summary_names = [s["name"] for s in profile["series"] if s["group"] == "summary"]
    day_names = [s["name"] for s in profile["series"] if s["group"] == "day"]
    ordered = day_names + summary_names
    by_name = {s["name"]: s["values"] for s in profile["series"]}

    rows = [["Time"] + ordered]
    for slot in range(0, 48, 2):
        rows.append(
            [profile["labels"][slot]]
            + [_fmt(by_name[n][slot], 1) for n in ordered]
        )
    col = W / (len(ordered) + 1)
    story += [
        _table(rows, [col] * (len(ordered) + 1)),
        Paragraph(
            "Days behind each average: "
            + ", ".join(f"{k} {v}" for k, v in profile["day_counts"].items()),
            styles["small"],
        ),
        PageBreak(),
    ]

    # --- Load duration -----------------------------------------------------
    story += [
        Paragraph("Load duration curve", styles["h2"]),
        Paragraph(
            "Load in kW against the hours per year the site sits at or above "
            "it. The steep left-hand tail is peak demand carried for very few "
            "hours; the flat right-hand end is base load running all year.",
            styles["body"],
        ),
        _ldc_chart(ldc, width=W),
        Spacer(1, 6),
        _tiles(styles, [
            (f"{_fmt(ldc['peak_kw'])} kW", "PEAK"),
            (f"{_fmt(ldc['average_kw'])} kW", "AVERAGE"),
            (f"{_fmt(ldc['base_kw'])} kW", "BASE"),
            (f"{ldc['load_factor'] * 100:.0f}%", "LOAD FACTOR"),
            (f"{_fmt(ldc['hours_covered'])}", "HOURS OF DATA"),
        ], W),
        Spacer(1, 10),
        Paragraph("Load exceeded for selected durations", styles["h2"]),
    ]

    # Pick the readings nearest a set of round hour counts, so the table
    # answers "what load do we carry for X hours a year?" directly.
    targets = [50, 100, 250, 500, 1000, 2000, 4000, 6000, 8000, 8766]
    duration_rows = [["Hours per year", "Load at or above (kW)", "% of peak"]]
    for target in targets:
        nearest = min(ldc["curve"], key=lambda p: abs(p["hours"] - target))
        share = nearest["kw"] / ldc["peak_kw"] * 100 if ldc["peak_kw"] else 0
        duration_rows.append([
            _fmt(target), _fmt(nearest["kw"], 1), f"{share:.0f}%",
        ])
    story += [
        _table(duration_rows, [W * 0.34, W * 0.33, W * 0.33], font_size=8),
        PageBreak(),
    ]

    # --- Day / night -------------------------------------------------------
    totals = day_night["totals"]
    story += [
        Paragraph("Day and night consumption by month", styles["h2"]),
        Paragraph(
            f"Night is {day_night['night_window']}. "
            f"{totals.get('night_share', 0) * 100:.0f}% of consumption in this "
            "period falls in the night window. A high night share on a site "
            "that closes overnight usually means plant left running.",
            styles["body"],
        ),
        _day_night_chart(day_night, width=W),
        Spacer(1, 8),
    ]
    dn_rows = [["Month", "Day (kWh)", "Night (kWh)", "Total (kWh)",
                "Night share", "Days"]]
    for m in day_night["months"]:
        total = m["day_kwh"] + m["night_kwh"]
        dn_rows.append([
            m["month"] + ("" if m["complete"] else " (partial)"),
            _fmt(m["day_kwh"]), _fmt(m["night_kwh"]), _fmt(total),
            f"{(m['night_kwh'] / total * 100) if total else 0:.0f}%",
            str(m["days"]),
        ])
    dn_rows.append([
        "Total", _fmt(totals.get("day_kwh", 0)), _fmt(totals.get("night_kwh", 0)),
        _fmt(totals.get("day_kwh", 0) + totals.get("night_kwh", 0)),
        f"{totals.get('night_share', 0) * 100:.0f}%", "",
    ])
    story += [
        _table(dn_rows, [W * 0.24] + [W * 0.152] * 5, font_size=8),
        PageBreak(),
    ]

    # --- Weeks -------------------------------------------------------------
    for week, title in ((week_a, "Week profile"),
                        (week_b, "Comparison week")):
        if not week or not week["days"]:
            continue
        story += [
            Paragraph(f"{title} — week commencing {week['week_commencing']}",
                      styles["h2"]),
            _week_chart(week, f"{title} (kW)", width=W),
            Spacer(1, 6),
        ]
        week_rows = [["Day", "Total kWh", "Peak kW", "Average kW", "Min kW"]]
        for d in week["days"]:
            week_rows.append([
                d["label"], _fmt(d["total_kwh"]), _fmt(max(d["values"]), 1),
                _fmt(sum(d["values"]) / len(d["values"]), 1),
                _fmt(min(d["values"]), 1),
            ])
        story += [
            _table(week_rows, [W * 0.28] + [W * 0.18] * 4, font_size=8),
            PageBreak(),
        ]

    # --- Scatter -----------------------------------------------------------
    story += [
        Paragraph("Every half-hourly reading", styles["h2"]),
        Paragraph(
            "Load against time of day for the whole period. The spread around "
            "the averages is what a line chart hides: a tight band means a "
            "predictable site, a wide one means the average alone is not much "
            "use for sizing.",
            styles["body"],
        ),
        _scatter_chart(scatter, width=W),
        Spacer(1, 6),
        Paragraph("Notable days", styles["h2"]),
        _table([
            ["", "Date", "Value"],
            ["Peak half hour", summary["peak_when"], f"{_fmt(summary['peak_kw'])} kW"],
            ["Highest day", summary["highest_day"],
             f"{_fmt(summary['highest_day_kwh'])} kWh"],
            ["Lowest day", summary["lowest_day"],
             f"{_fmt(summary['lowest_day_kwh'])} kWh"],
            ["Lowest half hour", "—", f"{_fmt(summary['base_kw'], 1)} kW"],
        ], [W * 0.3, W * 0.4, W * 0.3], font_size=8.5),
        Spacer(1, 8),
        Paragraph("Basis", styles["h2"]),
        Paragraph(
            DISCLAIMER
            + f" Source file: {filename}."
            if filename else DISCLAIMER,
            styles["small"],
        ),
    ]

    doc.build(story)
    return buffer.getvalue()
