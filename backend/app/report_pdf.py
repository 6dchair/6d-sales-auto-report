"""Builds the formatted PDF version of a sales report.

Takes the ReportRead object produced in routers/reports.py (duck-typed here
to avoid a circular import) and returns the PDF as bytes.
"""
from datetime import date, datetime
from decimal import Decimal
from io import BytesIO
from xml.sax.saxutils import escape

from reportlab.graphics.charts.barcharts import VerticalBarChart
from reportlab.graphics.shapes import Drawing
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import KeepTogether, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

INK = colors.HexColor("#20263a")
MUTED = colors.HexColor("#7e8699")
BRAND = colors.HexColor("#5368e6")
NAVY = colors.HexColor("#171d32")
LINE = colors.HexColor("#e4e7ef")
SOFT = colors.HexColor("#f6f7fb")

PAGE_WIDTH, PAGE_HEIGHT = A4
MARGIN = 18 * mm
CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN


def peso(value: Decimal) -> str:
    # Plain "PHP" because the built-in PDF fonts have no peso sign.
    return f"PHP {Decimal(value):,.2f}"


def short_date(value: date) -> str:
    return f"{value:%b} {value.day}, {value.year}"


def _styles():
    base = getSampleStyleSheet()
    return {
        "title": ParagraphStyle("title", parent=base["Title"], fontName="Helvetica-Bold",
                                fontSize=22, leading=26, textColor=INK, alignment=0, spaceAfter=4),
        "subtitle": ParagraphStyle("subtitle", parent=base["Normal"], fontSize=9.5,
                                   textColor=MUTED, leading=14),
        "h2": ParagraphStyle("h2", parent=base["Heading2"], fontName="Helvetica-Bold",
                             fontSize=13, textColor=INK, spaceBefore=16, spaceAfter=8),
        "cell": ParagraphStyle("cell", parent=base["Normal"], fontSize=9, leading=11, textColor=INK),
        "kpi_label": ParagraphStyle("kpi_label", parent=base["Normal"], fontName="Helvetica-Bold",
                                    fontSize=7, leading=9, textColor=MUTED),
        "kpi_value": ParagraphStyle("kpi_value", parent=base["Normal"], fontName="Helvetica-Bold",
                                    fontSize=12, leading=16, textColor=INK),
        "kpi_foot": ParagraphStyle("kpi_foot", parent=base["Normal"], fontSize=7, leading=9,
                                   textColor=colors.HexColor("#989eae")),
        "note": ParagraphStyle("note", parent=base["Normal"], fontSize=9, textColor=MUTED),
    }


def _kpi_table(summary, styles):
    labels = ["NET SALES", "TRANSACTIONS", "ITEMS SOLD", "AVG. TRANSACTION"]
    values = [
        peso(summary.net_sales),
        f"{summary.transaction_count:,}",
        f"{summary.items_sold:,}",
        peso(summary.average_transaction),
    ]
    feet = [
        f"Gross {peso(summary.gross_sales)}",
        "Completed sales",
        "Units across all products",
        "Net sales per transaction",
    ]
    cells = [[
        [
            Paragraph(label, styles["kpi_label"]),
            Spacer(1, 3),
            Paragraph(value, styles["kpi_value"]),
            Spacer(1, 1),
            Paragraph(foot, styles["kpi_foot"]),
        ]
        for label, value, foot in zip(labels, values, feet)
    ]]
    col = CONTENT_WIDTH / 4
    table = Table(cells, colWidths=[col] * 4)
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), SOFT),
        ("BOX", (0, 0), (-1, -1), 0.5, LINE),
        ("LINEAFTER", (0, 0), (-2, -1), 0.5, LINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 9),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
        ("LEFTPADDING", (0, 0), (-1, -1), 9),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
    ]))
    return table


def _daily_chart(daily):
    height = 55 * mm
    drawing = Drawing(CONTENT_WIDTH, height)
    chart = VerticalBarChart()
    chart.x = 38
    chart.y = 24
    chart.width = CONTENT_WIDTH - 46
    chart.height = height - 34
    chart.data = [[float(point.sales) for point in daily]]

    # Label roughly 8 dates so long ranges stay readable.
    step = max(1, len(daily) // 8)
    names = []
    for index, point in enumerate(daily):
        day = date.fromisoformat(point.date)
        names.append(f"{day:%b} {day.day}" if index % step == 0 else "")
    chart.categoryAxis.categoryNames = names
    chart.categoryAxis.labels.fontName = "Helvetica"
    chart.categoryAxis.labels.fontSize = 7
    chart.categoryAxis.labels.fillColor = MUTED
    chart.categoryAxis.labels.dy = -2
    chart.categoryAxis.strokeColor = LINE
    chart.categoryAxis.visibleTicks = False

    chart.valueAxis.valueMin = 0
    chart.valueAxis.labels.fontName = "Helvetica"
    chart.valueAxis.labels.fontSize = 7
    chart.valueAxis.labels.fillColor = MUTED
    chart.valueAxis.strokeColor = colors.white
    chart.valueAxis.gridStrokeColor = LINE
    chart.valueAxis.visibleGrid = True
    chart.valueAxis.labelTextFormat = (
        lambda v: f"{v / 1_000_000:g}M" if v >= 1_000_000 else f"{v / 1000:g}k" if v >= 1000 else f"{v:g}"
    )

    chart.bars[0].fillColor = BRAND
    chart.bars[0].strokeColor = None
    chart.barSpacing = 0
    chart.groupSpacing = 2 if len(daily) > 45 else 4
    drawing.add(chart)
    return drawing


def _data_table(header, rows, col_widths, right_cols, styles):
    data = [header] + rows
    table = Table(data, colWidths=col_widths, repeatRows=1)
    style = [
        ("BACKGROUND", (0, 0), (-1, 0), NAVY),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, 0), 7.5),
        ("FONTNAME", (0, 1), (-1, -1), "Helvetica"),
        ("FONTSIZE", (0, 1), (-1, -1), 9),
        ("TEXTCOLOR", (0, 1), (-1, -1), INK),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, SOFT]),
        ("LINEBELOW", (0, 0), (-1, -1), 0.4, LINE),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
    ]
    for col in right_cols:
        style.append(("ALIGN", (col, 0), (col, -1), "RIGHT"))
    table.setStyle(TableStyle(style))
    return table


def _make_footer(system_name: str):
    def footer(canvas, doc):
        canvas.saveState()
        canvas.setFont("Helvetica", 8)
        canvas.setFillColor(MUTED)
        canvas.drawString(MARGIN, 12 * mm, f"{system_name} · Sales report")
        canvas.drawRightString(PAGE_WIDTH - MARGIN, 12 * mm, f"Page {doc.page}")
        canvas.restoreState()

    return footer


def build_pdf(report, system_name: str = "6dMetrix") -> bytes:
    styles = _styles()
    buffer = BytesIO()
    doc = SimpleDocTemplate(
        buffer, pagesize=A4,
        leftMargin=MARGIN, rightMargin=MARGIN, topMargin=MARGIN, bottomMargin=20 * mm,
        title="Sales report", author=system_name,
    )

    story = [
        Paragraph("Sales report", styles["title"]),
        Paragraph(
            f"{escape(system_name)} &nbsp;·&nbsp; Period: {short_date(report.start_date)} – {short_date(report.end_date)}"
            f" &nbsp;·&nbsp; Generated {datetime.now():%b} {datetime.now().day}, {datetime.now().year}",
            styles["subtitle"],
        ),
        Spacer(1, 14),
        _kpi_table(report.summary, styles),
        Paragraph("Daily net sales", styles["h2"]),
    ]

    if report.summary.transaction_count == 0:
        story.append(Paragraph("No sales were recorded in this period.", styles["note"]))
    else:
        story.append(_daily_chart(report.daily))

        top_heading = Paragraph("Top products", styles["h2"])
        product_rows = [
            [str(i), Paragraph(p.product, styles["cell"]), Paragraph(p.category, styles["cell"]),
             f"{p.quantity:,}", peso(p.net_sales)]
            for i, p in enumerate(report.top_products, start=1)
        ]
        story.append(KeepTogether([top_heading, _data_table(
            ["#", "PRODUCT", "CATEGORY", "UNITS", "NET SALES"], product_rows,
            [10 * mm, CONTENT_WIDTH - 10 * mm - 32 * mm - 18 * mm - 38 * mm, 32 * mm, 18 * mm, 38 * mm],
            right_cols=[3, 4], styles=styles,
        )]))

        category_heading = Paragraph("Sales by category", styles["h2"])
        category_rows = [
            [Paragraph(c.category, styles["cell"]), f"{c.quantity:,}", peso(c.net_sales), f"{c.share_percent}%"]
            for c in report.categories
        ]
        story.append(KeepTogether([category_heading, _data_table(
            ["CATEGORY", "UNITS", "NET SALES", "SHARE"], category_rows,
            [CONTENT_WIDTH - 20 * mm - 40 * mm - 22 * mm, 20 * mm, 40 * mm, 22 * mm],
            right_cols=[1, 2, 3], styles=styles,
        )]))

    footer = _make_footer(system_name)
    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    return buffer.getvalue()
