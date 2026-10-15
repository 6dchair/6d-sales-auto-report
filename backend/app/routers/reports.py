import csv
import io
from datetime import date, timedelta
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Product, Sale, SaleItem
from ..report_pdf import build_pdf

router = APIRouter()

MAX_RANGE_DAYS = 366
CENT = Decimal("0.01")
TENTH = Decimal("0.1")

LINE_TOTAL = SaleItem.unit_price * SaleItem.quantity
NET = LINE_TOTAL - SaleItem.discount


# ---------- response models ----------

class ReportSummary(BaseModel):
    transaction_count: int
    items_sold: int
    gross_sales: Decimal
    discounts: Decimal
    net_sales: Decimal
    average_transaction: Decimal


class DailyPoint(BaseModel):
    date: str
    sales: Decimal


class ProductRow(BaseModel):
    product: str
    category: str
    quantity: int
    net_sales: Decimal


class CategoryRow(BaseModel):
    category: str
    quantity: int
    net_sales: Decimal
    share_percent: Decimal


class ReportRead(BaseModel):
    start_date: date
    end_date: date
    summary: ReportSummary
    daily: list[DailyPoint]
    top_products: list[ProductRow]
    categories: list[CategoryRow]


# ---------- helpers ----------

def money(value) -> Decimal:
    return Decimal(str(value or 0)).quantize(CENT)


def resolve_range(start_date: date | None, end_date: date | None) -> tuple[date, date]:
    end = end_date or date.today()
    start = start_date or end - timedelta(days=29)
    if start > end:
        raise HTTPException(status_code=422, detail="start_date must be on or before end_date.")
    if (end - start).days + 1 > MAX_RANGE_DAYS:
        raise HTTPException(status_code=422, detail=f"Date range cannot exceed {MAX_RANGE_DAYS} days.")
    return start, end


def sale_filters(start: date, end: date) -> list:
    return [Sale.status == "completed", Sale.sale_date >= start, Sale.sale_date <= end]


def product_rows(db: Session, filters: list) -> list[ProductRow]:
    net = func.sum(NET)
    rows = (
        db.query(Product.name, Product.category, func.sum(SaleItem.quantity), net)
        .select_from(SaleItem)
        .join(Sale, Sale.id == SaleItem.sale_id)
        .join(Product, Product.id == SaleItem.product_id)
        .filter(*filters)
        .group_by(Product.id, Product.name, Product.category)
        .order_by(net.desc(), Product.name)
        .all()
    )
    return [
        ProductRow(product=name, category=category, quantity=int(qty or 0), net_sales=money(total))
        for name, category, qty, total in rows
    ]


def category_rows(db: Session, filters: list, total_net: Decimal) -> list[CategoryRow]:
    net = func.sum(NET)
    rows = (
        db.query(Product.category, func.sum(SaleItem.quantity), net)
        .select_from(SaleItem)
        .join(Sale, Sale.id == SaleItem.sale_id)
        .join(Product, Product.id == SaleItem.product_id)
        .filter(*filters)
        .group_by(Product.category)
        .order_by(net.desc(), Product.category)
        .all()
    )
    result = []
    for category, qty, total in rows:
        total = money(total)
        share = (total / total_net * 100).quantize(TENTH) if total_net > 0 else Decimal("0.0")
        result.append(CategoryRow(category=category, quantity=int(qty or 0), net_sales=total, share_percent=share))
    return result


def daily_rows(db: Session, filters: list, start: date, end: date) -> list[DailyPoint]:
    rows = (
        db.query(Sale.sale_date, func.sum(NET))
        .select_from(Sale)
        .join(SaleItem, SaleItem.sale_id == Sale.id)
        .filter(*filters)
        .group_by(Sale.sale_date)
        .all()
    )
    totals = {sale_date: money(total) for sale_date, total in rows}
    zero = Decimal("0.00")
    return [
        DailyPoint(
            date=(start + timedelta(days=offset)).isoformat(),
            sales=totals.get(start + timedelta(days=offset), zero),
        )
        for offset in range((end - start).days + 1)
    ]


def build_report(db: Session, start: date, end: date, top_n: int = 10) -> ReportRead:
    filters = sale_filters(start, end)

    count, items, gross, discounts = (
        db.query(
            func.count(func.distinct(Sale.id)),
            func.coalesce(func.sum(SaleItem.quantity), 0),
            func.coalesce(func.sum(LINE_TOTAL), 0),
            func.coalesce(func.sum(SaleItem.discount), 0),
        )
        .select_from(Sale)
        .join(SaleItem, SaleItem.sale_id == Sale.id)
        .filter(*filters)
        .one()
    )
    gross, discounts = money(gross), money(discounts)
    net_total = gross - discounts
    count = int(count or 0)

    return ReportRead(
        start_date=start,
        end_date=end,
        summary=ReportSummary(
            transaction_count=count,
            items_sold=int(items or 0),
            gross_sales=gross,
            discounts=discounts,
            net_sales=net_total,
            average_transaction=(net_total / count).quantize(CENT) if count else Decimal("0.00"),
        ),
        daily=daily_rows(db, filters, start, end),
        top_products=product_rows(db, filters)[:top_n],
        categories=category_rows(db, filters, net_total),
    )


def safe_cell(value):
    """Stop spreadsheet apps from running text such as '=SUM(...)' as a formula."""
    if isinstance(value, str) and value[:1] in ("=", "+", "-", "@"):
        return "'" + value
    return value


def csv_response(headers: list[str], rows: list[list], filename: str) -> Response:
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(headers)
    for row in rows:
        writer.writerow([safe_cell(value) for value in row])
    # The BOM makes Excel read the file as UTF-8.
    return Response(
        content="\ufeff" + buffer.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ---------- endpoints ----------

@router.get("/reports/summary", response_model=ReportRead)
def report_summary(
    start_date: date | None = None,
    end_date: date | None = None,
    db: Session = Depends(get_db),
):
    start, end = resolve_range(start_date, end_date)
    return build_report(db, start, end)


@router.get("/reports/csv")
def report_csv(
    dataset: Literal["transactions", "daily", "products", "categories"] = Query("transactions"),
    start_date: date | None = None,
    end_date: date | None = None,
    db: Session = Depends(get_db),
):
    start, end = resolve_range(start_date, end_date)
    filters = sale_filters(start, end)
    filename = f"sales-{dataset}-{start}-to-{end}.csv"

    if dataset == "daily":
        rows = daily_rows(db, filters, start, end)
        return csv_response(["date", "net_sales"], [[r.date, r.sales] for r in rows], filename)

    if dataset == "products":
        rows = product_rows(db, filters)
        return csv_response(
            ["rank", "product_name", "category", "units_sold", "net_sales"],
            [[i, r.product, r.category, r.quantity, r.net_sales] for i, r in enumerate(rows, start=1)],
            filename,
        )

    if dataset == "categories":
        total = sum((r.net_sales for r in product_rows(db, filters)), Decimal("0.00"))
        rows = category_rows(db, filters, total)
        return csv_response(
            ["category", "units_sold", "net_sales", "share_percent"],
            [[r.category, r.quantity, r.net_sales, r.share_percent] for r in rows],
            filename,
        )

    # transactions: one row per sale line item
    line_net = LINE_TOTAL - SaleItem.discount
    rows = (
        db.query(
            Sale.reference_number, Sale.sale_date, Product.name, Product.category,
            SaleItem.quantity, SaleItem.unit_price, SaleItem.discount, line_net,
        )
        .select_from(SaleItem)
        .join(Sale, Sale.id == SaleItem.sale_id)
        .join(Product, Product.id == SaleItem.product_id)
        .filter(*filters)
        .order_by(Sale.sale_date, Sale.reference_number, SaleItem.id)
        .all()
    )
    return csv_response(
        ["reference_number", "sale_date", "product_name", "category",
         "quantity", "unit_price", "discount", "net_sales"],
        [[ref, sale_date.isoformat(), name, category, qty, money(price), money(disc), money(net)]
         for ref, sale_date, name, category, qty, price, disc, net in rows],
        filename,
    )


@router.get("/reports/pdf")
def report_pdf(
    start_date: date | None = None,
    end_date: date | None = None,
    system_name: str = Query("MotoMetrics", min_length=1, max_length=60),
    db: Session = Depends(get_db),
):
    start, end = resolve_range(start_date, end_date)
    report = build_report(db, start, end)
    return Response(
        content=build_pdf(report, system_name.strip() or "MotoMetrics"),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="sales-report-{start}-to-{end}.pdf"'},
    )
